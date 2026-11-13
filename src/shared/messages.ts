// What a WebSocket and an event stream send the window, and a message's
// bytes: hex and base64 both ways, and what the composer sends.

import type { MessageFormat } from './requests.ts';

/** What a WebSocket subscription sends. */
export type WsEvent =
  | { type: 'connecting'; at: number; url: string; attempt: number }
  | { type: 'open'; at: number; url: string; protocol: string | null; headers: [string, string][]; status: number; ms: number }
  | { type: 'message'; at: number; dir: 'in' | 'out'; text?: string; data?: Uint8Array; size: number }
  | { type: 'ping' | 'pong'; at: number; dir: 'in' | 'out'; size: number; ms?: number }
  | { type: 'close'; at: number; code: number | null; reason: string; by: 'server' | 'client' | 'network' }
  | { type: 'error'; at: number; message: string }
  | { type: 'reconnecting'; at: number; in: number; attempt: number };

/** What an event-stream subscription sends. */
export type SseEvent =
  | { type: 'open'; at: number; status: number; headers: [string, string][] }
  | { type: 'event'; at: number; id: string | null; event: string; data: string; retry: number | null }
  | { type: 'end'; at: number; message: string };

/** Bytes as base64, here and in the browser. */
export function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export function fromBase64(text: string): Uint8Array {
  const s = atob(text.replace(/\s+/g, ''));
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export function toHex(bytes: Uint8Array, sep = ' '): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join(sep);
}

/** Hex as bytes (spaces, colons and 0x allowed), or null when it isn't. */
export function fromHex(text: string): Uint8Array | null {
  const t = text.replace(/0x/gi, '').replace(/[\s:,]+/g, '');
  if (t.length % 2 || /[^0-9a-f]/i.test(t)) return null;
  const out = new Uint8Array(t.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(t.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/** Text to send as a WebSocket message, by its format: a string, or bytes
 * (hex, base64). Throws with what's wrong. */
export function messagePayload(data: string, format: MessageFormat): { text?: string; bytes?: Uint8Array } {
  if (format === 'hex') {
    const b = fromHex(data);
    if (!b) throw new Error('That isn’t hex: pairs of 0-9 and a-f, spaces allowed.');
    return { bytes: b };
  }
  if (format === 'base64') {
    try {
      return { bytes: fromBase64(data) };
    } catch {
      throw new Error('That isn’t base64.');
    }
  }
  if (format === 'json') {
    try {
      JSON.parse(data);
    } catch (e) {
      throw new Error(`That isn’t JSON: ${(e as Error).message}`);
    }
  }
  return { text: data };
}
