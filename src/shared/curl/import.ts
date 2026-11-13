// A cURL command (as a browser's "Copy as cURL" or a README has it) as a
// request: its options read as curl reads them, and its body's kind told
// from its data and Content-Type.

import { type FormField, type HttpRequest, type KV, TEXT_TYPES, type TextType, emptyAuth, newHttp } from '../index.ts';
import { queryOf } from '../vars.ts';
import { header } from './export.ts';
import { shellWords } from './words.ts';

// curl's options that take a value (the rest are flags). Unknown ones are
// taken as flags.
const SHORT_WITH_VALUE = new Set('XHdFuAbeomwxTEcKCrUyYzQt'.split(''));
const LONG_WITH_VALUE = new Set([
  'request', 'header', 'data', 'data-ascii', 'data-raw', 'data-binary', 'data-urlencode', 'json', 'form', 'form-string', 'user', 'user-agent', 'cookie',
  'referer', 'output', 'max-time', 'write-out', 'proxy', 'upload-file', 'cert', 'key', 'cacert', 'capath', 'cookie-jar', 'config', 'continue-at', 'range',
  'proxy-user', 'speed-limit', 'speed-time', 'quote', 'telnet-option', 'connect-timeout', 'max-redirs', 'retry', 'retry-delay', 'retry-max-time',
  'resolve', 'connect-to', 'url', 'oauth2-bearer', 'interface', 'limit-rate', 'unix-socket', 'cert-type', 'key-type', 'pass', 'ciphers', 'dns-servers',
  'local-port', 'max-filesize', 'netrc-file', 'noproxy', 'pinnedpubkey', 'proto', 'proto-redir', 'trace', 'trace-ascii', 'expect100-timeout', 'aws-sigv4',
]);
const SHORT_LONG: Record<string, string> = {
  X: 'request', H: 'header', d: 'data', F: 'form', u: 'user', A: 'user-agent', b: 'cookie', e: 'referer', m: 'max-time', T: 'upload-file',
  k: 'insecure', L: 'location', I: 'head', G: 'get',
};

const formDecode = (s: string) => {
  try {
    return decodeURIComponent(s.replace(/\+/g, ' '));
  } catch {
    return s;
  }
};

/** A cURL command as a request. Throws with what's wrong when it isn't
 * one. */
