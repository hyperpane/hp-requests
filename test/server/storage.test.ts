// Collections and environments in the project, secrets and the history on
// this machine, and a window hearing every change.

import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { invoke, stream, testHost } from '@hyperpane/sdk/testing';
import { type Collection, type Environment, type State, newCollection, newFolder, newHttp, newWs } from '../../src/shared/index.ts';
import { make } from '../../src/server/plugin.ts';
import { httpServer } from './servers.ts';

function setup(o: { maxHistory?: number } = {}) {
  const folder = mkdtempSync(path.join(os.tmpdir(), 'requests-store-'));
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'requests-data-'));
  const host = () => testHost({ id: 'requests', dataDir, projects: [{ id: 'p1', name: 'app', folder }] });
  const plugin = make({ pollEvery: 30, ...o })(host());
  return { folder, dataDir, plugin, call: <T>(req: Record<string, unknown>) => invoke<T>(plugin, req), fresh: () => make()(host()) };
}

test('collections are saved in the project and read back by a new process', async () => {
  const t = setup();
  const c: Collection = { ...newCollection('Shop'), variables: [{ key: 'base', value: 'http://x', enabled: true }] };
  const f = newFolder('Users');
  f.items = [newHttp({ name: 'List users', url: '{{base}}/users' }), newWs({ name: 'Live', url: 'ws://x' })];
  c.items = [f, newHttp({ name: 'Health', method: 'HEAD', url: '{{base}}/health' })];
  await t.call({ op: 'saveCollection', project: 'p1', collection: c });
  const c2 = { ...newCollection('Second') };
  await t.call({ op: 'saveCollection', project: 'p1', collection: c2 });
  const file = path.join(t.folder, '.hyperpane', 'requests', 'collections.json');
  assert.ok(existsSync(file));
  assert.ok(!existsSync(`${file}.tmp`));

  const s = await invoke<State>(t.fresh(), { op: 'state', project: 'p1' });
  assert.deepEqual(s.collections!.map((x) => x.name), ['Shop', 'Second']);
  assert.deepEqual(JSON.parse(JSON.stringify(s.collections![0])), JSON.parse(JSON.stringify(c)));

  await t.call({ op: 'orderCollections', project: 'p1', ids: [c2.id, c.id] });
  assert.deepEqual((await t.call<State>({ op: 'state', project: 'p1' })).collections!.map((x) => x.name), ['Second', 'Shop']);
  await t.call({ op: 'removeCollection', project: 'p1', id: c2.id });
  assert.deepEqual((await t.call<State>({ op: 'state', project: 'p1' })).collections!.map((x) => x.name), ['Shop']);
  await assert.rejects(t.call({ op: 'removeCollection', project: 'p1', id: 'nope' }), /That collection is gone/);
});

test('environments: secret values stay on this machine, not in the project', async () => {
  const t = setup();
  const env: Environment = { id: 'e1', name: 'Prod', vars: [
    { key: 'base', value: 'https://prod', enabled: true, secret: false },
    { key: 'token', value: 'TOP-SECRET-VALUE', enabled: true, secret: true },
  ] };
  await t.call({ op: 'saveEnvironment', project: 'p1', environment: env });
  const shared = readFileSync(path.join(t.folder, '.hyperpane', 'requests', 'environments.json'), 'utf8');
  assert.ok(!shared.includes('TOP-SECRET-VALUE'));
  assert.ok(shared.includes('https://prod'));
  const local = readFileSync(path.join(t.dataDir, 'projects', 'p1', 'secrets.json'), 'utf8');
  assert.ok(local.includes('TOP-SECRET-VALUE'));
  if (process.platform !== 'win32') {
    const { statSync } = await import('node:fs');
    assert.equal(statSync(path.join(t.dataDir, 'projects', 'p1', 'secrets.json')).mode & 0o777, 0o600);
  }
  // Read back whole, by a new process.
  const back = (await invoke<State>(t.fresh(), { op: 'state', project: 'p1' })).environments!;
  assert.deepEqual(back, [env]);

  // No longer secret: the value moves into the project.
  env.vars[1].secret = false;
  await t.call({ op: 'saveEnvironment', project: 'p1', environment: env });
  assert.ok(readFileSync(path.join(t.folder, '.hyperpane', 'requests', 'environments.json'), 'utf8').includes('TOP-SECRET-VALUE'));
  await t.call({ op: 'removeEnvironment', project: 'p1', id: 'e1' });
  assert.deepEqual((await t.call<State>({ op: 'state', project: 'p1' })).environments, []);
});

