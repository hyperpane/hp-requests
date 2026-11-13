// A WebSocket's events as the window shows them: a message's text, a
// system line's words, a close code's name, JSON told apart.

import { type WsEvent, toHex } from '../../shared/index.ts';

export type Ev = WsEvent & { n: number };

export const CLOSE: Record<number, string> = { 1000: 'normal', 1001: 'going away', 1002: 'protocol error', 1003: 'unsupported data', 1005: 'no code', 1006: 'lost, no close frame', 1007: 'invalid data', 1008: 'policy', 1009: 'too big', 1011: 'server error', 1012: 'restarting', 1013: 'try again later' };
export const closeText = (code: number | null) => (code === null ? 'no code' : `${code}${CLOSE[code] ? ` ${CLOSE[code]}` : ''}`);

/** A message's text as it's shown and copied (binary as hex). */
export const asText = (e: Ev) => (e.type === 'message' ? (e.text ?? toHex(e.data ?? new Uint8Array())) : '');

export function systemText(e: Ev): string {
  switch (e.type) {
    case 'connecting':
      return e.attempt > 1 ? `Connecting again (try ${e.attempt})…` : `Connecting to ${e.url}…`;
    case 'open':
      return `Connected in ${Math.round(e.ms)} ms${e.protocol ? `, subprotocol ${e.protocol}` : ''}`;
    case 'close':
      return `Closed by ${e.by === 'network' ? 'the network' : e.by === 'server' ? 'the server' : 'you'}: ${closeText(e.code)}${e.reason ? ` · “${e.reason}”` : ''}`;
    case 'error':
      return e.message;
    case 'reconnecting':
      return `Reconnecting in ${Math.round(e.in / 1000)} s…`;
    case 'ping':
      return e.dir === 'out' ? 'Ping sent' : 'Ping from the server (answered)';
    case 'pong':
      return `Pong${e.ms !== undefined ? ` in ${e.ms} ms` : ''}`;
    default:
      return '';
  }
}

export function jsonOf(text: string | undefined): unknown {
  if (!text) return undefined;
  const t = text.trimStart();
  if (!(t.startsWith('{') || t.startsWith('['))) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
