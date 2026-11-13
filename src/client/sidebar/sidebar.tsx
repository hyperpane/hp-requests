// The sidebar: the environment, then the collections (a tree of folders
// and requests, searched, with a menu on each) or the history.

import { useState } from 'react';
import { ChevronDown, ChevronRight, Clock, FolderOpen, Library, PanelLeft, Plus, Search, Trash2 } from 'lucide-react';
import { formatAgo, useHost } from '@hyperpane/sdk/client';
import { NodeButton, NodeInput, ToolButton, cn } from '@hyperpane/ui';
import { Folder as FolderIcon } from 'lucide-react';
import type { Collection, Environment, HistoryEntry, Item } from '../../shared/index.ts';
import { useKept } from '../lib/hooks.ts';
import { type Option, menuAt } from '../lib/menu.ts';
import { countRequests, filterItems, methodOf } from '../lib/model.ts';
import { MoreButton, NEW_MENU, type SidebarOps, itemMenu } from './menus.tsx';
import { MethodBadge, StatusPill } from '../ui/badges.tsx';
import { Picker } from '../ui/picker.tsx';
import { Tabs } from '../ui/tabs.tsx';

export function Sidebar({
  collections,
  environments,
  history,
  env,
  setEnv,
  active,
  ops,
  onHide,
}: {
  collections: Collection[] | null;
  environments: Environment[];
  history: HistoryEntry[];
  env: string | null;
  setEnv(id: string | null): void;
  active: string | null;
  ops: SidebarOps;
  /** In a narrow window: back to the open tab. */
  onHide?: () => void;
}) {
  const host = useHost();
  const [tab, setTab] = useKept<'collections' | 'history'>('requests.sideTab', 'collections');
  const [q, setQ] = useState('');
  const [closed, setClosed] = useKept<string[]>('requests.closed', []);
  const toggle = (id: string) => setClosed((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]));
  const menu = async (e: React.MouseEvent, c: Collection, item: Item | null) => {
    e.preventDefault();
    e.stopPropagation();
    const at = e.type === 'contextmenu' ? { x: e.clientX, y: e.clientY } : (e.currentTarget as HTMLElement);
    const id = await menuAt(host, at, itemMenu(item));
    if (id) ops.act(id, c, item);
  };

  const row = (c: Collection, item: Item, depth: number, folder: string | null): React.ReactNode => {
    const pad = { paddingLeft: 6 + depth * 12 };
    if (item.type === 'folder') {
      const open = q !== '' || !closed.includes(item.id);
      return (
        <div key={item.id}>
          <div className="group flex h-6 min-w-0 cursor-default items-center gap-1 rounded pr-1 hover:bg-[var(--node-hover)]" style={pad} onClick={() => toggle(item.id)} onContextMenu={(e) => void menu(e, c, item)}>
            {open ? <ChevronDown className="size-3 flex-none text-[var(--node-muted)]" /> : <ChevronRight className="size-3 flex-none text-[var(--node-muted)]" />}
            {open ? <FolderOpen className="size-3.5 flex-none text-[var(--node-muted)]" /> : <FolderIcon className="size-3.5 flex-none text-[var(--node-muted)]" />}
            <span className="min-w-0 flex-1 truncate">{item.name}</span>
            <MoreButton onClick={(e) => void menu(e, c, item)} />
          </div>
          {open && item.items.map((i) => row(c, i, depth + 1, item.id))}
        </div>
      );
    }
    return (
      <div
        key={item.id}
        className={cn('group flex h-6 min-w-0 cursor-default items-center gap-1.5 rounded pr-1 hover:bg-[var(--node-hover)]', active === item.id && 'bg-[var(--node-hover)]')}
        style={{ paddingLeft: pad.paddingLeft + 2 }}
        onClick={() => ops.open(item, c, folder)}
        onContextMenu={(e) => void menu(e, c, item)}
        title={item.url}
      >
        <MethodBadge method={methodOf(item)} />
        <span className="min-w-0 flex-1 truncate">{item.name}</span>
        <MoreButton onClick={(e) => void menu(e, c, item)} />
      </div>
    );
  };

  const envOptions: Option[] = [
    { id: '', label: 'No environment' },
    ...environments.map((e) => ({ id: e.id, label: e.name })),
    { id: '-', label: '', separator: true },
    ...(env ? [{ id: ':edit', label: 'Edit this environment…' }] : []),
    { id: ':new', label: 'New environment…' },
    ...(env ? [{ id: ':duplicate', label: 'Duplicate it' }, { id: ':delete', label: 'Delete it…', danger: true }] : []),
  ];
  const shownHistory = q ? history.filter((h) => `${h.request.method} ${h.url} ${h.status ?? ''}`.toLowerCase().includes(q.toLowerCase())) : history;

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex min-w-0 items-center gap-1 p-2 pb-1">
        {onHide && <ToolButton label="Hide the sidebar" icon={PanelLeft} active onClick={onHide} />}
        <Picker
          label="Environment"
          className="min-w-0 flex-1"
          value={env ?? ''}
          options={envOptions}
          onChange={(id) => (id.startsWith(':') ? ops.environment(id.slice(1)) : setEnv(id || null))}
          render={(o) => (
            <span className={cn(!env && 'text-[var(--node-muted)]')}>
              {o?.label ?? 'No environment'}
            </span>
          )}
        />
        <ToolButton label="New…" icon={Plus} onClick={async (e) => {
          const id = await menuAt(host, e.currentTarget, NEW_MENU);
          if (id) ops.create(id);
        }} />
      </div>
      <Tabs
        className="px-1"
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'collections', name: 'Collections' },
          { id: 'history', name: 'History' },
        ]}
      />
      <div className="relative px-2 pt-1.5 pb-1">
        <Search className="absolute top-3 left-3.5 size-3 text-[var(--node-muted)]" />
        <NodeInput className="w-full pl-6" placeholder={tab === 'history' ? 'Find in the history' : 'Find a request'} value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-1 pb-2">
        {tab === 'collections' ? (
          collections === null ? (
            <p className="px-2 py-2 text-[var(--node-muted)]">Loading…</p>
          ) : collections.length === 0 ? (
            <div className="flex flex-col items-start gap-2 px-2 py-3 text-[var(--node-muted)]">
              <span>No collections yet. A collection keeps requests in the project, to share them with it.</span>
              <NodeButton onClick={() => ops.create('collection')}>
                <Library />
                New collection
              </NodeButton>
              <NodeButton onClick={() => ops.create('import')}>Import cURL or Postman…</NodeButton>
            </div>
          ) : (
            collections.map((c) => {
              const items = filterItems(c.items, q);
              if (q && !items.length && !c.name.toLowerCase().includes(q.toLowerCase())) return null;
              const open = q !== '' || !closed.includes(c.id);
              return (
                <div key={c.id} className="mb-0.5">
                  <div className="group flex h-7 min-w-0 cursor-default items-center gap-1 rounded pr-1 pl-1 font-medium hover:bg-[var(--node-hover)]" onClick={() => toggle(c.id)} onContextMenu={(e) => void menu(e, c, null)}>
                    {open ? <ChevronDown className="size-3 flex-none text-[var(--node-muted)]" /> : <ChevronRight className="size-3 flex-none text-[var(--node-muted)]" />}
                    <Library className="size-3.5 flex-none text-[var(--node-muted)]" />
                    <span className="min-w-0 flex-1 truncate">{c.name}</span>
                    <span className="flex-none text-[10px] font-normal text-[var(--node-muted)] group-hover:hidden">{countRequests(c.items)}</span>
                    <MoreButton onClick={(e) => void menu(e, c, null)} />
                  </div>
                  {open && (items.length ? items.map((i) => row(c, i, 1, null)) : <p className="py-1 pl-7 text-[11px] text-[var(--node-muted)]">Empty: right-click it to add a request.</p>)}
                </div>
              );
            })
          )
        ) : (
          <>
            {history.length > 0 && (
              <div className="flex justify-end px-1 pb-1">
                <button type="button" className="flex items-center gap-1 text-[11px] text-[var(--node-muted)] hover:text-[var(--node-fg)]" onClick={ops.clearHistory}>
                  <Trash2 className="size-3" />
                  Clear the history
                </button>
              </div>
            )}
            {!shownHistory.length && (
              <p className="flex items-center gap-1.5 px-2 py-2 text-[var(--node-muted)]">
                <Clock className="size-3.5" />
                {history.length ? 'Nothing matches.' : 'Requests you send show here.'}
              </p>
            )}
            {shownHistory.map((h) => (
              <div
                key={h.id}
                className="group flex min-w-0 cursor-default flex-col rounded px-1.5 py-1 hover:bg-[var(--node-hover)]"
                onClick={() => ops.openHistory(h)}
                onContextMenu={async (e) => {
                  e.preventDefault();
                  const id = await host.ui.menu({ x: e.clientX, y: e.clientY }, [
                    { id: 'open', label: 'Open in a new tab' },
                    { id: 'remove', label: 'Remove from the history', danger: true },
                  ]);
                  if (id === 'open') ops.openHistory(h);
                  if (id === 'remove') ops.removeHistory(h.id);
                }}
                title={h.error ?? h.url}
              >
                <div className="flex min-w-0 items-center gap-1.5">
                  <MethodBadge method={h.request.type === 'sse' ? 'SSE' : h.request.method} className="w-auto" />
                  <span className="min-w-0 flex-1 truncate font-mono text-[11px]">{h.url.replace(/^https?:\/\//, '')}</span>
                </div>
                <div className="flex min-w-0 items-center gap-1.5 pl-0.5 text-[10px] text-[var(--node-muted)]">
                  {h.status ? <StatusPill status={h.status} /> : <span className="truncate text-[var(--ansi-1)]">{h.error}</span>}
                  {h.status !== null && <span>{Math.round(h.time)} ms</span>}
                  <span className="ml-auto flex-none">{formatAgo(h.at)}</span>
                </div>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