test('history: newest first, capped, cleared; on this machine only', async () => {
  const url = await httpServer((_req, res) => res.end('ok'));
  const t = setup({ maxHistory: 5 });
  for (let i = 0; i < 8; i++) await t.call({ op: 'send', project: 'p1', request: newHttp({ url: `${url}/${i}` }) });
  const h = (await t.call<State>({ op: 'state', project: 'p1' })).history!;
  assert.equal(h.length, 5);
  assert.equal(h[0].url, `${url}/7`);
  assert.equal(h[0].status, 200);
  assert.equal(h[4].url, `${url}/3`);
  assert.ok(!existsSync(path.join(t.folder, '.hyperpane', 'requests', 'history.json')));
  await t.call({ op: 'removeHistory', project: 'p1', id: h[0].id });
  assert.equal((await t.call<State>({ op: 'state', project: 'p1' })).history!.length, 4);
  await t.call({ op: 'removeHistory', project: 'p1' });
  assert.deepEqual((await t.call<State>({ op: 'state', project: 'p1' })).history, []);
});

test('watch: the whole state first, then each change, its own and the file’s', async () => {
  const t = setup();
  const s = stream<State>(t.plugin, { op: 'watch', project: 'p1' });
  const first = await s.next();
  assert.deepEqual(first, { collections: [], environments: [], history: [] });
  const c = newCollection('Watched');
  await t.call({ op: 'saveCollection', project: 'p1', collection: c });
  const next = await s.next();
  assert.deepEqual(next.collections?.map((x) => x.name), ['Watched']);
  // Changed by someone else (a git pull).
  await new Promise((r) => setTimeout(r, 50));
  const file = path.join(t.folder, '.hyperpane', 'requests', 'collections.json');
  writeFileSync(file, JSON.stringify({ version: 1, collections: [{ ...c, name: 'Pulled' }] }));
  for (;;) {
    const e = await s.next();
    if (e.collections?.[0]?.name === 'Pulled') break;
  }
  s.cancel();
});

test('import: a Postman collection and environment into the project', async () => {
  const t = setup();
  const col = await t.call<{ kind: string; name: string }>({ op: 'import', project: 'p1', data: JSON.stringify({ info: { name: 'P' }, item: [{ name: 'R', request: { method: 'GET', url: 'http://x' } }] }) });
  assert.deepEqual([col.kind, col.name], ['collection', 'P']);
  const env = await t.call<{ kind: string }>({ op: 'import', project: 'p1', data: { name: 'E', values: [{ key: 's', value: 'v', type: 'secret' }] } });
  assert.equal(env.kind, 'environment');
  const s = await t.call<State>({ op: 'state', project: 'p1' });
  assert.equal(s.collections![0].items[0].name, 'R');
  assert.deepEqual(s.environments![0].vars[0], { key: 's', value: 'v', enabled: true, secret: true });
  await assert.rejects(t.call({ op: 'import', project: 'p1', data: '{nope' }), /That isn’t JSON/);
  const curl = await t.call<{ method: string }>({ op: 'importCurl', command: 'curl -X PATCH http://x' });
  assert.equal(curl.method, 'PATCH');
  await assert.rejects(t.call({ op: 'importCurl', command: 'curl' }), /no URL/);
});
