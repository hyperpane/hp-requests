// Variables (`{{name}}`) and a URL's query, the same in the window (which
// highlights what won't resolve) and the server part (which fills them in).

import type { Collection, Environment, KV } from './index.ts';

export const VAR = /\{\{\s*([^{}]+?)\s*\}\}/g;

/** The dynamic variables: a new value each time one is used. */
export const DYNAMIC: Record<string, () => string> = {
  $timestamp: () => String(Math.floor(Date.now() / 1000)),
  $isoTimestamp: () => new Date().toISOString(),
  $uuid: () => crypto.randomUUID(),
  $guid: () => crypto.randomUUID(),
  $randomInt: () => String(Math.floor(Math.random() * 1001)),
};

/** The variables in effect, by name: the collection's, then the
 * environment's over them (an environment is chosen for the moment, so it
 * wins). Disabled rows don't count. */
export function scope(env: Environment | null | undefined, collection: Collection | null | undefined): Map<string, string> {
  const vars = new Map<string, string>();
  for (const v of collection?.variables ?? []) if (v.enabled && v.key) vars.set(v.key, v.value);
  for (const v of env?.vars ?? []) if (v.enabled && v.key) vars.set(v.key, v.value);
  return vars;
}

/** Fills in the variables a text has. A variable's value may use others
 * (a few levels deep); what can't be found stays as it was and is named in
 * `unresolved`. */
export function substitute(text: string, vars: Map<string, string>, unresolved?: Set<string>): string {
  const fill = (t: string, depth: number): string =>
    t.replace(VAR, (whole, raw: string) => {
      const name = raw.trim();
      const dyn = DYNAMIC[name];
      if (dyn) return dyn();
      const v = vars.get(name);
      if (v === undefined) {
        unresolved?.add(name);
        return whole;
      }
      return depth < 4 && v.includes('{{') ? fill(v, depth + 1) : v;
    });
  return text.includes('{{') ? fill(text, 0) : text;
}

/** A text's pieces, each a plain run or a variable (resolved or not), for
 * highlighting. */
export function pieces(text: string, vars: Map<string, string>): { text: string; variable?: 'ok' | 'missing' }[] {
  const out: { text: string; variable?: 'ok' | 'missing' }[] = [];
  let last = 0;
  for (const m of text.matchAll(VAR)) {
    if (m.index > last) out.push({ text: text.slice(last, m.index) });
    const name = m[1].trim();
    out.push({ text: m[0], variable: DYNAMIC[name] || vars.has(name) ? 'ok' : 'missing' });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out;
}

/** The variables a text uses that can't be found. */
export function missing(text: string, vars: Map<string, string>): string[] {
  const out = new Set<string>();
  substitute(text, vars, out);
  return [...out];
}

/** A URL's query as rows, as typed (not decoded, so variables in it stay
 * as they are). */
export function queryOf(url: string): KV[] {
  const q = url.indexOf('?');
  if (q < 0) return [];
  let query = url.slice(q + 1);
  const hash = query.indexOf('#');
  if (hash >= 0) query = query.slice(0, hash);
  if (!query) return [];
  return query.split('&').map((part) => {
    const eq = part.indexOf('=');
    return { key: eq < 0 ? part : part.slice(0, eq), value: eq < 0 ? '' : part.slice(eq + 1), enabled: true };
  });
}

/** The URL with its query made of the enabled rows. */
export function withQuery(url: string, params: KV[]): string {
  let base = url;
  let hash = '';
  const h = base.indexOf('#');
  if (h >= 0) {
    hash = base.slice(h);
    base = base.slice(0, h);
  }
  const q = base.indexOf('?');
  if (q >= 0) base = base.slice(0, q);
  const query = params
    .filter((p) => p.enabled && (p.key || p.value))
    .map((p) => (p.value ? `${p.key}=${p.value}` : p.key))
    .join('&');
  return base + (query ? `?${query}` : '') + hash;
}

/** The params after the URL was edited: its query's rows, then the
 * disabled ones it doesn't have (they stay in the table). */
export function paramsFromUrl(url: string, before: KV[]): KV[] {
  const now = queryOf(url);
  return [...now, ...before.filter((p) => !p.enabled)];
}
