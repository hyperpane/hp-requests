// Collections (folders of requests, with their own variables and auth),
// environments, the history, and where a request's variables and
// inherited auth come from.

import { type Auth, type HttpRequest, type KV, type Request, emptyAuth, newId, normalizeRequest, rows } from './requests.ts';

export interface Folder {
  id: string;
  type: 'folder';
  name: string;
  items: Item[];
  auth: Auth;
}

export type Item = Folder | Request;

export interface Collection {
  id: string;
  name: string;
  items: Item[];
  variables: KV[];
  auth: Auth;
}

export interface EnvVar extends KV {
  /** Its value stays on this machine (the plugin's data folder), not in
   * the project. */
  secret: boolean;
}

export interface Environment {
  id: string;
  name: string;
  vars: EnvVar[];
}

/** Where a request's variables and inherited auth come from. */
export interface Context {
  environment?: string | null;
  collection?: string | null;
  /** The request's folder in that collection (null: at its top). */
  folder?: string | null;
}

export interface HistoryEntry {
  id: string;
  at: number;
  request: HttpRequest;
  /** The URL as it went (variables filled in). */
  url: string;
  status: number | null;
  statusText: string;
  time: number;
  size: number;
  error: string | null;
}

export interface State {
  collections?: Collection[];
  environments?: Environment[];
  history?: HistoryEntry[];
}

export const MAX_HISTORY = 300;

export function newFolder(name = 'New folder'): Folder {
  return { id: newId(), type: 'folder', name, items: [], auth: emptyAuth() };
}

export function newCollection(name = 'New collection'): Collection {
  return { id: newId(), name, items: [], variables: [], auth: emptyAuth('none') };
}

export function normalizeItem(i: Partial<Item> & { type?: string }): Item {
  if (i.type === 'folder') {
    const f = i as Partial<Folder>;
    return { id: String(f.id || newId()), type: 'folder', name: String(f.name ?? 'Folder'), items: (Array.isArray(f.items) ? f.items : []).map(normalizeItem), auth: { ...emptyAuth(), ...(f.auth ?? {}) } };
  }
  return normalizeRequest(i as Partial<Request>);
}

export function normalizeCollection(c: Partial<Collection>): Collection {
  return {
    id: String(c.id || newId()),
    name: String(c.name ?? 'Collection'),
    items: (Array.isArray(c.items) ? c.items : []).map(normalizeItem),
    variables: rows(c.variables),
    auth: { ...emptyAuth('none'), ...(c.auth ?? {}) },
  };
}

export function normalizeEnvironment(e: Partial<Environment>): Environment {
  return {
    id: String(e.id || newId()),
    name: String(e.name ?? 'Environment'),
    vars: (Array.isArray(e.vars) ? e.vars : []).map((v) => ({ key: String(v?.key ?? ''), value: String(v?.value ?? ''), enabled: v?.enabled !== false, secret: !!v?.secret })),
  };
}

/** Walks a tree of items: each with its parent folder (null at the top). */
export function* walk(items: Item[], parent: Folder | null = null): Generator<{ item: Item; parent: Folder | null }> {
  for (const item of items) {
    yield { item, parent };
    if (item.type === 'folder') yield* walk(item.items, item);
  }
}

/** The folders from the top down to `folder` (empty: the collection's
 * top). */
export function folderChain(c: Collection, folder: string | null | undefined): Folder[] {
  if (!folder) return [];
  const path: Folder[] = [];
  const find = (items: Item[]): boolean => {
    for (const i of items) {
      if (i.type !== 'folder') continue;
      path.push(i);
      if (i.id === folder || find(i.items)) return true;
      path.pop();
    }
    return false;
  };
  return find(c.items) ? path : [];
}

/** The auth that applies: the request's own, or the nearest folder's, or
 * the collection's. */
export function effectiveAuth(own: Auth, c: Collection | null, folder: string | null | undefined): Auth {
  if (own.kind !== 'inherit') return own;
  if (!c) return emptyAuth('none');
  const chain = folderChain(c, folder);
  for (let i = chain.length - 1; i >= 0; i--) if (chain[i].auth.kind !== 'inherit') return chain[i].auth;
  return c.auth.kind === 'inherit' ? emptyAuth('none') : c.auth;
}
