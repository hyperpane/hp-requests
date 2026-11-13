// A request as the cURL command that sends it.

import { type Auth, type HttpRequest, type KV, TEXT_TYPES } from '../index.ts';
import { shellQuote } from './words.ts';

/** An enabled header by name, any case. */
export const header = (list: KV[], name: string) => list.find((h) => h.enabled && h.key.toLowerCase() === name.toLowerCase());

/** The command that sends the request (its variables already filled in),
 * one option a line. */
export function toCurl(r: HttpRequest, auth: Auth = r.auth): string {
  const headers = r.headers.filter((h) => h.enabled && h.key);
  let url = r.url;
  if (auth.kind === 'bearer' && !header(headers, 'authorization')) headers.push({ key: 'Authorization', value: `Bearer ${auth.token}`, enabled: true });
  if (auth.kind === 'apikey' && auth.key) {
    if (auth.in === 'query') url += `${url.includes('?') ? '&' : '?'}${encodeURIComponent(auth.key)}=${encodeURIComponent(auth.value)}`;
    else if (!header(headers, auth.key)) headers.push({ key: auth.key, value: auth.value, enabled: true });
  }
  const b = r.body;
  const contentType = (mime: string) => {
    if (!header(headers, 'content-type')) headers.push({ key: 'Content-Type', value: mime, enabled: true });
  };
  const data: string[] = [];
  switch (b.kind) {
    case 'json':
      contentType('application/json');
      data.push('--data-raw', shellQuote(b.text));
      break;
    case 'text':
      contentType(TEXT_TYPES[b.textType]?.mime ?? 'text/plain');
      data.push('--data-raw', shellQuote(b.text));
      break;
    case 'graphql': {
      contentType('application/json');
      data.push('--data-raw', shellQuote(graphqlBody(b.graphql.query, b.graphql.variables)));
      break;
    }
    case 'urlencoded':
      for (const f of b.form) if (f.enabled && f.key) data.push('--data-urlencode', shellQuote(`${f.key}=${f.value}`));
      break;
    case 'multipart':
      for (const f of b.multipart) if (f.enabled && f.key) data.push('-F', shellQuote(f.type === 'file' ? `${f.key}=@${f.value}` : `${f.key}=${f.value}`));
      break;
    case 'binary':
      if (b.file) data.push('--data-binary', shellQuote(`@${b.file}`));
      break;
  }
  const method = r.method.toUpperCase();
  const implied = data.length ? 'POST' : 'GET';
  // One option (with its value) a line, as people paste them.
  const lines: string[] = [];
  if (method === 'HEAD' && !data.length) lines.push('--head');
  else if (method !== implied) lines.push(`-X ${method}`);
  lines.push(shellQuote(url));
  for (const h of headers) lines.push(`-H ${shellQuote(`${h.key}: ${h.value}`)}`);
  if (auth.kind === 'basic') lines.push(`-u ${shellQuote(`${auth.username}:${auth.password}`)}`);
  for (let i = 0; i < data.length; i += 2) lines.push(`${data[i]} ${data[i + 1]}`);
  if (r.settings.followRedirects) lines.push('-L');
  if (r.settings.insecure) lines.push('-k');
  return `curl ${lines.join(' \\\n  ')}`;
}

/** A GraphQL request's JSON: the query, and its variables when they're
 * JSON (as text when they aren't, so the server says what's wrong). */
export function graphqlBody(query: string, variables: string): string {
  const v = variables.trim();
  if (!v) return JSON.stringify({ query });
  try {
    return JSON.stringify({ query, variables: JSON.parse(v) });
  } catch {
    return `{"query":${JSON.stringify(query)},"variables":${v}}`;
  }
}
