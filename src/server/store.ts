// Where things are kept. Collections and environments go in the project
// (`.hyperpane/requests/`), to be committed with it as Postman collections are
// kept in a repository; the values of secret variables, and the history,
// stay on this machine, in the plugin's data folder. Files are written
// whole (a temporary file, then renamed over), one write at a time per
// project, and watched: a window hears every change, its own or a `git
// pull`'s.

import { EventEmitter } from 'node:events';
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { type Host, PluginError } from '@hyperpane/sdk/server';
import { type Collection, type Environment, type HistoryEntry, MAX_HISTORY, type State, normalizeCollection, normalizeEnvironment } from '../shared/index.ts';

const COLLECTIONS = 'collections.json';
const ENVIRONMENTS = 'environments.json';

export interface StoreOptions {
  /** How often the project's files are looked at while watched, in ms. */
  pollEvery?: number;
  maxHistory?: number;
}

type Secrets = Record<string, Record<string, string>>;

async function readJson<T>(file: string, fallback: T): Promise<T> {
  let text: string;
  try {
    text = await readFile(file, 'utf8');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return fallback;
    throw new PluginError(`Couldn’t read ${path.basename(file)}: ${(e as Error).message}`);
  }
  try {
    return JSON.parse(text) as T;
  } catch (e) {
    throw new PluginError(`${path.basename(file)} isn’t JSON any more (${(e as Error).message}): fix it, or remove it to start again.`);
  }
}

async function writeJson(file: string, value: unknown, mode?: number): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, mode ? { mode } : undefined);
  await rename(tmp, file);
}

export class Store {
  readonly #host: Host;
  readonly #o: Required<StoreOptions>;
  readonly #changes = new EventEmitter();
  readonly #locks = new Map<string, Promise<unknown>>();

  constructor(host: Host, o: StoreOptions = {}) {
    this.#host = host;
    this.#o = { pollEvery: o.pollEvery ?? 1500, maxHistory: o.maxHistory ?? MAX_HISTORY };
    this.#changes.setMaxListeners(0);
  }

