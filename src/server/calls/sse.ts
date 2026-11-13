// An event stream (Server-Sent Events): the request sent (its redirects
// followed), then its events as they're parsed, until it ends or the window
// stops listening.

import zlib from 'node:zlib';
import { type Out, PluginError } from '@hyperpane/sdk/server';
import type { Context, SseEvent } from '../../shared/index.ts';
import { exchange, nextHop, pairs, prepare, readBody } from '../http/index.ts';
import { SseParser } from '../sse.ts';
import { type Deps, type Group, context, httpOf, projectOf } from './context.ts';

export function sse(d: Deps): Group {
  async function runSse(req: { project?: unknown; request?: unknown; context?: Context }, out: Out) {
    const project = projectOf(req.project);
    const r = httpOf(req.request);
    const { vars, auth, base } = await context(d, project, r, req.context);
    const p = await prepare(r, vars, auth, base);
    if (!p.headers.some(([k]) => k.toLowerCase() === 'accept') || p.headers.some(([k, v]) => k.toLowerCase() === 'accept' && v === '*/*')) {
      p.headers = p.headers.filter(([k]) => k.toLowerCase() !== 'accept');
      p.headers.push(['Accept', 'text/event-stream']);
    }
    p.headers.push(['Cache-Control', 'no-cache']);
    let hop = { method: p.method, url: p.url, headers: p.headers, body: p.body };
    const deadline = p.settings.timeout > 0 ? performance.now() + p.settings.timeout : null;
    for (let i = 0; ; i++) {
      const ex = await exchange({ ...hop, insecure: p.settings.insecure, signal: out.signal, deadline, timeout: p.settings.timeout });
      const { res } = ex;
      const status = res.statusCode ?? 0;
      if (p.settings.followRedirects && [301, 302, 303, 307, 308].includes(status) && res.headers.location && i < 10) {
        res.resume();
        hop = nextHop(hop, status, res.headers.location);
        continue;
      }
      if (status < 200 || status >= 300) {
        const body = await readBody(res, 4000, out.signal, null).catch(() => null);
        const text = body ? Buffer.from(body.bytes).toString('utf8').trim().replace(/\s+/g, ' ').slice(0, 300) : '';
        throw new PluginError(`${hop.url.host} answered ${status} ${res.statusMessage ?? ''}${text ? `: ${text}` : '.'}`);
      }
      out.emit({ type: 'open', at: Date.now(), status, headers: pairs(res.rawHeaders) } satisfies SseEvent);
      const parser = new SseParser((e) => out.emit({ type: 'event', at: Date.now(), ...e } satisfies SseEvent));
      const enc = String(res.headers['content-encoding'] ?? '').toLowerCase();
      const stream: NodeJS.ReadableStream =
        enc === 'gzip' ? res.pipe(zlib.createGunzip({ finishFlush: zlib.constants.Z_SYNC_FLUSH })) : enc === 'br' ? res.pipe(zlib.createBrotliDecompress()) : enc === 'deflate' ? res.pipe(zlib.createInflate()) : res;
      out.signal.addEventListener('abort', () => res.destroy(), { once: true });
      try {
        for await (const chunk of stream) parser.push(chunk as Buffer);
      } catch (e) {
        if (out.signal.aborted) return;
        throw new PluginError(`The stream broke: ${(e as Error).message}`);
      }
      parser.end();
      if (!out.signal.aborted) out.emit({ type: 'end', at: Date.now(), message: 'The server ended the stream.' } satisfies SseEvent);
      return;
    }
  }

  return {
    subscriptions: {
      sse: (req, out) => runSse(req, out),
    },
  };
}
