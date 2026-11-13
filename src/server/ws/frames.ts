// WebSocket frames (RFC 6455): written as a client writes them (masked),
// read back from bytes as they arrive (in any pieces), and the close
// codes' names.

import { randomBytes } from 'node:crypto';

/** The largest message taken (more closes with 1009). */
export const MAX_MESSAGE = 32 * 1024 * 1024;

export const OP = { cont: 0, text: 1, binary: 2, close: 8, ping: 9, pong: 10 } as const;

/** A frame as a client sends it: masked. */
export function frame(opcode: number, payload: Uint8Array, fin = true, mask: Uint8Array | null = randomBytes(4)): Buffer {
  const len = payload.length;
  const head = len < 126 ? 2 : len < 65536 ? 4 : 10;
  const out = Buffer.alloc(head + (mask ? 4 : 0) + len);
  out[0] = (fin ? 0x80 : 0) | opcode;
  if (len < 126) out[1] = len;
  else if (len < 65536) {
    out[1] = 126;
    out.writeUInt16BE(len, 2);
  } else {
    out[1] = 127;
    out.writeBigUInt64BE(BigInt(len), 2);
  }
  if (mask) {
    out[1] |= 0x80;
    out.set(mask, head);
    const at = head + 4;
    for (let i = 0; i < len; i++) out[at + i] = payload[i] ^ mask[i & 3];
  } else out.set(payload, head);
  return out;
}

/** Bytes as they arrive, taken in pieces without copying them all again
 * for each chunk. */
export class ByteQueue {
  #chunks: Buffer[] = [];
  length = 0;
  push(b: Buffer) {
    if (!b.length) return;
    this.#chunks.push(b);
    this.length += b.length;
  }
  /** The first n bytes (n ≤ length), without taking them. */
  peek(n: number): Buffer {
    if (this.#chunks[0]?.length >= n) return this.#chunks[0].subarray(0, n);
    return Buffer.concat(this.#chunks, Math.max(n, 0)).subarray(0, n);
  }
  take(n: number): Buffer {
    const out = Buffer.allocUnsafe(n);
    let at = 0;
    while (at < n) {
      const c = this.#chunks[0];
      const k = Math.min(c.length, n - at);
      c.copy(out, at, 0, k);
      at += k;
      if (k === c.length) this.#chunks.shift();
      else this.#chunks[0] = c.subarray(k);
    }
    this.length -= n;
    return out;
  }
}

export interface Frame {
  fin: boolean;
  rsv: number;
  opcode: number;
  masked: boolean;
  payload: Buffer;
}

/** Reads frames from a queue; null when one isn't all here yet. Throws
 * (with a close code) on one too big. */
export function readFrame(q: ByteQueue, max: number): Frame | null {
  if (q.length < 2) return null;
  const h = q.peek(2);
  let len = h[1] & 0x7f;
  let head = 2;
  if (len === 126) {
    if (q.length < 4) return null;
    len = q.peek(4).readUInt16BE(2);
    head = 4;
  } else if (len === 127) {
    if (q.length < 10) return null;
    const big = q.peek(10).readBigUInt64BE(2);
    if (big > BigInt(max)) throw Object.assign(new Error(`A frame of ${big} bytes is more than the ${max} taken.`), { closeCode: 1009 });
    len = Number(big);
    head = 10;
  }
  if (len > max) throw Object.assign(new Error(`A frame of ${len} bytes is more than the ${max} taken.`), { closeCode: 1009 });
  const masked = (h[1] & 0x80) !== 0;
  const total = head + (masked ? 4 : 0) + len;
  if (q.length < total) return null;
  const all = q.take(total);
  let payload = all.subarray(head + (masked ? 4 : 0));
  if (masked) {
    const m = all.subarray(head, head + 4);
    payload = Buffer.from(payload);
    for (let i = 0; i < payload.length; i++) payload[i] ^= m[i & 3];
  }
  return { fin: (h[0] & 0x80) !== 0, rsv: (h[0] >> 4) & 7, opcode: h[0] & 0x0f, masked, payload };
}

export const CLOSE_CODES: Record<number, string> = {
  1000: 'Normal',
  1001: 'Going away',
  1002: 'Protocol error',
  1003: 'Unsupported data',
  1005: 'No code',
  1006: 'Lost (no close frame)',
  1007: 'Invalid data',
  1008: 'Policy violation',
  1009: 'Message too big',
  1010: 'Extension required',
  1011: 'Server error',
  1012: 'Service restart',
  1013: 'Try again later',
  1014: 'Bad gateway',
  1015: 'TLS handshake failed',
};
