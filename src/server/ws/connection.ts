// An open WebSocket: messages sent and read (fragmented or not, text
// checked as UTF-8, a size limit), pings answered, and the closing
// handshake either way, with who closed it and the code.

import type http from 'node:http';
import type net from 'node:net';
import { PluginError } from '@hyperpane/sdk/server';
import { pairs } from '../http/index.ts';
import { ByteQueue, type Frame, OP, frame, readFrame } from './frames.ts';

export interface WsHandlers {
  message(m: { text?: string; data?: Uint8Array; size: number }): void;
  ping(size: number): void;
  pong(size: number, ms: number | null): void;
  close(c: { code: number | null; reason: string; by: 'server' | 'client' | 'network' }): void;
  error(message: string): void;
}

/** An open WebSocket. `connect` makes one. */
export class WebSocketClient {
  readonly protocol: string | null;
  readonly headers: [string, string][];
  readonly status: number;
  #socket: net.Socket;
  #on: WsHandlers;
  #queue = new ByteQueue();
  #max: number;
  #fragments: Buffer[] = [];
  #fragmentOp = 0;
  #fragmentSize = 0;
  #closeSent: { code: number; reason: string } | null = null;
  #closed = false;
  #pings: number[] = [];
  #decoder = new TextDecoder('utf-8', { fatal: true });

