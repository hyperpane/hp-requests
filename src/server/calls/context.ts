// What every group of calls shares: the host, the store, the options, and
// how a request's variables and inherited auth are found.

import { type Host, type JsonSpec, PluginError } from '@hyperpane/sdk/server';
import { type Context, type HttpRequest, type Request, effectiveAuth, normalizeRequest } from '../../shared/index.ts';
import { scope } from '../../shared/vars.ts';
import type { Store, StoreOptions } from '../store.ts';

export interface Options extends StoreOptions {
  /** Reconnecting's waits, in ms, the last one repeated. */
  backoff?: number[];
  maxMessage?: number;
}

export interface Deps {
  host: Host;
  store: Store;
  o: Options;
}

/** A group of calls and subscriptions by op, and what ends its work. */
export interface Group {
  calls?: NonNullable<JsonSpec['calls']>;
  subscriptions?: NonNullable<JsonSpec['subscriptions']>;
  shutdown?(): void;
}

export const projectOf = (p: unknown): string | null => (typeof p === 'string' && p ? p : null);

/** What a request's variables and inherited auth come from. */
export async function context({ host, store }: Deps, project: string | null, request: Request, ctx: Context | undefined) {
  const env = project ? await store.environment(project, ctx?.environment) : null;
  const collection = project ? await store.collection(project, ctx?.collection) : null;
  return { vars: scope(env, collection), auth: effectiveAuth(request.auth, collection, ctx?.folder), base: project ? host.projectFolder(project) : null };
}

export const httpOf = (r: unknown): HttpRequest => {
  const req = normalizeRequest((r ?? {}) as Partial<Request>);
  if (req.type === 'ws') throw new PluginError('That’s a WebSocket request: connect to it instead.');
  return req;
};