  /** The project's folder for what's shared with it. */
  async #shared(project: string): Promise<string> {
    if (typeof project !== 'string' || !project) throw new PluginError('Open a project to keep collections in it.');
    return this.#host.projectStorage(project);
  }

  /** This machine's folder for a project: secrets and history. */
  #local(project: string): string {
    return path.join(this.#host.dataDir, 'projects', project.replace(/[^A-Za-z0-9._-]/g, '_'));
  }

  /** Runs one change of a project's files at a time. */
  #lock<T>(project: string, fn: () => Promise<T>): Promise<T> {
    const before = this.#locks.get(project) ?? Promise.resolve();
    const run = before.then(fn, fn);
    this.#locks.set(
      project,
      run.catch(() => {}),
    );
    return run;
  }

  async collections(project: string): Promise<Collection[]> {
    const kept = await readJson<{ collections?: unknown[] }>(path.join(await this.#shared(project), COLLECTIONS), {});
    return (Array.isArray(kept.collections) ? kept.collections : []).map((c) => normalizeCollection(c as Partial<Collection>));
  }

  async collection(project: string, id: string | null | undefined): Promise<Collection | null> {
    if (!id) return null;
    return (await this.collections(project)).find((c) => c.id === id) ?? null;
  }

  async #secrets(project: string): Promise<Secrets> {
    return readJson<Secrets>(path.join(this.#local(project), 'secrets.json'), {});
  }

  /** Environments, with their secret values put back. */
  async environments(project: string): Promise<Environment[]> {
    const kept = await readJson<{ environments?: unknown[] }>(path.join(await this.#shared(project), ENVIRONMENTS), {});
    const secrets = await this.#secrets(project);
    return (Array.isArray(kept.environments) ? kept.environments : []).map((x) => {
      const e = normalizeEnvironment(x as Partial<Environment>);
      for (const v of e.vars) if (v.secret) v.value = secrets[e.id]?.[v.key] ?? '';
      return e;
    });
  }

  async environment(project: string, id: string | null | undefined): Promise<Environment | null> {
    if (!id) return null;
    return (await this.environments(project)).find((e) => e.id === id) ?? null;
  }

  async history(project: string): Promise<HistoryEntry[]> {
    const h = await readJson<HistoryEntry[]>(path.join(this.#local(project), 'history.json'), []);
    return Array.isArray(h) ? h : [];
  }

  async state(project: string): Promise<State> {
    return { collections: await this.collections(project), environments: await this.environments(project), history: await this.history(project) };
  }

  async #writeCollections(project: string, list: Collection[]) {
    await writeJson(path.join(await this.#shared(project), COLLECTIONS), { version: 1, collections: list });
    this.#changes.emit(project, { collections: list });
  }

  /** Adds a collection, or replaces the one with its id. */
  saveCollection(project: string, c: unknown): Promise<Collection> {
    const next = normalizeCollection(c as Partial<Collection>);
    return this.#lock(project, async () => {
      const list = await this.collections(project);
      const i = list.findIndex((x) => x.id === next.id);
      if (i >= 0) list[i] = next;
      else list.push(next);
      await this.#writeCollections(project, list);
      return next;
    });
  }

  removeCollection(project: string, id: string): Promise<void> {
    return this.#lock(project, async () => {
      const list = await this.collections(project);
      if (!list.some((c) => c.id === id)) throw new PluginError('That collection is gone.');
      await this.#writeCollections(
        project,
        list.filter((c) => c.id !== id),
      );
    });
  }

  /** Puts the collections in this order (ids it doesn't name stay last). */
  orderCollections(project: string, ids: string[]): Promise<void> {
    return this.#lock(project, async () => {
      const list = await this.collections(project);
      const at = (c: Collection) => {
        const i = ids.indexOf(c.id);
        return i < 0 ? ids.length : i;
      };
      await this.#writeCollections(
        project,
        [...list].sort((a, b) => at(a) - at(b)),
      );
    });
  }

  /** Writes the environments: secret values to this machine, '' in their
   * place in the project. */
  async #writeEnvironments(project: string, list: Environment[]) {
    const secrets: Secrets = {};
    const shared = list.map((e) => ({
      ...e,
      vars: e.vars.map((v) => {
        if (!v.secret) return v;
        (secrets[e.id] ??= {})[v.key] = v.value;
        return { ...v, value: '' };
      }),
    }));
    await writeJson(path.join(this.#local(project), 'secrets.json'), secrets, 0o600);
    await writeJson(path.join(await this.#shared(project), ENVIRONMENTS), { version: 1, environments: shared });
    this.#changes.emit(project, { environments: list });
  }

  saveEnvironment(project: string, e: unknown): Promise<Environment> {
    const next = normalizeEnvironment(e as Partial<Environment>);
    return this.#lock(project, async () => {
      const list = await this.environments(project);
      const i = list.findIndex((x) => x.id === next.id);
      if (i >= 0) list[i] = next;
      else list.push(next);
      await this.#writeEnvironments(project, list);
      return next;
    });
  }

  removeEnvironment(project: string, id: string): Promise<void> {
    return this.#lock(project, async () => {
      const list = await this.environments(project);
      if (!list.some((e) => e.id === id)) throw new PluginError('That environment is gone.');
      await this.#writeEnvironments(
        project,
        list.filter((e) => e.id !== id),
      );
    });
  }

  /** Adds a sent request to the history (the newest first, the oldest
   * dropped past the limit). */
  addHistory(project: string, entry: HistoryEntry): Promise<void> {
    return this.#lock(project, async () => {
      const list = [entry, ...(await this.history(project))].slice(0, this.#o.maxHistory);
      await writeJson(path.join(this.#local(project), 'history.json'), list, 0o600);
      this.#changes.emit(project, { history: list });
    });
  }

  removeHistory(project: string, id: string | null): Promise<void> {
    return this.#lock(project, async () => {
      const list = id ? (await this.history(project)).filter((h) => h.id !== id) : [];
      await writeJson(path.join(this.#local(project), 'history.json'), list, 0o600);
      this.#changes.emit(project, { history: list });
    });
  }

  /** Sends the whole state now, then what changes, until `signal` aborts.
   * The project's files are looked at every so often, for changes made
   * elsewhere (an editor, git). */
  async watch(project: string, send: (s: State) => void, signal: AbortSignal): Promise<void> {
    const dir = await this.#shared(project);
    const files = [COLLECTIONS, ENVIRONMENTS].map((f) => path.join(dir, f));
    const mtime = async (f: string) => (await stat(f).catch(() => null))?.mtimeMs ?? 0;
    let seen = await Promise.all(files.map(mtime));
    const own = (s: State) => {
      send(s);
    };
    this.#changes.on(project, own);
    try {
      send(await this.state(project));
      while (!signal.aborted) {
        await new Promise<void>((resolve) => {
          const t = setTimeout(resolve, this.#o.pollEvery);
          signal.addEventListener('abort', () => (clearTimeout(t), resolve()), { once: true });
        });
        if (signal.aborted) break;
        const now = await Promise.all(files.map(mtime));
        if (now[0] !== seen[0]) {
          try {
            send({ collections: await this.collections(project) });
          } catch (e) {
            this.#host.log((e as Error).message);
          }
        }
        if (now[1] !== seen[1]) {
          try {
            send({ environments: await this.environments(project) });
          } catch (e) {
            this.#host.log((e as Error).message);
          }
        }
        seen = now;
      }
    } finally {
      this.#changes.off(project, own);
    }
  }
}
