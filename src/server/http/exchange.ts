// One request and its answer's head, with node:http and node:https rather
// than fetch, so what goes is what was asked for: any method, the headers
// as typed (their case, repeated ones), certificates checked or not, and
// each phase timed (lookup, connect, TLS, first byte). An upgrade (a
// WebSocket) resolves here too.

import dns from 'node:dns';
import { createReadStream } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { Readable } from 'node:stream';
import type { TLSSocket } from 'node:tls';
import { PluginError } from '@hyperpane/sdk/server';
import type { TlsInfo } from '../../shared/index.ts';
import { duration, failure } from './errors.ts';
import { type Part, has } from './request.ts';

/** How many bytes a body has. */
export const bodySize = (parts: Part[] | null) => (parts ?? []).reduce((n, p) => n + (p instanceof Uint8Array ? p.length : p.size), 0);

async function* bodyBytes(parts: Part[]): AsyncGenerator<Uint8Array> {
  for (const p of parts) {
    if (p instanceof Uint8Array) yield p;
    else for await (const chunk of createReadStream(p.file)) yield chunk as Buffer;
  }
}

/** One request and its answer's head: what a redirect, an event stream and
 * a whole send are made of. */
export interface Exchange {
  req: http.ClientRequest;
  res: http.IncomingMessage;
  marks: { start: number; lookup: number | null; connect: number | null; tls: number | null; sent: number | null; response: number };
  remote: string | null;
  tls: TlsInfo | null;
  sentHeaders: [string, string][];
}

export interface ExchangeOptions {
  method: string;
  url: URL;
  headers: [string, string][];
  body: Part[] | null;
  insecure: boolean;
  signal?: AbortSignal;
  /** When to give up, as performance.now() (null: never). */
  deadline: number | null;
  /** The timeout it was given, in ms, for saying so. */
  timeout?: number;
  /** For an upgrade (WebSocket): the 'upgrade' event resolves instead. */
  upgrade?: boolean;
}

/** Sends one request and resolves when its answer's head is here. */
export function exchange(o: ExchangeOptions): Promise<Exchange> {
  return new Promise<Exchange>((resolve, reject) => {
    const start = performance.now();
    const marks: Exchange['marks'] = { start, lookup: null, connect: null, tls: null, sent: null, response: 0 };
    const secure = o.url.protocol === 'https:' || o.url.protocol === 'wss:';
    const host = o.url.hostname.replace(/^\[|\]$/g, '');
    const opts: https.RequestOptions = {
      host,
      port: o.url.port || (secure ? 443 : 80),
      path: `${o.url.pathname || '/'}${o.url.search}`,
      method: o.method,
      agent: false,
      rejectUnauthorized: !o.insecure,
      lookup: (hostname: string, options: dns.LookupOptions, cb: (...a: any[]) => void) =>
        dns.lookup(hostname, options, (...a: any[]) => {
          marks.lookup = performance.now();
          (cb as (...a: any[]) => void)(...a);
        }),
    };
    if (secure && !net.isIP(host)) opts.servername = host;
    let req: http.ClientRequest;
    let done = false;
    const fail = (e: unknown) => {
      if (done) return;
      done = true;
      cleanup();
      req?.destroy();
      reject(e);
    };
    const onAbort = () => fail(new PluginError('Cancelled.'));
    const timer = o.deadline === null ? null : setTimeout(() => fail(new PluginError(`No answer from ${o.url.host} in ${o.timeout ? duration(o.timeout) : 'time'}: it’s past the timeout.`)), Math.max(0, o.deadline - start));
    const cleanup = () => {
      if (timer) clearTimeout(timer);
      o.signal?.removeEventListener('abort', onAbort);
    };
    if (o.signal?.aborted) return reject(new PluginError('Cancelled.'));
    o.signal?.addEventListener('abort', onAbort, { once: true });
    try {
      req = (secure ? https : http).request(opts);
      // Repeated headers go as repeated lines; each keeps its case.
      const grouped = new Map<string, { name: string; values: string[] }>();
      for (const [k, v] of o.headers) {
        if (!k) continue;
        const g = grouped.get(k.toLowerCase());
        if (g) g.values.push(v);
        else grouped.set(k.toLowerCase(), { name: k, values: [v] });
      }
      for (const { name, values } of grouped.values()) req.setHeader(name, values.length > 1 ? values : values[0]);
      if (o.body && !has(o.headers, 'content-length') && !has(o.headers, 'transfer-encoding')) req.setHeader('Content-Length', bodySize(o.body));
    } catch (e) {
      cleanup();
      return reject(failure(e, o.url));
    }
    const sentHeaders = (): [string, string][] => {
      const raw = req.getRawHeaderNames();
      const out: [string, string][] = [];
      for (const name of raw) {
        const v = req.getHeader(name);
        for (const one of Array.isArray(v) ? v : [v]) out.push([name, String(one)]);
      }
      if (!has(out, 'host')) out.unshift(['Host', o.url.host]);
      return out;
    };
    let remote: string | null = null;
    let tls: TlsInfo | null = null;
    req.on('socket', (s) => {
      s.once('connect', () => {
        marks.connect = performance.now();
        remote = s.remoteAddress ? `${s.remoteAddress.includes(':') ? `[${s.remoteAddress}]` : s.remoteAddress}:${s.remotePort}` : null;
      });
      s.once('secureConnect', () => {
        marks.tls = performance.now();
        const t = s as TLSSocket;
        const cert = t.getPeerCertificate?.();
        const name = (x: Record<string, unknown> | undefined) => (x ? String(x.CN ?? x.O ?? Object.values(x)[0] ?? '') || null : null);
        tls = {
          protocol: t.getProtocol?.() ?? null,
          cipher: t.getCipher?.()?.name ?? null,
          authorized: t.authorized,
          error: t.authorizationError ? String(t.authorizationError) : null,
          subject: name(cert?.subject as unknown as Record<string, unknown>),
          issuer: name(cert?.issuer as unknown as Record<string, unknown>),
          validTo: cert?.valid_to ?? null,
        };
      });
    });
    req.on('finish', () => (marks.sent = performance.now()));
    req.on('error', (e) => fail(failure(e, o.url)));
    const answered = (res: http.IncomingMessage) => {
      if (done) return void res.destroy();
      done = true;
      marks.response = performance.now();
      cleanup();
      // From here the caller watches the deadline and the signal.
      resolve({ req, res, marks, remote, tls, sentHeaders: sentHeaders() });
    };
    req.on('response', answered);
    if (o.upgrade) {
      req.on('upgrade', (res, socket, head) => {
        (res as http.IncomingMessage & { upgraded?: { socket: net.Socket; head: Buffer } }).upgraded = { socket: socket as net.Socket, head };
        answered(res);
      });
    }
    if (o.body?.length) {
      Readable.from(bodyBytes(o.body)).on('error', (e) => fail(new PluginError(`Couldn’t read the body’s file: ${e.message}`))).pipe(req);
    } else req.end();
  });
}

/** Pairs from raw headers. */
export function pairs(raw: string[]): [string, string][] {
  const out: [string, string][] = [];
  for (let i = 0; i + 1 < raw.length; i += 2) out.push([raw[i], raw[i + 1]]);
  return out;
}
