// Postman's files, both ways: a Collection v2.1 (v2.0 reads the same) as a
// collection, and an environment as one. Scripts and tests aren't kept:
// there's nothing here to run them.

import {
  type Auth,
  type Collection,
  type Environment,
  type FormField,
  type HttpRequest,
  type Item,
  type KV,
  type TextType,
  type WsRequest,
  emptyAuth,
  newCollection,
  newFolder,
  newHttp,
  newId,
  newWs,
} from './index.ts';
import { queryOf } from './vars.ts';

type Any = Record<string, any>;

const str = (v: unknown) => (v === undefined || v === null ? '' : typeof v === 'string' ? v : JSON.stringify(v));

function authOf(a: Any | undefined | null, inherit: Auth['kind']): Auth {
  if (!a || typeof a !== 'object') return emptyAuth(inherit);
  const kv = (list: unknown): Record<string, string> => {
    const out: Record<string, string> = {};
    if (Array.isArray(list)) for (const p of list) out[String(p?.key)] = str(p?.value);
    else if (list && typeof list === 'object') for (const [k, v] of Object.entries(list)) out[k] = str(v);
    return out;
  };
  switch (a.type) {
    case 'noauth':
      return emptyAuth('none');
    case 'bearer':
      return { ...emptyAuth('bearer'), token: kv(a.bearer).token ?? '' };
    case 'basic': {
      const b = kv(a.basic);
      return { ...emptyAuth('basic'), username: b.username ?? '', password: b.password ?? '' };
    }
    case 'apikey': {
      const k = kv(a.apikey);
      return { ...emptyAuth('apikey'), key: k.key ?? '', value: k.value ?? '', in: k.in === 'query' ? 'query' : 'header' };
    }
    default:
      return emptyAuth(inherit);
  }
}

function rowsOf(list: unknown): KV[] {
  if (!Array.isArray(list)) return [];
  return list.filter((p) => p && typeof p === 'object').map((p) => ({ key: str(p.key), value: str(p.value), enabled: !p.disabled }));
}

function urlOf(u: unknown): { url: string; params: KV[] } {
  if (typeof u === 'string') return { url: u, params: queryOf(u) };
  if (!u || typeof u !== 'object') return { url: '', params: [] };
  const o = u as Any;
  let url = str(o.raw);
  if (!url) {
    const host = Array.isArray(o.host) ? o.host.join('.') : str(o.host);
    const path = Array.isArray(o.path) ? o.path.join('/') : str(o.path);
    url = `${o.protocol ? `${o.protocol}://` : ''}${host}${o.port ? `:${o.port}` : ''}${path ? `/${path}` : ''}`;
  }
  const query = rowsOf(o.query);
  if (!query.length) return { url, params: queryOf(url) };
  // The raw URL has the enabled ones; the disabled stay in the table.
  return { url, params: [...queryOf(url), ...query.filter((q) => !q.enabled)] };
}

