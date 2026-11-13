// cURL and Postman: a request as a cURL command (variables filled in), a
// command as a request, a Postman collection or environment added to the
// project, and a collection as a Postman file to save.

import { Readable } from 'node:stream';
import { PluginError } from '@hyperpane/sdk/server';
import { fromCurl, toCurl } from '../../shared/curl/index.ts';
import type { HttpRequest } from '../../shared/index.ts';
import { fromPostman, fromPostmanEnvironment, isPostmanEnvironment, toPostman } from '../../shared/postman.ts';
import { substitute } from '../../shared/vars.ts';
import { type Deps, type Group, context, httpOf, projectOf } from './context.ts';

export function formats(d: Deps): Group {
  const { store } = d;
  return {
    calls: {
      exportCurl: async ({ project, request, context: ctx }) => {
        const r = httpOf(request);
        const { vars, auth } = await context(d, projectOf(project), r, ctx);
        const fill = (s: string) => substitute(s, vars);
        const filled: HttpRequest = JSON.parse(JSON.stringify(r), (_k, v) => (typeof v === 'string' ? fill(v) : v));
        const a = JSON.parse(JSON.stringify(auth), (_k, v) => (typeof v === 'string' ? fill(v) : v));
        return toCurl(filled, a);
      },

      importCurl: ({ command }) => {
        try {
          return fromCurl(String(command ?? ''));
        } catch (e) {
          throw new PluginError((e as Error).message);
        }
      },

      // A Postman collection or environment's JSON (text or parsed):
      // added to the project.
      import: async ({ project, data }) => {
        let v: unknown = data;
        if (typeof data === 'string') {
          try {
            v = JSON.parse(data);
          } catch (e) {
            throw new PluginError(`That isn’t JSON: ${(e as Error).message}`);
          }
        }
        try {
          if (isPostmanEnvironment(v)) {
            const env = await store.saveEnvironment(String(project), fromPostmanEnvironment(v));
            return { kind: 'environment', id: env.id, name: env.name };
          }
          const c = await store.saveCollection(String(project), fromPostman(v));
          return { kind: 'collection', id: c.id, name: c.name };
        } catch (e) {
          throw e instanceof PluginError ? e : new PluginError((e as Error).message);
        }
      },

      // A collection as a Postman v2.1 file, for the app to save.
      exportPostman: async ({ project, id }) => {
        const c = await store.collection(String(project), String(id));
        if (!c) throw new PluginError('That collection is gone.');
        const bytes = Buffer.from(`${JSON.stringify(toPostman(c), null, 2)}\n`);
        return { name: `${c.name.replace(/[^\w .-]+/g, '_') || 'collection'}.postman_collection.json`, size: bytes.length, data: Readable.from([bytes]) };
      },
    },
  };
}
