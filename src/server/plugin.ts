// The server part's calls, apart from main.ts so the tests can make it with
// a test host. Every request goes from here, not from the window: no CORS,
// the server's own localhost in reach, and TLS as the request says. The
// calls are in groups, by domain (calls/):
//
// - storage: state (collections, environments, history), saveCollection,
//   removeCollection, orderCollections, saveEnvironment,
//   removeEnvironment, removeHistory; the subscription watch (a project's
//   state, again on every change).
// - http: send (an HTTP request: its answer), body (a sent request's body,
//   as a stream to save).
// - formats: exportCurl, importCurl, import (a Postman collection or
//   environment), exportPostman (a collection, as a stream to save).
// - sse: the subscription sse (an event stream's events).
// - ws: the subscription ws (a WebSocket, its events until it closes);
//   wsSend, wsPing, wsClose.

import { type Host, json } from '@hyperpane/sdk/server';
import { Store } from './store.ts';
import type { Group, Options } from './calls/context.ts';
import { formats } from './calls/formats.ts';
import { httpCalls } from './calls/http.ts';
import { sse } from './calls/sse.ts';
import { storage } from './calls/storage.ts';
import { websockets } from './calls/ws.ts';

export type { Options };

export function make(o: Options = {}) {
  return json((host: Host) => {
    const d = { host, store: new Store(host, o), o };
    const groups: Group[] = [storage(d), httpCalls(d), formats(d), sse(d), websockets(d)];
    return {
      calls: Object.assign({}, ...groups.map((g) => g.calls ?? {})),
      subscriptions: Object.assign({}, ...groups.map((g) => g.subscriptions ?? {})),
      shutdown() {
        for (const g of groups) g.shutdown?.();
      },
    };
  });
}

export const plugin = make();
