// What a window works on: its project's collections, environments and
// history (watched), the chosen environment, the open tabs, and opening,
// closing and saving to them.

import { useEffect, useMemo, useState } from 'react';
import { useHost, useWindow } from '@hyperpane/sdk/client';
import { type Collection, type Environment, type HistoryEntry, ID, type Request, type State, newId } from '../../shared/index.ts';
import { useKept } from '../lib/hooks.ts';
import { Live } from '../lib/live.ts';
import { type Tab, dirty, findItem, snapshot, tabName } from '../lib/model.ts';

export interface Kept {
  tabs: Tab[];
  active: string | null;
}

export function useWorkspace(project: string) {
  const host = useHost();
  const win = useWindow();
  const live = useMemo(() => new Live(host), [host]);
  useEffect(() => () => live.dropAll(), [live]);
  const [state, setState] = useState<{ collections: Collection[] | null; environments: Environment[]; history: HistoryEntry[] }>({ collections: null, environments: [], history: [] });
  const [error, setError] = useState<string | null>(null);
  const [env, setEnv] = useKept<string | null>(`requests.env.${project}`, null);
  const [kept, setKept] = useKept<Kept>(`requests.tabs.${project}.${win?.id ?? 0}`, { tabs: [], active: null });

  useEffect(
    () =>
      host.subscribe<State>(
        ID,
        { op: 'watch', project },
        (s) =>
          setState((old) => ({
            collections: s.collections ?? old.collections,
            environments: s.environments ?? old.environments,
            history: s.history ?? old.history,
          })),
        { onEnd: (e) => e && setError(e) },
      ),
    [host, project],
  );

  const { collections, environments, history } = state;
  const tabs = kept.tabs;
  const active = tabs.find((t) => t.key === kept.active) ?? tabs[0] ?? null;
  const setTabs = (fn: (tabs: Tab[]) => Tab[], activeKey?: string | null) =>
    setKept((k) => ({ tabs: fn(k.tabs), active: activeKey === undefined ? k.active : activeKey }));
  const activate = (key: string) => setKept((k) => ({ ...k, active: key }));
  const updateTab = (key: string, fn: (t: Tab) => Tab) => setTabs((ts) => ts.map((t) => (t.key === key ? fn(t) : t)));

  // A saved request changed elsewhere (renamed in the tree, another
  // window, a pull) shows the change, unless it has changes of its own.
  useEffect(() => {
    if (!collections) return;
    setKept((k) => {
      let changed = false;
      const next = k.tabs.map((t) => {
        if (t.kind !== 'request' || !t.collection) return t;
        const c = collections.find((x) => x.id === t.collection);
        const found = c ? findItem(c.items, t.request.id) : null;
        if (!found || found.item.type === 'folder') {
          if (t.saved === null) return t;
          changed = true;
          return { ...t, saved: null, collection: null, folder: null };
        }
        const s = snapshot(found.item);
        const folder = found.parent?.id ?? null;
        if (t.saved === s && t.folder === folder) return t;
        changed = true;
        return dirty(t) ? { ...t, saved: s, folder } : { ...t, request: found.item as Request, saved: s, folder };
      });
      return changed ? { ...k, tabs: next } : k;
    });
  }, [collections]);

  const envOf = (id: string | null) => environments.find((e) => e.id === id) ?? null;
  const collectionOf = (id: string | null | undefined) => collections?.find((c) => c.id === id) ?? null;
  const activeEnv = envOf(env);

  const saveCollection = async (c: Collection) => {
    setState((s) => ({ ...s, collections: s.collections && (s.collections.some((x) => x.id === c.id) ? s.collections.map((x) => (x.id === c.id ? c : x)) : [...s.collections, c]) }));
    try {
      await host.call(ID, { op: 'saveCollection', project, collection: c });
    } catch (e) {
      host.app.toast((e as Error).message, { error: true });
    }
  };
  const saveEnvironment = async (e: Environment) => {
    setState((s) => ({ ...s, environments: s.environments.some((x) => x.id === e.id) ? s.environments.map((x) => (x.id === e.id ? e : x)) : [...s.environments, e] }));
    try {
      await host.call(ID, { op: 'saveEnvironment', project, environment: e });
    } catch (err) {
      host.app.toast((err as Error).message, { error: true });
    }
  };

  const openRequest = (request: Request, o: { collection?: string | null; folder?: string | null; saved?: boolean } = {}) => {
    const existing = o.collection ? tabs.find((t) => t.kind === 'request' && t.request.id === request.id) : null;
    if (existing) return activate(existing.key);
    const tab: Tab = { key: newId(), kind: 'request', request: structuredClone(request), saved: o.saved ? snapshot(request) : null, collection: o.collection ?? null, folder: o.folder ?? null };
    setTabs((ts) => [...ts, tab], tab.key);
  };
  const openPanel = (tab: Tab) => {
    const existing = tabs.find((t) => (t.kind === 'settings' && tab.kind === 'settings' && t.collection === tab.collection && t.folder === tab.folder) || (t.kind === 'environment' && tab.kind === 'environment' && t.id === tab.id));
    if (existing) return activate(existing.key);
    setTabs((ts) => [...ts, tab], tab.key);
  };

  const close = async (key: string) => {
    const t = tabs.find((x) => x.key === key);
    if (!t) return;
    if (dirty(t) && !(await host.ui.confirm({ title: 'Close without saving?', message: `“${tabName(t, collections ?? [], (id) => envOf(id)?.name ?? 'Environment')}” has changes that aren’t saved.`, confirm: 'Close', destructive: true }))) return;
    live.drop(key);
    setKept((k) => {
      const i = k.tabs.findIndex((x) => x.key === key);
      const rest = k.tabs.filter((x) => x.key !== key);
      const nextActive = k.active === key ? (rest[Math.min(i, rest.length - 1)]?.key ?? null) : k.active;
      return { tabs: rest, active: nextActive };
    });
  };

  return { host, project, live, setState, error, env, setEnv, collections, environments, history, tabs, active, setTabs, activate, updateTab, envOf, collectionOf, activeEnv, saveCollection, saveEnvironment, openRequest, openPanel, close };
}

export type Workspace = ReturnType<typeof useWorkspace>;
