// A request made ready to go: its variables filled in, its auth applied,
// its headers defaulted, and its body made (JSON, text, a form, multipart
// with files, a file, GraphQL).

import { randomBytes } from 'node:crypto';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { PluginError } from '@hyperpane/sdk/server';
import { graphqlBody } from '../../shared/curl/index.ts';
import { type Auth, type HttpRequest, type HttpSettings, type KV, TEXT_TYPES } from '../../shared/index.ts';
import { substitute } from '../../shared/vars.ts';
import { ENCODINGS } from './decode.ts';
import { filePath, parseUrl } from './url.ts';

/** The most of a body that's read (after decompression): 50 MB. */
export const MAX_BODY = 50 * 1024 * 1024;
export const MAX_REDIRECTS = 10;
export const USER_AGENT = 'hyperpane-requests/0.0.1';

/** What's sent: a file is read as it goes. */
export type Part = Uint8Array | { file: string; size: number };

export interface Prepared {
  method: string;
  url: URL;
  headers: [string, string][];
  body: Part[] | null;
  settings: HttpSettings;
  unresolved: string[];
}

const encoder = new TextEncoder();
const enabled = <T extends KV>(rows: T[]) => rows.filter((r) => r.enabled && r.key);
/** Whether a header is there, any case. */
export const has = (headers: [string, string][], name: string) => headers.some(([k]) => k.toLowerCase() === name.toLowerCase());

async function fileOf(p: string, base: string | null): Promise<{ file: string; size: number }> {
  const file = filePath(p, base);
  try {
    const s = await stat(file);
    if (!s.isFile()) throw new PluginError(`${file} isn’t a file.`);
    return { file, size: s.size };
  } catch (e) {
    if (e instanceof PluginError) throw e;
    const code = (e as NodeJS.ErrnoException).code;
    throw new PluginError(`Couldn’t read ${file}: ${code === 'ENOENT' ? 'there’s no such file' : code === 'EACCES' ? 'permission denied' : (e as Error).message}.`);
  }
}

/** Headers for an auth (and a query param, for an API key in the query). */
export function applyAuth(auth: Auth, headers: [string, string][], url: URL, fill: (s: string) => string): void {
  switch (auth.kind) {
    case 'bearer':
      if (!has(headers, 'authorization')) headers.push(['Authorization', `Bearer ${fill(auth.token)}`]);
      break;
    case 'basic':
      if (!has(headers, 'authorization')) headers.push(['Authorization', `Basic ${Buffer.from(`${fill(auth.username)}:${fill(auth.password)}`).toString('base64')}`]);
      break;
    case 'apikey': {
      const key = fill(auth.key);
      if (!key) break;
      if (auth.in === 'query') url.searchParams.append(key, fill(auth.value));
      else if (!has(headers, key)) headers.push([key, fill(auth.value)]);
      break;
    }
  }
}

/** The request with its variables filled in, its auth applied, and its
 * body made: ready to go. `base` is the project's folder, for files. */
export async function prepare(r: HttpRequest, vars: Map<string, string>, auth: Auth, base: string | null): Promise<Prepared> {
  const missing = new Set<string>();
  const fill = (s: string) => substitute(s, vars, missing);
  const urlText = fill(r.url);
  // Auth, headers and the body are filled first, so every unresolved name
  // is known before the URL is checked.
  const headers: [string, string][] = enabled(r.headers).map((h) => [fill(h.key).trim(), fill(h.value)]);
  const b = r.body;
  let body: Part[] | null = null;
  const type = (mime: string) => {
    if (!has(headers, 'content-type')) headers.push(['Content-Type', mime]);
  };
  switch (b.kind) {
    case 'json':
      type('application/json');
      body = [encoder.encode(fill(b.text))];
      break;
    case 'text':
      type(TEXT_TYPES[b.textType]?.mime ?? 'text/plain');
      body = [encoder.encode(fill(b.text))];
      break;
    case 'graphql':
      type('application/json');
      body = [encoder.encode(graphqlBody(fill(b.graphql.query), fill(b.graphql.variables)))];
      break;
    case 'urlencoded': {
      type('application/x-www-form-urlencoded');
      const p = new URLSearchParams();
      for (const f of enabled(b.form)) p.append(fill(f.key), fill(f.value));
      body = [encoder.encode(p.toString())];
      break;
    }
    case 'multipart': {
      const boundary = `----hyperpane${randomBytes(12).toString('hex')}`;
      type(`multipart/form-data; boundary=${boundary}`);
      const parts: Part[] = [];
      const q = (s: string) => s.replace(/"/g, '%22').replace(/\r?\n/g, ' ');
      for (const f of enabled(b.multipart)) {
        const name = fill(f.key);
        if (f.type === 'file') {
          const file = await fileOf(fill(f.value), base);
          parts.push(encoder.encode(`--${boundary}\r\nContent-Disposition: form-data; name="${q(name)}"; filename="${q(path.basename(file.file))}"\r\nContent-Type: ${mimeOf(file.file)}\r\n\r\n`));
          parts.push(file);
          parts.push(encoder.encode('\r\n'));
        } else parts.push(encoder.encode(`--${boundary}\r\nContent-Disposition: form-data; name="${q(name)}"\r\n\r\n${fill(f.value)}\r\n`));
      }
      parts.push(encoder.encode(`--${boundary}--\r\n`));
      body = parts;
      break;
    }
    case 'binary':
      type(mimeOf(b.file));
      body = [await fileOf(fill(b.file), base)];
      break;
  }
  const url = parseUrl(urlText, ['http:', 'https:'], [...missing]);
  applyAuth(auth, headers, url, fill);
  if (!has(headers, 'user-agent')) headers.push(['User-Agent', USER_AGENT]);
  if (!has(headers, 'accept')) headers.push(['Accept', '*/*']);
  if (!has(headers, 'accept-encoding')) headers.push(['Accept-Encoding', ENCODINGS.join(', ')]);
  return { method: (r.method.trim() || 'GET').toUpperCase(), url, headers, body, settings: r.settings, unresolved: [...missing] };
}

const MIME: Record<string, string> = {
  '.json': 'application/json', '.txt': 'text/plain', '.html': 'text/html', '.xml': 'application/xml', '.csv': 'text/csv', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.pdf': 'application/pdf', '.zip': 'application/zip', '.js': 'application/javascript',
};
export const mimeOf = (file: string) => MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