  constructor(socket: net.Socket, head: Buffer, res: http.IncomingMessage, on: WsHandlers, max: number) {
    this.#socket = socket;
    this.#on = on;
    this.#max = max;
    this.protocol = (res.headers['sec-websocket-protocol'] as string | undefined) ?? null;
    this.headers = pairs(res.rawHeaders);
    this.status = res.statusCode ?? 101;
    socket.setNoDelay(true);
    socket.setTimeout(0);
    this.#head = head;
    socket.on('error', (e) => {
      if (!this.#closed) on.error(`The connection failed: ${e.message}`);
    });
    socket.on('close', () => this.#gone({ code: 1006, reason: '', by: 'network' }));
  }

  #head: Buffer | null;

  /** Starts reading: after the caller has said it's open, so what the
   * server sent with its handshake comes after that. */
  start() {
    const head = this.#head;
    this.#head = null;
    if (head?.length) this.#data(head);
    this.#socket.on('data', (d: Buffer) => this.#data(d));
  }

  get closed(): boolean {
    return this.#closed;
  }

  get open(): boolean {
    return !this.#closed && !this.#closeSent;
  }

  send(data: string | Uint8Array): number {
    this.#check();
    const text = typeof data === 'string';
    const bytes = text ? Buffer.from(data, 'utf8') : data;
    this.#socket.write(frame(text ? OP.text : OP.binary, bytes));
    return bytes.length;
  }

  /** Sends a message in pieces (a first frame and continuations). */
  sendFragments(parts: (string | Uint8Array)[], binary = false) {
    this.#check();
    parts.forEach((p, i) => {
      const bytes = typeof p === 'string' ? Buffer.from(p, 'utf8') : p;
      this.#socket.write(frame(i === 0 ? (binary ? OP.binary : OP.text) : OP.cont, bytes, i === parts.length - 1));
    });
  }

  ping(payload: Uint8Array = Buffer.alloc(0)) {
    this.#check();
    if (payload.length > 125) throw new PluginError('A ping carries at most 125 bytes.');
    this.#pings.push(performance.now());
    this.#socket.write(frame(OP.ping, payload));
  }

  /** Starts the closing handshake; the server's answer (or 3 s) ends it. */
  close(code = 1000, reason = '') {
    if (this.#closed || this.#closeSent) return;
    const r = Buffer.from(reason, 'utf8');
    if (r.length > 123) throw new PluginError('A close reason is at most 123 bytes.');
    if (code !== 1000 && (code < 3000 || code > 4999) && !(code >= 1001 && code <= 1014 && ![1004, 1005, 1006].includes(code))) {
      throw new PluginError(`${code} can’t be sent as a close code: use 1000, 1001–1014 (not 1004–1006) or 3000–4999.`);
    }
    this.#closeSent = { code, reason };
    const payload = Buffer.alloc(2 + r.length);
    payload.writeUInt16BE(code, 0);
    r.copy(payload, 2);
    this.#socket.write(frame(OP.close, payload));
    setTimeout(() => this.#gone({ code, reason, by: 'client' }), 3000).unref();
  }

  /** Ends it at once, without the closing handshake. */
  destroy() {
    this.#gone(this.#closeSent ? { ...this.#closeSent, by: 'client' } : { code: 1006, reason: '', by: 'client' });
  }

  #check() {
    if (this.#closed) throw new PluginError('It’s closed: connect again to send.');
    if (this.#closeSent) throw new PluginError('It’s closing: connect again to send.');
  }

  #gone(c: { code: number | null; reason: string; by: 'server' | 'client' | 'network' }) {
    if (this.#closed) return;
    this.#closed = true;
    this.#socket.destroy();
    // A close we started, that the network ended before the server
    // answered, was still ours.
    this.#on.close(this.#closeSent && c.by === 'network' ? { ...this.#closeSent, by: 'client' } : c);
  }

  #fail(code: number, why: string) {
    this.#on.error(why);
    if (!this.#closeSent && !this.#closed) {
      const r = Buffer.from(why.slice(0, 120), 'utf8');
      const payload = Buffer.alloc(2 + r.length);
      payload.writeUInt16BE(code, 0);
      r.copy(payload, 2);
      this.#socket.write(frame(OP.close, payload));
    }
    this.#closeSent = { code, reason: why.slice(0, 120) };
    this.#socket.end();
    setTimeout(() => this.#gone({ code, reason: why, by: 'client' }), 1000).unref();
  }

  #data(d: Buffer) {
    if (this.#closed) return;
    this.#queue.push(d);
    for (;;) {
      let f: Frame | null;
      try {
        f = readFrame(this.#queue, this.#max);
      } catch (e) {
        return this.#fail((e as { closeCode?: number }).closeCode ?? 1002, (e as Error).message);
      }
      if (!f) return;
      if (f.masked) return this.#fail(1002, 'The server masked a frame, which servers mustn’t.');
      if (f.rsv) return this.#fail(1002, 'The server set reserved bits no extension was agreed for.');
      if (f.opcode >= 8) {
        if (!f.fin || f.payload.length > 125) return this.#fail(1002, 'The server sent a control frame that was fragmented or too long.');
        this.#control(f);
        if (this.#closed) return;
        continue;
      }
      if (f.opcode === OP.cont) {
        if (!this.#fragmentOp) return this.#fail(1002, 'The server sent a continuation with nothing to continue.');
      } else if (f.opcode === OP.text || f.opcode === OP.binary) {
        if (this.#fragmentOp) return this.#fail(1002, 'The server started a message before finishing the last one.');
        this.#fragmentOp = f.opcode;
      } else return this.#fail(1002, `The server sent an unknown frame (opcode ${f.opcode}).`);
      this.#fragmentSize += f.payload.length;
      if (this.#fragmentSize > this.#max) return this.#fail(1009, `A message of more than ${this.#max} bytes: more than is taken.`);
      this.#fragments.push(f.payload);
      if (!f.fin) continue;
      const all = this.#fragments.length === 1 ? this.#fragments[0] : Buffer.concat(this.#fragments);
      const op = this.#fragmentOp;
      this.#fragments = [];
      this.#fragmentOp = 0;
      this.#fragmentSize = 0;
      if (op === OP.text) {
        let text: string;
        try {
          text = this.#decoder.decode(all);
        } catch {
          return this.#fail(1007, 'The server sent a text message that isn’t UTF-8.');
        }
        this.#on.message({ text, size: all.length });
      } else this.#on.message({ data: new Uint8Array(all.buffer, all.byteOffset, all.length), size: all.length });
    }
  }

  #control(f: Frame) {
    if (f.opcode === OP.ping) {
      this.#on.ping(f.payload.length);
      if (!this.#closeSent) this.#socket.write(frame(OP.pong, f.payload));
    } else if (f.opcode === OP.pong) {
      const sent = this.#pings.shift();
      this.#on.pong(f.payload.length, sent === undefined ? null : Math.round((performance.now() - sent) * 10) / 10);
    } else if (f.opcode === OP.close) {
      const code = f.payload.length >= 2 ? f.payload.readUInt16BE(0) : null;
      let reason = '';
      try {
        reason = f.payload.length > 2 ? this.#decoder.decode(f.payload.subarray(2)) : '';
      } catch {}
      if (this.#closeSent) {
        // The server's answer to ours.
        this.#gone({ ...this.#closeSent, by: 'client' });
        return;
      }
      // Answered with the same code, then it's over.
      const echo = Buffer.alloc(code === null ? 0 : 2);
      if (code !== null) echo.writeUInt16BE(code, 0);
      this.#socket.write(frame(OP.close, echo));
      this.#closeSent = { code: code ?? 1005, reason };
      this.#socket.end();
      this.#gone({ code: code ?? 1005, reason, by: 'server' });
    }
  }
}
