// Sending a prepared request: its redirects followed (as its settings
// say), its answer read, and each phase timed (lookup, connect, TLS, first
// byte, download).

import { PluginError } from '@hyperpane/sdk/server';
import { type Hop, type Response, type Timings, newId } from '../../shared/index.ts';
import { readBody } from './decode.ts';
import { bodySize, exchange, pairs } from './exchange.ts';
import { MAX_BODY, MAX_REDIRECTS, type Part, type Prepared } from './request.ts';

const REDIRECTS = new Set([301, 302, 303, 307, 308]);

/** Where a redirect goes next, and how: 303 (and 301, 302 for a POST, as
 * browsers do) become GET without a body; 307 and 308 keep both. Auth and
 * cookies don't follow to another host. */
export function nextHop(cur: { method: string; url: URL; headers: [string, string][]; body: Part[] | null }, status: number, location: string) {
  const url = new URL(location, cur.url);
  let { method, body, headers } = cur;
  if (status === 303 || ((status === 301 || status === 302) && method === 'POST')) {
    if (method !== 'HEAD') method = 'GET';
    body = null;
    headers = headers.filter(([k]) => !['content-type', 'content-length', 'transfer-encoding'].includes(k.toLowerCase()));
  }
  if (url.host !== cur.url.host || url.protocol !== cur.url.protocol) headers = headers.filter(([k]) => !['authorization', 'cookie', 'host'].includes(k.toLowerCase()));
  return { method, url, headers, body };
}

/** Sends a prepared request, follows its redirects (as its settings say),
 * and reads the answer. */
export async function send(p: Prepared, signal?: AbortSignal, max = MAX_BODY): Promise<Response> {
  const t0 = performance.now();
  const deadline = p.settings.timeout > 0 ? t0 + p.settings.timeout : null;
  let hop = { method: p.method, url: p.url, headers: p.headers, body: p.body };
  const redirects: Hop[] = [];
  for (;;) {
    const ex = await exchange({ ...hop, insecure: p.settings.insecure, signal, deadline, timeout: p.settings.timeout });
    const { res } = ex;
    const status = res.statusCode ?? 0;
    const location = res.headers.location;
    if (p.settings.followRedirects && REDIRECTS.has(status) && location && hop.method !== 'CONNECT') {
      res.resume();
      redirects.push({ url: hop.url.href, status, statusText: res.statusMessage ?? '', location });
      if (redirects.length > MAX_REDIRECTS) throw new PluginError(`It redirected more than ${MAX_REDIRECTS} times (the last to ${location}): is it a loop?`);
      try {
        hop = nextHop(hop, status, location);
      } catch {
        throw new PluginError(`It redirected to “${location}”, which isn’t a URL.`);
      }
      continue;
    }
    const noBody = hop.method === 'HEAD' || status === 204 || status === 304 || (status >= 100 && status < 200);
    const read = noBody ? { bytes: Buffer.alloc(0), wire: 0, truncated: false, end: performance.now(), note: null } : await readBody(res, max, signal, deadline);
    if (noBody) res.resume();
    const m = ex.marks;
    const timings: Timings = {
      dns: m.lookup === null ? null : round(m.lookup - m.start),
      connect: m.connect === null ? null : round(m.connect - (m.lookup ?? m.start)),
      tls: m.tls === null || m.connect === null ? null : round(m.tls - m.connect),
      firstByte: round(m.response - (m.sent ?? m.tls ?? m.connect ?? m.start)),
      download: round(read.end - m.response),
      total: round(read.end - t0),
    };
    const headers = pairs(res.rawHeaders);
    if (read.note) headers.push(['X-Hyperpane-Note', read.note]);
    return {
      id: newId(),
      url: hop.url.href,
      method: hop.method,
      status,
      statusText: res.statusMessage ?? '',
      httpVersion: res.httpVersion,
      headers,
      body: new Uint8Array(read.bytes.buffer, read.bytes.byteOffset, read.bytes.length),
      wireSize: read.wire,
      size: read.bytes.length,
      truncated: read.truncated,
      contentType: String(res.headers['content-type'] ?? ''),
      timings,
      redirects,
      remote: ex.remote,
      tls: ex.tls,
      sent: { method: hop.method, url: hop.url.href, headers: ex.sentHeaders, bodySize: bodySize(hop.body) },
      unresolved: p.unresolved,
      at: Date.now(),
    };
  }
}

const round = (ms: number) => Math.max(0, Math.round(ms * 10) / 10);
