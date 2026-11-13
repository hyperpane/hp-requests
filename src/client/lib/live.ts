// What's going on in each open tab, kept apart from the tab's editor so it
// goes on while another tab is shown: a request being sent and its answer,
// a WebSocket's connection and messages, an event stream's events.

import { useSyncExternalStore } from 'react';
import { type Context, type HttpRequest, ID, type Response, type SseEvent, type WsEvent, type WsRequest } from '../../shared/index.ts';
import type { Host } from './hooks.ts';

/** The most messages kept for a tab: the oldest go first. */
export const MAX_EVENTS = 5000;

export type WsStatus = 'idle' | 'connecting' | 'open' | 'closed';

export interface TabLive {
  sending?: AbortController;
  response?: Response;
  error?: string;
  /** WebSocket: its events (sent ones too) and where it's at. */
  ws?: { status: WsStatus; events: (WsEvent & { n: number })[]; cancel?: () => void; protocol?: string | null; closeCode?: number | null };
  /** Event stream. */
  sse?: { status: 'idle' | 'connecting' | 'open' | 'closed'; events: (SseEvent & { n: number })[]; cancel?: () => void; error?: string };
}

export class Live {
  #tabs = new Map<string, TabLive>();
  #listeners = new Set<() => void>();
  #version = 0;
  #n = 0;
  host: Host;

  constructor(host: Host) {
    this.host = host;
  }

  subscribe = (fn: () => void) => {
    this.#listeners.add(fn);
    return () => this.#listeners.delete(fn);
  };

  get version() {
    return this.#version;
  }

  get(key: string): TabLive {
    return this.#tabs.get(key) ?? {};
  }

  #set(key: string, change: (t: TabLive) => TabLive) {
    this.#tabs.set(key, change(this.get(key)));
    this.#version++;
    for (const f of this.#listeners) f();
  }

  /** Sends an HTTP request; its answer (or why not) is the tab's. */
  async send(key: string, project: string | null, request: HttpRequest, context: Context) {
    this.get(key).sending?.abort();
    const ac = new AbortController();
    this.#set(key, (t) => ({ ...t, sending: ac, error: undefined }));
    try {
      // host.stream, rather than call, so the signal can cancel it.
      const response = await this.host.stream<Response>(ID, { op: 'send', project, request, context }, { signal: ac.signal });
      if (ac.signal.aborted) return;
      this.#set(key, (t) => ({ ...t, sending: undefined, response, error: undefined }));
    } catch (e) {
      if (ac.signal.aborted) return;
      this.#set(key, (t) => ({ ...t, sending: undefined, response: undefined, error: (e as Error).message }));
    }
  }

  cancel(key: string) {
    const t = this.get(key);
    t.sending?.abort();
    t.sse?.cancel?.();
    this.#set(key, (x) => ({ ...x, sending: undefined, error: t.sending ? 'Cancelled.' : x.error }));
  }

  connectWs(key: string, project: string | null, request: WsRequest, context: Context) {
    this.get(key).ws?.cancel?.();
    const push = (e: WsEvent) =>
      this.#set(key, (t) => {
        const ws = t.ws ?? { status: 'connecting' as WsStatus, events: [] };
        let status = ws.status;
        let protocol = ws.protocol;
        let closeCode = ws.closeCode;
        if (e.type === 'connecting') status = 'connecting';
        if (e.type === 'open') {
          status = 'open';
          protocol = e.protocol;
          closeCode = null;
        }
        if (e.type === 'close') {
          status = 'closed';
          closeCode = e.code;
        }
        const events = [...ws.events, { ...e, n: ++this.#n }];
        return { ...t, ws: { ...ws, status, protocol, closeCode, events: events.length > MAX_EVENTS ? events.slice(-MAX_EVENTS) : events } };
      });
    this.#set(key, (t) => ({ ...t, ws: { status: 'connecting', events: t.ws?.events ?? [], cancel: undefined } }));
    const cancel = this.host.subscribe<WsEvent>(ID, { op: 'ws', id: key, project, request, context }, push, {
      resume: false,
      onEnd: (error) => {
        if (error) push({ type: 'error', at: Date.now(), message: error });
        this.#set(key, (t) => ({ ...t, ws: t.ws && { ...t.ws, status: t.ws.status === 'idle' ? 'idle' : 'closed', cancel: undefined } }));
      },
    });
    this.#set(key, (t) => ({ ...t, ws: t.ws && { ...t.ws, cancel } }));
  }

  /** Closes it with the handshake (the subscription ends after). */
  async disconnectWs(key: string, code?: number, reason?: string) {
    const ws = this.get(key).ws;
    if (!ws) return;
    if (ws.status === 'connecting') {
      ws.cancel?.();
      this.#set(key, (t) => ({ ...t, ws: t.ws && { ...t.ws, status: 'closed', cancel: undefined } }));
      return;
    }
    try {
      await this.host.call(ID, { op: 'wsClose', id: key, code, reason });
    } catch {
      ws.cancel?.();
    }
  }

  /** Puts a line of its own in the stream (a send that failed). */
  note(key: string, message: string) {
    this.#set(key, (t) => ({ ...t, ws: t.ws && { ...t.ws, events: [...t.ws.events, { type: 'error', at: Date.now(), message, n: ++this.#n }] } }));
  }

  clearWs(key: string) {
    this.#set(key, (t) => ({ ...t, ws: t.ws && { ...t.ws, events: [] } }));
  }

  connectSse(key: string, project: string | null, request: HttpRequest, context: Context) {
    this.get(key).sse?.cancel?.();
    this.#set(key, (t) => ({ ...t, sse: { status: 'connecting', events: t.sse?.events ?? [] } }));
    const cancel = this.host.subscribe<SseEvent>(
      ID,
      { op: 'sse', project, request, context },
      (e) =>
        this.#set(key, (t) => {
          const s = t.sse ?? { status: 'connecting' as const, events: [] };
          const events = [...s.events, { ...e, n: ++this.#n }];
          return { ...t, sse: { ...s, status: e.type === 'end' ? 'closed' : 'open', events: events.length > MAX_EVENTS ? events.slice(-MAX_EVENTS) : events } };
        }),
      {
        resume: false,
        onEnd: (error) => this.#set(key, (t) => ({ ...t, sse: t.sse && { ...t.sse, status: 'closed', cancel: undefined, error } })),
      },
    );
    this.#set(key, (t) => ({ ...t, sse: t.sse && { ...t.sse, cancel } }));
  }

  disconnectSse(key: string) {
    this.get(key).sse?.cancel?.();
    this.#set(key, (t) => ({ ...t, sse: t.sse && { ...t.sse, status: 'closed', cancel: undefined } }));
  }

  clearSse(key: string) {
    this.#set(key, (t) => ({ ...t, sse: t.sse && { ...t.sse, events: [] } }));
  }

  /** A tab closed: what it had open goes. */
  drop(key: string) {
    const t = this.get(key);
    t.sending?.abort();
    t.ws?.cancel?.();
    t.sse?.cancel?.();
    this.#tabs.delete(key);
    this.#version++;
    for (const f of this.#listeners) f();
  }

  dropAll() {
    for (const k of [...this.#tabs.keys()]) this.drop(k);
  }
}

/** A tab's live state, as it changes. */
export function useLive(live: Live, key: string): TabLive {
  useSyncExternalStore(live.subscribe, () => live.version);
  return live.get(key);
}
