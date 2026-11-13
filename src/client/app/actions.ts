// What the window does when asked: saving a request (into a collection it
// picks, when it has none), and the sidebar's actions on collections,
// folders, requests, the history and environments.

import { type Collection, type Environment, type HistoryEntry, ID, newCollection, newFolder, newId, normalizeRequest } from '../../shared/index.ts';
import type { Workspace } from './workspace.ts';
import { menuAt } from '../lib/menu.ts';
import { type Tab, addItem, copyCollection, copyItem, findItem, insertAfter, mapItem, newRequest, snapshot } from '../lib/model.ts';
import type { SidebarOps } from '../sidebar/menus.tsx';

export function actions(w: Workspace, ui: { box: React.RefObject<HTMLDivElement | null>; setImporting(on: boolean): void }) {
  const { host, project, collections, tabs, env, setEnv, activeEnv, setState, collectionOf, updateTab, saveCollection, saveEnvironment, openRequest, openPanel } = w;
  const { box, setImporting } = ui;

  /** Asks which collection to save into: an existing one, or a new one. */
  const pickCollection = async (): Promise<Collection | null> => {
    const list = collections ?? [];
    const r = box.current?.getBoundingClientRect();
    const id = await menuAt(host, { x: (r?.left ?? 0) + (r?.width ?? 400) / 2 - 80, y: (r?.top ?? 0) + 60 }, [
      ...list.map((c) => ({ id: c.id, label: `Save in “${c.name}”` })),
      ...(list.length ? [{ id: '-', label: '', separator: true }] : []),
      { id: ':new', label: 'Save in a new collection…' },
    ]);
    if (!id) return null;
    if (id !== ':new') return list.find((c) => c.id === id) ?? null;
    const name = await host.ui.prompt({ title: 'New collection', label: 'Name', value: 'My requests' });
    if (!name?.trim()) return null;
    const c = newCollection(name.trim());
    await saveCollection(c);
    return c;
  };

  const save = async (t: Tab | null) => {
    if (!t || t.kind !== 'request') return;
    let c = collectionOf(t.collection);
    let folder = t.folder;
    if (!c) {
      c = await pickCollection();
      if (!c) return;
      folder = null;
    }
    // A folder that went meanwhile: the collection's top.
    if (folder && !findItem(c.items, folder)) folder = null;
    const r = t.request;
    const items = findItem(c.items, r.id) ? mapItem(c.items, r.id, () => r) : addItem(c.items, folder, r);
    await saveCollection({ ...c, items });
    updateTab(t.key, (x) => (x.kind === 'request' ? { ...x, saved: snapshot(r), collection: c!.id, folder } : x));
  };

  const ops: SidebarOps = {
    open: (item, c, folder) => item.type !== 'folder' && openRequest(item, { collection: c.id, folder, saved: true }),
    openHistory: (h: HistoryEntry) => openRequest({ ...normalizeRequest(h.request), id: newId(), name: h.request.name || h.url }),
    clearHistory: async () => {
      if (await host.ui.confirm({ title: 'Clear the history?', message: 'Every request in it goes. Your collections stay.', confirm: 'Clear', destructive: true })) await host.call(ID, { op: 'removeHistory', project }).catch(() => {});
    },
    removeHistory: (id) => void host.call(ID, { op: 'removeHistory', project, id }).catch(() => {}),
    create: async (what) => {
      if (what === 'import') return setImporting(true);
      if (what === 'collection') {
        const name = await host.ui.prompt({ title: 'New collection', label: 'Name', value: '' });
        if (name?.trim()) await saveCollection(newCollection(name.trim()));
        return;
      }
      openRequest(newRequest(what));
    },
    act: async (action, c, item) => {
      const folderId = item?.type === 'folder' ? item.id : null;
      switch (action) {
        case 'newHttp':
        case 'newWs':
        case 'newSse': {
          const r = newRequest(action === 'newWs' ? 'ws' : action === 'newSse' ? 'sse' : 'http');
          await saveCollection({ ...c, items: addItem(c.items, folderId, r) });
          openRequest(r, { collection: c.id, folder: folderId, saved: true });
          break;
        }
        case 'newFolder': {
          const name = await host.ui.prompt({ title: 'New folder', label: 'Name', value: '' });
          if (name?.trim()) await saveCollection({ ...c, items: addItem(c.items, folderId, newFolder(name.trim())) });
          break;
        }
        case 'settings':
          openPanel({ key: newId(), kind: 'settings', collection: c.id, folder: folderId });
          break;
        case 'rename': {
          const name = await host.ui.prompt({ title: 'Rename', label: 'Name', value: item ? item.name : c.name });
          if (!name?.trim()) break;
          await saveCollection(item ? { ...c, items: mapItem(c.items, item.id, (x) => ({ ...x, name: name.trim() })) } : { ...c, name: name.trim() });
          // An open copy with changes of its own takes the name too.
          if (item) updateTab(tabs.find((t) => t.kind === 'request' && t.request.id === item.id)?.key ?? '', (t) => (t.kind === 'request' ? { ...t, request: { ...t.request, name: name.trim() } } : t));
          break;
        }
        case 'duplicate':
          if (item) await saveCollection({ ...c, items: insertAfter(c.items, item.id, copyItem(item)) });
          else await saveCollection(copyCollection(c));
          break;
        case 'export':
          void host.app.saveStream(ID, { op: 'exportPostman', project, id: c.id }, { name: `${c.name}.postman_collection.json` }).catch((e: Error) => host.app.toast(e.message, { error: true }));
          break;
        case 'delete': {
          const what = item ? (item.type === 'folder' ? `the folder “${item.name}” and everything in it` : `“${item.name}”`) : `the collection “${c.name}” and every request in it`;
          if (!(await host.ui.confirm({ title: 'Delete?', message: `This deletes ${what}, from the project.`, confirm: 'Delete', destructive: true }))) break;
          if (item) await saveCollection({ ...c, items: mapItem(c.items, item.id, () => null) });
          else {
            setState((s) => ({ ...s, collections: s.collections?.filter((x) => x.id !== c.id) ?? null }));
            await host.call(ID, { op: 'removeCollection', project, id: c.id }).catch((e: Error) => host.app.toast(e.message, { error: true }));
          }
          break;
        }
        case 'open':
          if (item && item.type !== 'folder') {
            const found = findItem(c.items, item.id);
            openRequest(item, { collection: c.id, folder: found?.parent?.id ?? null, saved: true });
          }
          break;
        case 'curl':
          if (item && item.type !== 'folder' && item.type !== 'ws') {
            const found = findItem(c.items, item.id);
            try {
              const text = await host.call<string>(ID, { op: 'exportCurl', project, request: item, context: { environment: env, collection: c.id, folder: found?.parent?.id ?? null } });
              await host.app.clipboardWrite({ text });
              host.app.toast('Copied as cURL');
            } catch (e) {
              host.app.toast((e as Error).message, { error: true });
            }
          }
          break;
      }
    },
    environment: async (action) => {
      if (action === 'new') {
        const name = await host.ui.prompt({ title: 'New environment', label: 'Name', value: '' });
        if (!name?.trim()) return;
        const e: Environment = { id: newId(), name: name.trim(), vars: [] };
        await saveEnvironment(e);
        setEnv(e.id);
        openPanel({ key: newId(), kind: 'environment', id: e.id });
      } else if (action === 'edit' && env) openPanel({ key: newId(), kind: 'environment', id: env });
      else if (action === 'duplicate' && activeEnv) {
        const e = { ...structuredClone(activeEnv), id: newId(), name: `${activeEnv.name} copy` };
        await saveEnvironment(e);
        setEnv(e.id);
      } else if (action === 'delete' && activeEnv) {
        if (!(await host.ui.confirm({ title: 'Delete the environment?', message: `“${activeEnv.name}” and its variables go, secrets too.`, confirm: 'Delete', destructive: true }))) return;
        setEnv(null);
        setState((s) => ({ ...s, environments: s.environments.filter((x) => x.id !== activeEnv.id) }));
        await host.call(ID, { op: 'removeEnvironment', project, id: activeEnv.id }).catch((e: Error) => host.app.toast(e.message, { error: true }));
      }
    },
  };

  return { save, ops };
}
