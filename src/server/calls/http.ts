// Sending an HTTP request (it goes in the history, its body is kept a
// while for saving), and a sent body, as a stream to save.

import { Readable } from 'node:stream';
import { PluginError } from '@hyperpane/sdk/server';
import { type HistoryEntry, type HttpRequest, type Response, newId } from '../../shared/index.ts';
import { prepare, send } from '../http/index.ts';
import { type Deps, type Group, context, httpOf, projectOf } from './context.ts';

/** Bodies kept for saving: the last few, up to this many bytes in all. */
const KEEP_BODIES = 200 * 1024 * 1024;

export function httpCalls(d: Deps): Group {
  const { host, store } = d;
  const bodies = new Map<string, { bytes: Uint8Array; name: string; type: string }>();

  function keep(r: Response) {
    const name = (new URL(r.url).pathname.split('/').filter(Boolean).pop() || 'response').replace(/[^\w.-]+/g, '_');
    bodies.set(r.id, { bytes: r.body, name, type: r.contentType });
    let total = 0;
    for (const [id, b] of [...bodies].reverse()) {
      total += b.bytes.length;
      if (total > KEEP_BODIES) bodies.delete(id);
    }
  }

  async function remember(project: string | null, request: HttpRequest, r: { url: string; status: number | null; statusText: string; time: number; size: number; error: string | null }) {
    if (!project) return;
    // Long bodies are cut in the history: it's for finding a request
    // again, and stays small.
    const cut = (s: string) => (s.length > 100_000 ? s.slice(0, 100_000) : s);
    const entry: HistoryEntry = { id: newId(), at: Date.now(), request: { ...request, body: { ...request.body, text: cut(request.body.text) } }, ...r };
    await store.addHistory(project, entry).catch((e) => host.log(`The history couldn’t be written: ${(e as Error).message}`));
  }

  return {
    calls: {
      send: async ({ project, request, context: ctx }, { signal }) => {
        const p0 = projectOf(project);
        const r = httpOf(request);
        const t0 = Date.now();
        let url = r.url;
        try {
          const { vars, auth, base } = await context(d, p0, r, ctx);
          const prepared = await prepare(r, vars, auth, base);
          url = prepared.url.href;
          const res = await send(prepared, signal);
          keep(res);
          await remember(p0, r, { url: res.url, status: res.status, statusText: res.statusText, time: res.timings.total, size: res.size, error: null });
          return res;
        } catch (e) {
          const err = e instanceof PluginError ? e : new PluginError((e as Error).message);
          if (!signal.aborted) await remember(p0, r, { url, status: null, statusText: '', time: Date.now() - t0, size: 0, error: err.message });
          throw err;
        }
      },

      // A response's body, for the app to save to a file.
      body: ({ id }) => {
        const b = bodies.get(String(id));
        if (!b) throw new PluginError('That response isn’t kept any more: send the request again to save it.');
        return { name: b.name, size: b.bytes.length, data: Readable.from([Buffer.from(b.bytes.buffer, b.bytes.byteOffset, b.bytes.length)]) };
      },
    },
  };
}
