// A URL as typed, made one (and checked for variables that aren't set),
// and a file's path as a request names it.

import path from 'node:path';
import { PluginError } from '@hyperpane/sdk/server';

/** A URL as typed, made one: `localhost:3000/x` is http. */
export function parseUrl(text: string, schemes: string[] = ['http:', 'https:'], unresolved: string[] = []): URL {
  const t = text.trim();
  if (!t) throw new PluginError('Type a URL to send it to.');
  // A variable that isn't set can stay in a path or a query (it goes as
  // typed), but not in the host: say which.
  const unset = () => {
    const named = unresolved.filter((v) => t.includes(`{{${v}}}`) || new RegExp(`\\{\\{\\s*${v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\}\\}`).test(t));
    return new PluginError(`The URL uses ${named.map((m) => `{{${m}}}`).join(', ') || 'a variable'}, which ${named.length > 1 ? 'aren’t' : 'isn’t'} set in the environment or the collection.`);
  };
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(t) ? t : `${schemes[0] === 'ws:' ? 'ws' : 'http'}://${t}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    if (t.includes('{{')) throw unset();
    throw new PluginError(`“${t}” isn’t a URL.`);
  }
  if (/\{\{|%7B%7B/i.test(url.host) || /^\{\{/.test(t)) throw unset();
  if (!schemes.includes(url.protocol)) throw new PluginError(`Only ${schemes.map((s) => `${s}//`).join(' and ')} URLs go here; this one is ${url.protocol}//.`);
  return url;
}

/** Where a file the request names is: as typed when it's absolute, else in
 * the project's folder. */
export function filePath(p: string, base: string | null): string {
  const t = p.trim().replace(/^~(?=\/|$)/, process.env.HOME ?? '~');
  if (!t) throw new PluginError('Pick a file to send: its path on the server.');
  return path.isAbsolute(t) || !base ? path.resolve(t) : path.join(base, t);
}
