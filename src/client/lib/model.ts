// Open tabs, and changes to a collection's tree: what the window edits
// before it saves.

import { type Collection, type Folder, type Item, type Request, newHttp, newId, newWs } from '../../shared/index.ts';

/** An open tab: a request (in a collection or not yet), a collection's or
 * folder's settings, or an environment. */
export type Tab =
  | { key: string; kind: 'request'; request: Request; saved: string | null; collection: string | null; folder: string | null }
  | { key: string; kind: 'settings'; collection: string; folder: string | null }
  | { key: string; kind: 'environment'; id: string };

/** A request's text for comparing: what's different from the saved one
 * makes it unsaved. */
export const snapshot = (r: Request) => JSON.stringify(r);

export const dirty = (t: Tab) => t.kind === 'request' && t.saved !== snapshot(t.request);

export function tabName(t: Tab, collections: Collection[], envName: (id: string) => string): string {
  if (t.kind === 'request') return t.request.name || 'Untitled';
  if (t.kind === 'environment') return envName(t.id);
  const c = collections.find((x) => x.id === t.collection);
  if (!c) return 'Settings';
  if (!t.folder) return c.name;
  return findItem(c.items, t.folder)?.item.name ?? c.name;
}

export function findItem(items: Item[], id: string, parent: Folder | null = null): { item: Item; parent: Folder | null } | null {
  for (const i of items) {
    if (i.id === id) return { item: i, parent };
    if (i.type === 'folder') {
      const f = findItem(i.items, id, i);
      if (f) return f;
    }
  }
  return null;
}

/** The tree with `id` changed by `fn` (null removes it). */
export function mapItem(items: Item[], id: string, fn: (i: Item) => Item | null): Item[] {
  const out: Item[] = [];
  for (const i of items) {
    if (i.id === id) {
      const next = fn(i);
      if (next) out.push(next);
    } else if (i.type === 'folder') out.push({ ...i, items: mapItem(i.items, id, fn) });
    else out.push(i);
  }
  return out;
}

/** The tree with `item` added at the end of a folder (null: the top). */
export function addItem(items: Item[], folder: string | null, item: Item): Item[] {
  if (!folder) return [...items, item];
  return mapItem(items, folder, (f) => (f.type === 'folder' ? { ...f, items: [...f.items, item] } : f));
}

/** The tree with `item` put right after `after`. */
export function insertAfter(items: Item[], after: string, item: Item): Item[] {
  const out: Item[] = [];
  for (const i of items) {
    out.push(i.type === 'folder' ? { ...i, items: insertAfter(i.items, after, item) } : i);
    if (i.id === after) out.push(item);
  }
  return out;
}

/** A copy with new ids all through. */
export function copyItem<T extends Item>(i: T, rename = true): T {
  const name = rename ? `${i.name} copy` : i.name;
  if (i.type === 'folder') return { ...i, id: newId(), name, items: i.items.map((x) => copyItem(x, false)) } as T;
  return { ...structuredClone(i), id: newId(), name } as T;
}

export function copyCollection(c: Collection): Collection {
  return { ...structuredClone(c), id: newId(), name: `${c.name} copy`, items: c.items.map((x) => copyItem(x, false)) };
}

/** How many requests a tree has. */
export const countRequests = (items: Item[]): number => items.reduce((n, i) => n + (i.type === 'folder' ? countRequests(i.items) : 1), 0);

/** What a search keeps: requests whose name, URL or method has it, and
 * the folders on the way to them. */
export function filterItems(items: Item[], q: string): Item[] {
  if (!q) return items;
  const s = q.toLowerCase();
  const out: Item[] = [];
  for (const i of items) {
    if (i.type === 'folder') {
      const inner = i.name.toLowerCase().includes(s) ? i.items : filterItems(i.items, q);
      if (inner.length) out.push({ ...i, items: inner });
    } else if (`${i.name} ${i.url} ${i.type === 'ws' ? 'ws' : i.method}`.toLowerCase().includes(s)) out.push(i);
  }
  return out;
}

export const methodOf = (r: Request) => (r.type === 'ws' ? 'WS' : r.type === 'sse' ? 'SSE' : r.method);


/** A new request of a kind: http, ws or sse. */
export const newRequest = (kind: string): Request => (kind === 'ws' ? newWs() : kind === 'sse' ? newHttp({ type: 'sse', name: 'New event stream' }) : newHttp());