export function fromCurl(command: string): HttpRequest {
  const words = shellWords(command.trim());
  if (words[0] === 'curl' || words[0]?.endsWith('/curl')) words.shift();
  if (!words.length) throw new Error('That isn’t a cURL command: it has no URL.');
  const opts: [string, string | true][] = [];
  const urls: string[] = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (w.startsWith('--') && w.length > 2) {
      const eq = w.indexOf('=');
      const name = eq > 0 ? w.slice(2, eq) : w.slice(2);
      if (LONG_WITH_VALUE.has(name)) opts.push([name, eq > 0 ? w.slice(eq + 1) : (words[++i] ?? '')]);
      else opts.push([name, true]);
    } else if (w.startsWith('-') && w.length > 1) {
      for (let j = 1; j < w.length; j++) {
        const c = w[j];
        const long = SHORT_LONG[c] ?? c;
        if (SHORT_WITH_VALUE.has(c)) {
          opts.push([long, j + 1 < w.length ? w.slice(j + 1) : (words[++i] ?? '')]);
          break;
        }
        opts.push([long, true]);
      }
    } else urls.push(w);
  }

  const r = newHttp({ name: '' });
  r.auth = emptyAuth('inherit');
  r.settings.followRedirects = true;
  let method: string | null = null;
  let get = false;
  let head = false;
  const raw: string[] = [];
  const encoded: KV[] = [];
  const form: FormField[] = [];
  let file: string | null = null;
  for (const [name, v] of opts) {
    const val = typeof v === 'string' ? v : '';
    switch (name) {
      case 'request':
        method = val.toUpperCase();
        break;
      case 'url':
        urls.unshift(val);
        break;
      case 'header': {
        const c = val.indexOf(':');
        if (c > 0) r.headers.push({ key: val.slice(0, c).trim(), value: val.slice(c + 1).trim(), enabled: true });
        else if (val.endsWith(';')) r.headers.push({ key: val.slice(0, -1).trim(), value: '', enabled: true });
        break;
      }
      case 'user-agent':
        r.headers.push({ key: 'User-Agent', value: val, enabled: true });
        break;
      case 'cookie':
        if (!val.includes('=')) break; // a cookie file
        r.headers.push({ key: 'Cookie', value: val, enabled: true });
        break;
      case 'referer':
        r.headers.push({ key: 'Referer', value: val, enabled: true });
        break;
      case 'data':
      case 'data-ascii':
      case 'data-binary':
        if (val.startsWith('@')) file = val.slice(1);
        else raw.push(name === 'data-binary' ? val : val.replace(/[\r\n]/g, ''));
        break;
      case 'data-raw':
        raw.push(val);
        break;
      case 'json':
        if (val.startsWith('@')) file = val.slice(1);
        else raw.push(val);
        if (!header(r.headers, 'content-type')) r.headers.push({ key: 'Content-Type', value: 'application/json', enabled: true });
        break;
      case 'data-urlencode': {
        // content, =content, name=content, @file, name@file
        const eq = val.indexOf('=');
        const at = val.indexOf('@');
        if (eq > 0 && (at < 0 || eq < at)) encoded.push({ key: val.slice(0, eq), value: val.slice(eq + 1), enabled: true });
        else if (eq === 0) encoded.push({ key: val.slice(1), value: '', enabled: true });
        else if (at > 0) encoded.push({ key: val.slice(0, at), value: `@${val.slice(at + 1)}`, enabled: true });
        else encoded.push({ key: val, value: '', enabled: true });
        break;
      }
      case 'form':
      case 'form-string': {
        const eq = val.indexOf('=');
        if (eq <= 0) break;
        const key = val.slice(0, eq);
        let value = val.slice(eq + 1);
        if (name === 'form' && (value.startsWith('@') || value.startsWith('<'))) {
          value = value.slice(1).replace(/;(type|filename|headers)=.*$/, '');
          form.push({ key, value, enabled: true, type: 'file' });
        } else form.push({ key, value, enabled: true, type: 'text' });
        break;
      }
      case 'user': {
        const c = val.indexOf(':');
        r.auth = { ...emptyAuth('basic'), username: c < 0 ? val : val.slice(0, c), password: c < 0 ? '' : val.slice(c + 1) };
        break;
      }
      case 'oauth2-bearer':
        r.auth = { ...emptyAuth('bearer'), token: val };
        break;
      case 'insecure':
        r.settings.insecure = true;
        break;
      case 'head':
        head = true;
        break;
      case 'get':
        get = true;
        break;
      case 'max-time': {
        const s = Number(val);
        if (s > 0) r.settings.timeout = Math.round(s * 1000);
        break;
      }
      case 'upload-file':
        file = val;
        method ??= 'PUT';
        break;
    }
  }
  let url = urls[0];
  if (!url) throw new Error('That cURL command has no URL.');
  const hasData = raw.length > 0 || encoded.length > 0 || form.length > 0 || file !== null;
  if (get && (raw.length || encoded.length)) {
    const q = [...raw, ...encoded.map((e) => `${encodeURIComponent(e.key)}=${encodeURIComponent(e.value)}`)].join('&');
    url += (url.includes('?') ? '&' : '?') + q;
    raw.length = 0;
    encoded.length = 0;
  }
  r.url = url;
  r.params = queryOf(url);
  r.method = method ?? (head ? 'HEAD' : hasData && !get ? 'POST' : 'GET');

  // Content-Type: the body's kind says it, so a header that only repeats
  // it goes (a browser's multipart one names a boundary that won't be
  // ours).
  const ct = header(r.headers, 'content-type')?.value.toLowerCase() ?? '';
  const dropType = () => (r.headers = r.headers.filter((h) => h.key.toLowerCase() !== 'content-type'));
  const b = r.body;
  if (form.length) {
    b.kind = 'multipart';
    b.multipart = form;
    if (ct.startsWith('multipart/form-data')) dropType();
  } else if (file !== null && !raw.length && !encoded.length) {
    b.kind = 'binary';
    b.file = file;
  } else if (encoded.length && !raw.length) {
    b.kind = 'urlencoded';
    b.form = encoded;
    if (ct.startsWith('application/x-www-form-urlencoded')) dropType();
  } else if (raw.length || encoded.length) {
    const text = [...raw, ...encoded.map((e) => `${encodeURIComponent(e.key)}=${encodeURIComponent(e.value)}`)].join('&');
    const json = (() => {
      try {
        const v = JSON.parse(text);
        return typeof v === 'object' && v !== null;
      } catch {
        return false;
      }
    })();
    if (ct.includes('json') || (!ct && json)) {
      const gql = ct.includes('json') && json ? graphqlOf(text) : null;
      if (gql) {
        b.kind = 'graphql';
        b.graphql = gql;
      } else {
        b.kind = 'json';
        b.text = text;
      }
      if (ct === 'application/json') dropType();
    } else if ((!ct || ct.startsWith('application/x-www-form-urlencoded')) && /^[^=&]+=[^&]*(&[^=&]+=[^&]*)*$/.test(text)) {
      b.kind = 'urlencoded';
      b.form = text.split('&').map((p) => {
        const i = p.indexOf('=');
        return { key: formDecode(p.slice(0, i)), value: formDecode(p.slice(i + 1)), enabled: true };
      });
      if (ct) dropType();
    } else {
      b.kind = 'text';
      b.text = text;
      const t = (Object.entries(TEXT_TYPES) as [TextType, { mime: string }][]).find(([, v]) => ct === v.mime);
      if (t) {
        b.textType = t[0];
        dropType();
      } else if (ct.includes('xml')) b.textType = 'xml';
      else if (ct.includes('html')) b.textType = 'html';
      else if (ct.includes('javascript')) b.textType = 'javascript';
    }
  }

  // A bearer token in a header is the request's auth.
  const authz = header(r.headers, 'authorization');
  if (authz && r.auth.kind === 'inherit' && /^Bearer\s+/i.test(authz.value)) {
    r.auth = { ...emptyAuth('bearer'), token: authz.value.replace(/^Bearer\s+/i, '') };
    r.headers = r.headers.filter((h) => h !== authz);
  }
  r.name = nameOf(r.method, url);
  return r;
}

/** A JSON body that's a GraphQL request ({query, variables?}). */
function graphqlOf(text: string): { query: string; variables: string } | null {
  try {
    const v = JSON.parse(text) as { query?: unknown; variables?: unknown };
    if (typeof v?.query !== 'string' || Object.keys(v).some((k) => !['query', 'variables', 'operationName'].includes(k))) return null;
    if (!/^\s*(query|mutation|subscription|fragment|\{)/.test(v.query)) return null;
    return { query: v.query, variables: v.variables === undefined || v.variables === null ? '' : JSON.stringify(v.variables, null, 2) };
  } catch {
    return null;
  }
}

/** A short name for a request: its method and path. */
export function nameOf(method: string, url: string): string {
  const path = url.replace(/^[a-z]+:\/\/[^/?#]*/i, '').split(/[?#]/)[0] || '/';
  return `${method} ${path}`.slice(0, 80);
}
