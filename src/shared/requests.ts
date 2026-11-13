// A request, as it's edited and kept: an HTTP one (or an event stream's),
// or a WebSocket's, with its params, headers, body, auth and settings; and
// how to make a new one, or read one back whole from a file.

/** A row of a key/value table (params, headers, a form, variables). */
export interface KV {
  key: string;
  value: string;
  enabled: boolean;
}

/** A multipart field: text, or a file on the server (its path in `value`). */
export interface FormField extends KV {
  type: 'text' | 'file';
}

export type BodyKind = 'none' | 'json' | 'text' | 'urlencoded' | 'multipart' | 'binary' | 'graphql';
export type TextType = 'text' | 'xml' | 'html' | 'javascript';

export const TEXT_TYPES: Record<TextType, { name: string; mime: string }> = {
  text: { name: 'Text', mime: 'text/plain' },
  xml: { name: 'XML', mime: 'application/xml' },
  html: { name: 'HTML', mime: 'text/html' },
  javascript: { name: 'JavaScript', mime: 'application/javascript' },
};

export interface Body {
  kind: BodyKind;
  /** JSON or text. */
  text: string;
  textType: TextType;
  form: KV[];
  multipart: FormField[];
  /** A binary body: a file on the server. */
  file: string;
  graphql: { query: string; variables: string };
}

export type AuthKind = 'inherit' | 'none' | 'bearer' | 'basic' | 'apikey';

export interface Auth {
  kind: AuthKind;
  token: string;
  username: string;
  password: string;
  /** An API key's name and value, and where it goes. */
  key: string;
  value: string;
  in: 'header' | 'query';
}

export interface HttpSettings {
  /** The whole exchange, in ms (0: no limit). */
  timeout: number;
  followRedirects: boolean;
  /** Send even when the server's certificate isn't trusted. */
  insecure: boolean;
}

/** An HTTP request, or (`sse`) one whose answer is an event stream. */
export interface HttpRequest {
  id: string;
  type: 'http' | 'sse';
  name: string;
  method: string;
  /** With its query: the enabled params are in it. */
  url: string;
  /** Every param row, the disabled ones too (the URL has only the
   * enabled). */
  params: KV[];
  headers: KV[];
  body: Body;
  auth: Auth;
  settings: HttpSettings;
}

/** A message kept with a WebSocket request, sent with a click. */
export interface Template {
  id: string;
  name: string;
  data: string;
  format: MessageFormat;
}

export type MessageFormat = 'text' | 'json' | 'hex' | 'base64';

export interface WsRequest {
  id: string;
  type: 'ws';
  name: string;
  url: string;
  params: KV[];
  headers: KV[];
  /** Subprotocols, comma-separated. */
  protocols: string;
  auth: Auth;
  insecure: boolean;
  reconnect: boolean;
  templates: Template[];
}

export type Request = HttpRequest | WsRequest;

export const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];

export function newId(): string {
  const b = new Uint8Array(8);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

export function emptyAuth(kind: AuthKind = 'inherit'): Auth {
  return { kind, token: '', username: '', password: '', key: '', value: '', in: 'header' };
}

export function emptyBody(): Body {
  return { kind: 'none', text: '', textType: 'text', form: [], multipart: [], file: '', graphql: { query: '', variables: '' } };
}

export function newHttp(o: Partial<HttpRequest> = {}): HttpRequest {
  return {
    id: newId(),
    type: 'http',
    name: 'New request',
    method: 'GET',
    url: '',
    params: [],
    headers: [],
    body: emptyBody(),
    auth: emptyAuth(),
    settings: { timeout: 30_000, followRedirects: true, insecure: false },
    ...o,
  };
}

export function newWs(o: Partial<WsRequest> = {}): WsRequest {
  return { id: newId(), type: 'ws', name: 'New WebSocket', url: '', params: [], headers: [], protocols: '', auth: emptyAuth(), insecure: false, reconnect: false, templates: [], ...o };
}

/** A request read from anywhere (a file, an older version), with what it
 * lacks filled in. */
export function normalizeRequest(r: Partial<Request> & { type?: string }): Request {
  if (r.type === 'ws') {
    const w = r as Partial<WsRequest>;
    const base = newWs();
    return {
      ...base,
      ...w,
      type: 'ws',
      id: String(w.id || base.id),
      params: rows(w.params),
      headers: rows(w.headers),
      auth: { ...emptyAuth(), ...(w.auth ?? {}) },
      templates: Array.isArray(w.templates) ? w.templates.map((t) => ({ id: String(t.id || newId()), name: String(t.name ?? ''), data: String(t.data ?? ''), format: t.format ?? 'text' })) : [],
    };
  }
  const h = r as Partial<HttpRequest>;
  const base = newHttp();
  return {
    ...base,
    ...h,
    type: h.type === 'sse' ? 'sse' : 'http',
    id: String(h.id || base.id),
    method: String(h.method || 'GET').toUpperCase(),
    params: rows(h.params),
    headers: rows(h.headers),
    body: { ...emptyBody(), ...(h.body ?? {}), form: rows(h.body?.form), multipart: rows(h.body?.multipart).map((f) => ({ ...f, type: (f as FormField).type === 'file' ? 'file' : 'text' })) as FormField[], graphql: { query: '', variables: '', ...(h.body?.graphql ?? {}) } },
    auth: { ...emptyAuth(), ...(h.auth ?? {}) },
    settings: { ...base.settings, ...(h.settings ?? {}) },
  };
}

/** Rows read from a file, each with a key, a value and whether it's on. */
export function rows<T extends KV>(list: unknown): T[] {
  if (!Array.isArray(list)) return [];
  return list.map((r) => ({ ...(r as T), key: String((r as KV)?.key ?? ''), value: String((r as KV)?.value ?? ''), enabled: (r as KV)?.enabled !== false }));
}