function requestOf(item: Any): HttpRequest | WsRequest {
  const req = (typeof item.request === 'string' ? { url: item.request, method: 'GET' } : item.request) as Any;
  const { url, params } = urlOf(req.url);
  const name = str(item.name) || url || 'Request';
  if (/^wss?:\/\//i.test(url)) return newWs({ name, url, params, headers: rowsOf(req.header), auth: authOf(req.auth, 'inherit') });
  const r = newHttp({ name, method: str(req.method || 'GET').toUpperCase(), url, params, headers: rowsOf(req.header), auth: authOf(req.auth, 'inherit') });
  const body = req.body as Any | undefined;
  if (body && !body.disabled) {
    const b = r.body;
    switch (body.mode) {
      case 'raw': {
        const lang = String(body.options?.raw?.language ?? '').toLowerCase();
        b.text = str(body.raw);
        const ct = r.headers.find((h) => h.key.toLowerCase() === 'content-type')?.value.toLowerCase() ?? '';
        if (lang === 'json' || (!lang && ct.includes('json'))) b.kind = 'json';
        else {
          b.kind = 'text';
          b.textType = (['xml', 'html', 'javascript'].includes(lang) ? lang : ct.includes('xml') ? 'xml' : ct.includes('html') ? 'html' : 'text') as TextType;
        }
        break;
      }
      case 'urlencoded':
        b.kind = 'urlencoded';
        b.form = rowsOf(body.urlencoded);
        break;
      case 'formdata':
        b.kind = 'multipart';
        b.multipart = (Array.isArray(body.formdata) ? body.formdata : []).map(
          (f: Any): FormField =>
            f.type === 'file'
              ? { key: str(f.key), value: Array.isArray(f.src) ? str(f.src[0]) : str(f.src), enabled: !f.disabled, type: 'file' }
              : { key: str(f.key), value: str(f.value), enabled: !f.disabled, type: 'text' },
        );
        break;
      case 'file':
        b.kind = 'binary';
        b.file = str(body.file?.src);
        break;
      case 'graphql':
        b.kind = 'graphql';
        b.graphql = { query: str(body.graphql?.query), variables: typeof body.graphql?.variables === 'string' ? body.graphql.variables : body.graphql?.variables ? JSON.stringify(body.graphql.variables, null, 2) : '' };
        break;
    }
  }
  return r;
}

function itemsOf(list: unknown): Item[] {
  if (!Array.isArray(list)) return [];
  const out: Item[] = [];
  for (const i of list) {
    if (!i || typeof i !== 'object') continue;
    if (Array.isArray(i.item)) {
      const f = newFolder(str(i.name) || 'Folder');
      f.items = itemsOf(i.item);
      f.auth = authOf(i.auth, 'inherit');
      out.push(f);
    } else if (i.request !== undefined) out.push(requestOf(i));
  }
  return out;
}

/** Whether a parsed file is a Postman environment (not a collection). */
export function isPostmanEnvironment(v: unknown): boolean {
  const o = v as Any;
  return !!o && typeof o === 'object' && Array.isArray(o.values) && !o.item;
}

/** A Postman collection (v2.0 or v2.1) as a collection. Throws when it
 * isn't one. */
export function fromPostman(v: unknown): Collection {
  const o = v as Any;
  if (!o || typeof o !== 'object' || !Array.isArray(o.item)) {
    if (o?.info?.schema && /v1/.test(String(o.info.schema))) throw new Error('That’s a Postman v1 collection: export it again from Postman as Collection v2.1.');
    throw new Error('That isn’t a Postman collection: it has no “item” list.');
  }
  const c = newCollection(str(o.info?.name) || 'Imported');
  c.items = itemsOf(o.item);
  c.variables = rowsOf(o.variable);
  c.auth = authOf(o.auth, 'none');
  return c;
}

/** A Postman environment as one. */
export function fromPostmanEnvironment(v: unknown): Environment {
  const o = v as Any;
  if (!isPostmanEnvironment(o)) throw new Error('That isn’t a Postman environment: it has no “values” list.');
  return {
    id: newId(),
    name: str(o.name) || 'Imported',
    vars: (o.values as Any[]).map((x) => ({ key: str(x?.key), value: str(x?.value), enabled: x?.enabled !== false, secret: x?.type === 'secret' })),
  };
}

const kvOut = (list: KV[]) => list.map((p) => ({ key: p.key, value: p.value, ...(p.enabled ? {} : { disabled: true }) }));

function authOut(a: Auth): Any | undefined {
  switch (a.kind) {
    case 'none':
      return { type: 'noauth' };
    case 'bearer':
      return { type: 'bearer', bearer: [{ key: 'token', value: a.token, type: 'string' }] };
    case 'basic':
      return { type: 'basic', basic: [{ key: 'username', value: a.username, type: 'string' }, { key: 'password', value: a.password, type: 'string' }] };
    case 'apikey':
      return { type: 'apikey', apikey: [{ key: 'key', value: a.key, type: 'string' }, { key: 'value', value: a.value, type: 'string' }, { key: 'in', value: a.in, type: 'string' }] };
    default:
      return undefined;
  }
}

function itemOut(i: Item): Any {
  if (i.type === 'folder') return { name: i.name, item: i.items.map(itemOut), ...(authOut(i.auth) ? { auth: authOut(i.auth) } : {}) };
  const url = { raw: i.url, query: kvOut(i.params) };
  if (i.type === 'ws') return { name: i.name, request: { method: 'GET', header: kvOut(i.headers), url } };
  const b = i.body;
  let body: Any | undefined;
  switch (b.kind) {
    case 'json':
      body = { mode: 'raw', raw: b.text, options: { raw: { language: 'json' } } };
      break;
    case 'text':
      body = { mode: 'raw', raw: b.text, options: { raw: { language: b.textType === 'text' ? 'text' : b.textType } } };
      break;
    case 'urlencoded':
      body = { mode: 'urlencoded', urlencoded: kvOut(b.form) };
      break;
    case 'multipart':
      body = { mode: 'formdata', formdata: b.multipart.map((f) => (f.type === 'file' ? { key: f.key, src: f.value, type: 'file', ...(f.enabled ? {} : { disabled: true }) } : { key: f.key, value: f.value, type: 'text', ...(f.enabled ? {} : { disabled: true }) })) };
      break;
    case 'binary':
      body = { mode: 'file', file: { src: b.file } };
      break;
    case 'graphql':
      body = { mode: 'graphql', graphql: { query: b.graphql.query, variables: b.graphql.variables } };
      break;
  }
  return { name: i.name, request: { method: i.method, header: kvOut(i.headers), url, ...(body ? { body } : {}), ...(authOut(i.auth) ? { auth: authOut(i.auth) } : {}) } };
}

/** A collection as a Postman Collection v2.1 file's JSON. */
export function toPostman(c: Collection): Any {
  return {
    info: { name: c.name, schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' },
    item: c.items.map(itemOut),
    variable: c.variables.map((v) => ({ key: v.key, value: v.value, ...(v.enabled ? {} : { disabled: true }) })),
    ...(authOut(c.auth) ? { auth: authOut(c.auth) } : {}),
  };
}

