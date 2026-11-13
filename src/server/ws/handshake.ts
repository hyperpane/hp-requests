// Opening a WebSocket over node:http's upgrade, so the handshake carries
// any header and subprotocol and a certificate can be ignored; then
// checked: the accept key, the upgrade, the subprotocol, no extensions.

import { createHash, randomBytes } from 'node:crypto';
import type http from 'node:http';
import type net from 'node:net';
import { PluginError } from '@hyperpane/sdk/server';
import { exchange, failure } from '../http/index.ts';
import { WebSocketClient, type WsHandlers } from './connection.ts';
import { MAX_MESSAGE } from './frames.ts';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

export interface WsOptions {
  url: URL;
  headers: [string, string][];
  protocols: string[];
  insecure: boolean;
  maxMessage?: number;
  /** For the handshake, in ms. */
  timeout?: number;
  signal?: AbortSignal;
}

/** Opens a WebSocket: the handshake, checked (the accept key, the
 * subprotocol). Fails with what the server said when it doesn't upgrade. */
export async function connect(o: WsOptions, on: WsHandlers): Promise<{ ws: WebSocketClient; ms: number }> {
  const t0 = performance.now();
  const key = randomBytes(16).toString('base64');
  const has = (n: string) => o.headers.some(([k]) => k.toLowerCase() === n);
  const headers: [string, string][] = [...o.headers.filter(([k]) => !['connection', 'upgrade', 'sec-websocket-key', 'sec-websocket-version'].includes(k.toLowerCase()))];
  headers.push(['Connection', 'Upgrade'], ['Upgrade', 'websocket'], ['Sec-WebSocket-Version', '13'], ['Sec-WebSocket-Key', key]);
  if (o.protocols.length && !has('sec-websocket-protocol')) headers.push(['Sec-WebSocket-Protocol', o.protocols.join(', ')]);
  if (!has('user-agent')) headers.push(['User-Agent', 'hyperpane-requests/0.0.1']);
  const url = new URL(o.url.href);
  const ex = await exchange({ method: 'GET', url, headers, body: null, insecure: o.insecure, signal: o.signal, deadline: t0 + (o.timeout ?? 30_000), timeout: o.timeout ?? 30_000, upgrade: true }).catch((e) => {
    throw failure(e, url);
  });
  const res = ex.res as http.IncomingMessage & { upgraded?: { socket: net.Socket; head: Buffer } };
  if (!res.upgraded) {
    const text = await new Promise<string>((resolve) => {
      let s = '';
      res.setEncoding('utf8');
      res.on('data', (c: string) => (s = (s + c).slice(0, 2000)));
      res.on('end', () => resolve(s));
      res.on('error', () => resolve(s));
      setTimeout(() => resolve(s), 2000).unref();
    });
    const said = text.trim().replace(/\s+/g, ' ').slice(0, 300);
    throw new PluginError(`${url.host} answered ${res.statusCode} ${res.statusMessage ?? ''}, not a WebSocket upgrade${said ? `: ${said}` : '.'}`.replace(/ ,/, ','));
  }
  const { socket, head } = res.upgraded;
  const expected = createHash('sha1').update(key + GUID).digest('base64');
  const fail = (why: string) => {
    socket.destroy();
    throw new PluginError(why);
  };
  if (res.headers['sec-websocket-accept'] !== expected) fail(`${url.host} upgraded, but its Sec-WebSocket-Accept is wrong: it isn’t a WebSocket server (or something in between changed it).`);
  if (String(res.headers.upgrade ?? '').toLowerCase() !== 'websocket') fail(`${url.host} upgraded to “${res.headers.upgrade ?? 'nothing'}”, not websocket.`);
  const proto = res.headers['sec-websocket-protocol'] as string | undefined;
  if (proto && !o.protocols.includes(proto)) fail(`${url.host} chose the subprotocol “${proto}”, which wasn’t offered.`);
  if (res.headers['sec-websocket-extensions']) fail(`${url.host} turned on extensions (${res.headers['sec-websocket-extensions']}) that weren’t asked for.`);
  const ws = new WebSocketClient(socket, head, res, on, o.maxMessage ?? MAX_MESSAGE);
  return { ws, ms: Math.round((performance.now() - t0) * 10) / 10 };
}
