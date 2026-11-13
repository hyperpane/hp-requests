// WebSockets: each kept open (and opened again, when asked) while the
// window listens, by the id the window gives it; and sending, pinging and
// closing one by that id.

import { type Out, PluginError } from '@hyperpane/sdk/server';
import { type Context, type Request, type WsEvent, type WsRequest, normalizeRequest } from '../../shared/index.ts';
import { substitute } from '../../shared/vars.ts';
import { applyAuth, failure, parseUrl } from '../http/index.ts';
import { MAX_MESSAGE, type WebSocketClient, connect } from '../ws/index.ts';
import { type Deps, type Group, context, projectOf } from './context.ts';

interface Session {
  ws: WebSocketClient | null;
  emit(e: WsEvent): void;
  stop(): void;
}

export function websockets(d: Deps): Group {
  const { o } = d;
  const sessions = new Map<string, Session>();
  const backoff = o.backoff ?? [1000, 2000, 4000, 8000, 15_000, 30_000];

  /** A WebSocket, kept open (and opened again, when asked) until the
   * window stops listening or it's closed. */
  async function runWs(req: { id?: unknown; project?: unknown; request?: unknown; context?: Context }, out: Out) {
    const id = String(req.id ?? '');
    if (!id) throw new PluginError('A WebSocket needs an id to send to it.');
    const project = projectOf(req.project);
    const r = normalizeRequest((req.request ?? {}) as Partial<Request>);
    if (r.type !== 'ws') throw new PluginError('That isn’t a WebSocket request.');
    const w = r as WsRequest;
    sessions.get(id)?.stop();
    const { vars, auth } = await context(d, project, w, req.context);
    const missing = new Set<string>();
    const fill = (s: string) => substitute(s, vars, missing);
    const headers: [string, string][] = w.headers.filter((h) => h.enabled && h.key).map((h) => [fill(h.key), fill(h.value)]);
    const protocols = fill(w.protocols)
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean);
    const url = parseUrl(fill(w.url), ['ws:', 'wss:'], [...missing]);
    applyAuth(auth, headers, url, fill);
    const emit = (e: WsEvent) => void out.emit(e);
    let stopped = false;
    let wake: (() => void) | null = null;
    const session: Session = {
      ws: null,
      emit,
      stop() {
        stopped = true;
        // An open socket closes with the handshake; its close wakes the
        // loop. Otherwise (connecting, waiting to reconnect) at once.
        if (session.ws && !session.ws.closed) {
          if (session.ws.open) session.ws.close(1000, '');
        } else wake?.();
      },
    };
    sessions.set(id, session);
    out.signal.addEventListener('abort', () => session.stop(), { once: true });
    try {
      for (let attempt = 1; !stopped; attempt++) {
        emit({ type: 'connecting', at: Date.now(), url: url.href, attempt });
        let closedBy: string | null = null;
        try {
          const closed = new Promise<void>((resolve) => (wake = resolve));
          const { ws, ms } = await connect(
            { url, headers, protocols, insecure: w.insecure, signal: out.signal, maxMessage: o.maxMessage ?? MAX_MESSAGE },
            {
              message: (m) => emit({ type: 'message', at: Date.now(), dir: 'in', ...m }),
              ping: (size) => emit({ type: 'ping', at: Date.now(), dir: 'in', size }),
              pong: (size, rtt) => emit({ type: 'pong', at: Date.now(), dir: 'in', size, ...(rtt === null ? {} : { ms: rtt }) }),
              close: (c) => {
                closedBy = c.by;
                emit({ type: 'close', at: Date.now(), ...c });
                wake?.();
              },
              error: (message) => emit({ type: 'error', at: Date.now(), message }),
            },
          );
          session.ws = ws;
          attempt = 0;
          emit({ type: 'open', at: Date.now(), url: url.href, protocol: ws.protocol, headers: ws.headers, status: ws.status, ms });
          ws.start();
          if (stopped) ws.close(1000, '');
          await closed;
        } catch (e) {
          if (stopped) break;
          emit({ type: 'error', at: Date.now(), message: (e instanceof PluginError ? e : failure(e, url)).message });
        } finally {
          if (session.ws && !session.ws.closed) session.ws.destroy();
          session.ws = null;
        }
        if (stopped || !w.reconnect || closedBy === 'client') break;
        const wait = backoff[Math.min(Math.max(attempt, 1) - 1, backoff.length - 1)];
        emit({ type: 'reconnecting', at: Date.now(), in: wait, attempt: Math.max(attempt, 1) });
        await new Promise<void>((resolve) => {
          const t = setTimeout(resolve, wait);
          wake = () => (clearTimeout(t), resolve());
        });
      }
    } finally {
      session.ws?.destroy();
      if (sessions.get(id) === session) sessions.delete(id);
    }
  }

  function open(id: unknown): { session: Session; ws: WebSocketClient } {
    const session = sessions.get(String(id));
    if (!session?.ws) throw new PluginError('It isn’t connected: connect first.');
    return { session, ws: session.ws };
  }

  return {
    calls: {
    wsSend: ({ id, text, data }) => {
      const { session, ws } = open(id);
      if (data instanceof Uint8Array) {
        const size = ws.send(data);
        session.emit({ type: 'message', at: Date.now(), dir: 'out', data, size });
      } else {
        const t = String(text ?? '');
        const size = ws.send(t);
        session.emit({ type: 'message', at: Date.now(), dir: 'out', text: t, size });
      }
      return null;
    },

    wsPing: ({ id, text }) => {
      const { session, ws } = open(id);
      const payload = Buffer.from(String(text ?? ''), 'utf8');
      ws.ping(payload);
      session.emit({ type: 'ping', at: Date.now(), dir: 'out', size: payload.length });
      return null;
    },

    wsClose: ({ id, code, reason }) => {
      const session = sessions.get(String(id));
      if (!session) return null;
      if (session.ws?.open) session.ws.close(code === undefined || code === null || code === '' ? 1000 : Number(code), String(reason ?? ''));
      // Closing by hand ends the reconnecting too.
      session.stop();
      return null;
    },
    },
    subscriptions: {
      ws: (req, out) => runWs(req, out),
    },
    shutdown() {
      for (const s of sessions.values()) s.stop();
    },
  };
}
