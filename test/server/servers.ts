// Servers for the tests, on this machine: an HTTP one that answers with
// what a handler says, an HTTPS one with a certificate made for the test
// (when openssl is here), and a WebSocket server written from the RFC, so
// the client is checked against frames made independently of it.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import type net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { after } from 'node:test';

export async function listen(server: http.Server | https.Server): Promise<number> {
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  after(() => {
    server.closeAllConnections?.();
    server.close();
  });
  return (server.address() as net.AddressInfo).port;
}

export async function httpServer(handler: http.RequestListener): Promise<string> {
  const port = await listen(http.createServer(handler));
  return `http://127.0.0.1:${port}`;
}

/** A self-signed certificate for 127.0.0.1, or null without openssl. */
export function selfSigned(): { key: string; cert: string } | null {
  try {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'requests-tls-'));
    execFileSync(
      'openssl',
      ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', path.join(dir, 'k.pem'), '-out', path.join(dir, 'c.pem'), '-days', '1', '-subj', '/CN=127.0.0.1', '-addext', 'subjectAltName=IP:127.0.0.1'],
      { stdio: 'ignore' },
    );
    return { key: readFileSync(path.join(dir, 'k.pem'), 'utf8'), cert: readFileSync(path.join(dir, 'c.pem'), 'utf8') };
  } catch {
    return null;
  }
}

/** Reads a request's whole body. */
export function bodyOf(req: http.IncomingMessage): Promise<Buffer> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
  });
}

/** A frame as a server sends it (not masked). */
export function serverFrame(opcode: number, payload: Buffer, fin = true): Buffer {
  const len = payload.length;
  const head = len < 126 ? 2 : len < 65536 ? 4 : 10;
  const out = Buffer.alloc(head + len);
  out[0] = (fin ? 0x80 : 0) | opcode;
  if (len < 126) out[1] = len;
  else if (len < 65536) {
    out[1] = 126;
    out.writeUInt16BE(len, 2);
  } else {
    out[1] = 127;
    out.writeBigUInt64BE(BigInt(len), 2);
  }
  payload.copy(out, head);
  return out;
}

export interface Peer {
  socket: net.Socket;
  headers: http.IncomingHttpHeaders;
  /** Frames from the client, unmasked: [opcode, payload, fin]. */
  frames: { opcode: number; payload: Buffer; fin: boolean; masked: boolean }[];
  send(opcode: number, payload: Buffer | string, fin?: boolean): void;
}

/** A WebSocket server: an echo by default (text as text, binary as
 * binary, a ping's pong, a close's answer). `onFrame` can do otherwise;
 * `protocol` picks the subprotocol; `check` can refuse the handshake. */
export async function wsServer(o: {
  onConnect?(p: Peer): void;
  onFrame?(p: Peer, f: { opcode: number; payload: Buffer; fin: boolean }): boolean | void;
  protocol?(offered: string[]): string | null;
  check?(req: http.IncomingMessage): number | null;
} = {}): Promise<{ url: string; peers: Peer[] }> {
  const peers: Peer[] = [];
  const server = http.createServer((_req, res) => {
    res.writeHead(426, { 'Content-Type': 'text/plain' });
    res.end('This is a WebSocket endpoint.');
  });
  server.on('upgrade', (req, socket: net.Socket) => {
    const refuse = o.check?.(req);
    if (refuse) {
      socket.end(`HTTP/1.1 ${refuse} Refused\r\nContent-Type: text/plain\r\nContent-Length: 7\r\n\r\nGo away`);
      return;
    }
    const accept = createHash('sha1')
      .update(`${req.headers['sec-websocket-key']}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
      .digest('base64');
    const offered = String(req.headers['sec-websocket-protocol'] ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const proto = o.protocol ? o.protocol(offered) : null;
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n${proto ? `Sec-WebSocket-Protocol: ${proto}\r\n` : ''}X-Test: yes\r\n\r\n`);
    const peer: Peer = {
      socket,
      headers: req.headers,
      frames: [],
      send: (opcode, payload, fin = true) => socket.write(serverFrame(opcode, typeof payload === 'string' ? Buffer.from(payload) : payload, fin)),
    };
    peers.push(peer);
    let buf = Buffer.alloc(0);
    let message: Buffer[] = [];
    let messageOp = 0;
    socket.on('data', (d: Buffer) => {
      buf = Buffer.concat([buf, d]);
      for (;;) {
        if (buf.length < 2) return;
        let len = buf[1] & 0x7f;
        let head = 2;
        if (len === 126) {
          if (buf.length < 4) return;
          len = buf.readUInt16BE(2);
          head = 4;
        } else if (len === 127) {
          if (buf.length < 10) return;
          len = Number(buf.readBigUInt64BE(2));
          head = 10;
        }
        const masked = (buf[1] & 0x80) !== 0;
        const total = head + (masked ? 4 : 0) + len;
        if (buf.length < total) return;
        const mask = masked ? buf.subarray(head, head + 4) : null;
        const payload = Buffer.from(buf.subarray(head + (masked ? 4 : 0), total));
        if (mask) for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
        const f = { opcode: buf[0] & 0x0f, payload, fin: (buf[0] & 0x80) !== 0, masked };
        buf = buf.subarray(total);
        peer.frames.push(f);
        if (o.onFrame?.(peer, f)) continue;
        if (f.opcode === 9) peer.send(10, payload);
        else if (f.opcode === 8) {
          peer.send(8, payload);
          socket.end();
        } else if (f.opcode === 1 || f.opcode === 2 || f.opcode === 0) {
          if (f.opcode) messageOp = f.opcode;
          message.push(payload);
          if (f.fin) {
            peer.send(messageOp, Buffer.concat(message));
            message = [];
          }
        }
      }
    });
    socket.on('error', () => {});
    o.onConnect?.(peer);
  });
  const port = await listen(server);
  return { url: `ws://127.0.0.1:${port}`, peers };
}
