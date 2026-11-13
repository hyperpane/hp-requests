// Sending HTTP requests to servers on this machine: methods, headers, each
// kind of body, redirects, compression, timeouts and cancelling, failures
// in plain words, variables and auth.

import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import zlib from 'node:zlib';
import { invoke, testHost } from '@hyperpane/sdk/testing';
import { type Collection, type Environment, type HttpRequest, type Response, emptyAuth, newCollection, newFolder, newHttp } from '../../src/shared/index.ts';
import { make } from '../../src/server/plugin.ts';
import { bodyOf, httpServer, listen, selfSigned } from './servers.ts';

const text = (r: Response) => Buffer.from(r.body).toString('utf8');
const header = (r: Response, name: string) => r.headers.filter(([k]) => k.toLowerCase() === name).map(([, v]) => v);

function setup() {
  const folder = mkdtempSync(path.join(os.tmpdir(), 'requests-project-'));
  const host = testHost({ id: 'requests', projects: [{ id: 'p1', name: 'app', folder }] });
  const plugin = make()(host);
  const call = <T>(req: Record<string, unknown>, signal?: AbortSignal) => invoke<T>(plugin, req, { signal });
  const send = (request: HttpRequest, o: { context?: Record<string, unknown>; signal?: AbortSignal; project?: string | null } = {}) =>
    call<Response>({ op: 'send', project: o.project === undefined ? 'p1' : o.project, request, context: o.context }, o.signal);
  return { folder, host, plugin, call, send };
}

/** Answers with what it got: method, url, headers (raw), body. */
async function echo() {
  return httpServer(async (req, res) => {
    const body = await bodyOf(req);
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ method: req.method, url: req.url, raw: req.rawHeaders, headers: req.headers, body: body.toString('utf8') }));
  });
}
type Echo = { method: string; url: string; raw: string[]; headers: Record<string, string>; body: string };
const got = (r: Response) => JSON.parse(text(r)) as Echo;

test('methods, custom ones too, and HEAD without a body', async () => {
  const url = await echo();
  const t = setup();
  for (const method of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'PURGE']) {
    const r = await t.send(newHttp({ method, url: `${url}/x?a=1` }));
    assert.equal(r.status, 200);
    assert.equal(got(r).method, method);
    assert.equal(got(r).url, '/x?a=1');
  }
  const head = await t.send(newHttp({ method: 'HEAD', url }));
  assert.equal(head.status, 200);
  assert.equal(head.size, 0);
  assert.equal(head.httpVersion, '1.1');
  assert.match(head.remote ?? '', /^127\.0\.0\.1:\d+$/);
});

test('headers go as typed (case, repeats, disabled ones left out), with defaults where none was given', async () => {
  const url = await echo();
  const t = setup();
  const r = await t.send(
    newHttp({
      url,
      headers: [
        { key: 'X-Custom-Case', value: 'One', enabled: true },
        { key: 'X-Twice', value: 'a', enabled: true },
        { key: 'X-Twice', value: 'b', enabled: true },
        { key: 'X-Off', value: 'no', enabled: false },
      ],
    }),
  );
  const raw = got(r).raw;
  assert.ok(raw.includes('X-Custom-Case'));
  assert.deepEqual(
    raw.flatMap((v, i) => (raw[i - 1] === 'X-Twice' && i % 2 ? [v] : [])),
    ['a', 'b'],
  );
  assert.ok(!raw.includes('X-Off'));
  assert.match(got(r).headers['user-agent'], /^hyperpane-requests/);
  assert.equal(got(r).headers.accept, '*/*');
  assert.ok(r.sent.headers.some(([k, v]) => k === 'X-Custom-Case' && v === 'One'));
  // Response headers in order, repeated ones kept.
  const cookies = await httpServer((_req, res) => {
    res.setHeader('Set-Cookie', ['a=1; Path=/', 'b=2; HttpOnly']);
    res.end('ok');
  });
  const c = await t.send(newHttp({ url: cookies }));
  assert.deepEqual(header(c, 'set-cookie'), ['a=1; Path=/', 'b=2; HttpOnly']);
});

test('bodies: JSON, text by type, urlencoded, multipart with a file, binary, GraphQL', async () => {
  const url = await echo();
  const t = setup();
  const file = path.join(t.folder, 'pic.png');
  writeFileSync(file, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 255]));
  const base = () => newHttp({ method: 'POST', url });

  const json = base();
  json.body = { ...json.body, kind: 'json', text: '{"a":1}' };
  let e = got(await t.send(json));
  assert.equal(e.headers['content-type'], 'application/json');
  assert.equal(e.body, '{"a":1}');
  assert.equal(e.headers['content-length'], '7');

  const xml = base();
  xml.body = { ...xml.body, kind: 'text', text: '<a/>', textType: 'xml' };
  e = got(await t.send(xml));
  assert.equal(e.headers['content-type'], 'application/xml');

  // A Content-Type of one's own wins.
  xml.headers = [{ key: 'content-type', value: 'text/xml; charset=utf-8', enabled: true }];
  e = got(await t.send(xml));
  assert.equal(e.headers['content-type'], 'text/xml; charset=utf-8');

  const form = base();
  form.body = { ...form.body, kind: 'urlencoded', form: [
    { key: 'name', value: 'a b&c', enabled: true },
    { key: 'off', value: 'x', enabled: false },
    { key: 'n', value: 'é', enabled: true },
  ] };
  e = got(await t.send(form));
  assert.equal(e.headers['content-type'], 'application/x-www-form-urlencoded');
  assert.equal(e.body, 'name=a+b%26c&n=%C3%A9');

  const multi = base();
  multi.body = { ...multi.body, kind: 'multipart', multipart: [
    { key: 'title', value: 'hello', enabled: true, type: 'text' },
    // Relative paths are in the project's folder.
    { key: 'upload', value: 'pic.png', enabled: true, type: 'file' },
  ] };
  const m = await t.send(multi);
  e = got(m);
  const boundary = /boundary=(.+)$/.exec(e.headers['content-type'])![1];
  assert.match(e.body, new RegExp(`--${boundary}\\r\\nContent-Disposition: form-data; name="title"\\r\\n\\r\\nhello\\r\\n`));
  assert.match(e.body, /name="upload"; filename="pic.png"\r\nContent-Type: image\/png\r\n\r\n.PNG\x00\x01\x02/u);
  assert.ok(e.body.endsWith(`--${boundary}--\r\n`));
  assert.equal(Number(e.headers['content-length']), m.sent.bodySize);

  const bin = base();
  bin.body = { ...bin.body, kind: 'binary', file };
  const b = await t.send(bin);
  assert.equal(got(b).headers['content-type'], 'image/png');
  assert.equal(got(b).headers['content-length'], '8');

  const missingFile = base();
  missingFile.body = { ...missingFile.body, kind: 'binary', file: '/nope/nothing.bin' };
  await assert.rejects(t.send(missingFile), /Couldn’t read \/nope\/nothing.bin: there’s no such file/);

  const gql = base();
  gql.body = { ...gql.body, kind: 'graphql', graphql: { query: 'query { me { id } }', variables: '{"x": 1}' } };
  e = got(await t.send(gql));
  assert.deepEqual(JSON.parse(e.body), { query: 'query { me { id } }', variables: { x: 1 } });
  assert.equal(e.headers['content-type'], 'application/json');
});

test('redirects: followed with the chain kept, or not; POST becomes GET on 303, 307 keeps it', async () => {
  const url = await httpServer(async (req, res) => {
    const body = await bodyOf(req);
    if (req.url === '/a') return res.writeHead(302, { Location: '/b' }).end();
    if (req.url === '/b') return res.writeHead(303, { Location: '/c' }).end();
    if (req.url === '/keep') return res.writeHead(307, { Location: '/c' }).end();
    if (req.url === '/loop') return res.writeHead(302, { Location: '/loop' }).end();
    res.end(`${req.method} ${req.url} ${body}`);
  });
  const t = setup();
  const r = await t.send(newHttp({ url: `${url}/a` }));
  assert.equal(text(r), 'GET /c ');
  assert.deepEqual(
    r.redirects.map((h) => [h.status, h.location]),
    [
      [302, '/b'],
      [303, '/c'],
    ],
  );
  assert.equal(r.url, `${url}/c`);

  const post = newHttp({ method: 'POST', url: `${url}/b` });
  post.body = { ...post.body, kind: 'text', text: 'x' };
  assert.equal(text(await t.send(post)), 'GET /c ');
  post.url = `${url}/keep`;
  assert.equal(text(await t.send(post)), 'POST /c x');

  const stay = newHttp({ url: `${url}/a` });
  stay.settings.followRedirects = false;
  const s = await t.send(stay);
  assert.equal(s.status, 302);
  assert.deepEqual(header(s, 'location'), ['/b']);
  assert.equal(s.redirects.length, 0);

  await assert.rejects(t.send(newHttp({ url: `${url}/loop` })), /redirected more than 10 times/);
});

test('gzip, deflate and br are decompressed; the size on the wire is kept', async () => {
  const plain = Buffer.from('hello '.repeat(1000));
  const url = await httpServer((req, res) => {
    const enc = req.url!.slice(1);
    const body = enc === 'gzip' ? zlib.gzipSync(plain) : enc === 'deflate' ? zlib.deflateSync(plain) : enc === 'br' ? zlib.brotliCompressSync(plain) : Buffer.from('not gzip at all');
    res.writeHead(200, { 'Content-Encoding': enc === 'bad' ? 'gzip' : enc });
    res.end(body);
  });
  const t = setup();
  for (const enc of ['gzip', 'deflate', 'br']) {
    const r = await t.send(newHttp({ url: `${url}/${enc}` }));
    assert.equal(text(r), plain.toString(), enc);
    assert.ok(r.wireSize < r.size, enc);
  }
  const bad = await t.send(newHttp({ url: `${url}/bad` }));
  assert.equal(text(bad), 'not gzip at all');
  assert.match(header(bad, 'x-hyperpane-note')[0], /couldn’t be decompressed/);
});

test('timings are measured; a big body is cut at the limit and says so', async () => {
  const url = await httpServer((_req, res) => {
    res.write('a'.repeat(1000));
    setTimeout(() => res.end('b'.repeat(1000)), 30);
  });
  const t = setup();
  const r = await t.send(newHttp({ url: url.replace('127.0.0.1', 'localhost') }));
  assert.equal(r.size, 2000);
  assert.ok(r.timings.dns !== null && r.timings.connect !== null);
  assert.equal(r.timings.tls, null);
  assert.ok(r.timings.download! >= 20, `download ${r.timings.download}`);
  assert.ok(r.timings.total >= r.timings.download!);

  const { send, prepare } = await import('../../src/server/http/index.ts');
  const cut = await send(await prepare(newHttp({ url }), new Map(), emptyAuth('none'), null), undefined, 1500);
  assert.equal(cut.size, 1500);
  assert.equal(cut.truncated, true);
});

test('a timeout, a cancel, and failures in plain words', async () => {
  const url = await httpServer(() => {}); // never answers
  const t = setup();
  const slow = newHttp({ url });
  slow.settings.timeout = 150;
  await assert.rejects(t.send(slow), /No answer from 127\.0\.0\.1:\d+ in 150 ms: it’s past the timeout/);

  const ac = new AbortController();
  const p = t.send(newHttp({ url }), { signal: ac.signal });
  setTimeout(() => ac.abort(), 50);
  await assert.rejects(p);

  // A port nothing listens on.
  const free = http.createServer();
  const port = await listen(free);
  free.close();
  await new Promise((r) => setTimeout(r, 20));
  await assert.rejects(t.send(newHttp({ url: `localhost:${port}/x` })), new RegExp(`Couldn’t connect to localhost:${port}: nothing is listening there\\.`));
  await assert.rejects(t.send(newHttp({ url: 'http://no-such-host.invalid/' })), /Couldn’t find no-such-host\.invalid: no such host/);
  await assert.rejects(t.send(newHttp({ url: 'ftp://example.com' })), /Only http:\/\/ and https:\/\/ URLs go here/);
  await assert.rejects(t.send(newHttp({ url: '' })), /Type a URL/);

  // Failures are in the history too.
  const s = await t.call<{ history: { error: string | null }[] }>({ op: 'state', project: 'p1' });
  assert.ok(s.history.some((h) => h.error?.includes('nothing is listening')));
});

test('https: a self-signed certificate is refused, then sent to with “ignore TLS errors”', async (tt) => {
  const pair = selfSigned();
  if (!pair) return tt.skip('openssl isn’t here');
  const port = await listen(https.createServer(pair, (_req, res) => res.end('secure')));
  const t = setup();
  const r = newHttp({ url: `https://127.0.0.1:${port}/` });
  await assert.rejects(t.send(r), /certificate isn’t trusted \(DEPTH_ZERO_SELF_SIGNED_CERT\).*Ignore TLS errors/);
  r.settings.insecure = true;
  const ok = await t.send(r);
  assert.equal(text(ok), 'secure');
  assert.ok(ok.timings.tls !== null);
  assert.equal(ok.tls?.authorized, false);
  assert.equal(ok.tls?.subject, '127.0.0.1');
});

test('variables: environment over collection, dynamic ones, and what isn’t set', async () => {
  const url = await echo();
  const t = setup();
  const c: Collection = { ...newCollection('C'), variables: [
    { key: 'base', value: url, enabled: true },
    { key: 'who', value: 'collection', enabled: true },
    { key: 'path', value: '/v1/{{who}}', enabled: true },
  ] };
  await t.call({ op: 'saveCollection', project: 'p1', collection: c });
  const env: Environment = { id: 'e1', name: 'Dev', vars: [
    { key: 'who', value: 'env', enabled: true, secret: false },
    { key: 'token', value: 's3cret', enabled: true, secret: true },
    { key: 'off', value: 'x', enabled: false, secret: false },
  ] };
  await t.call({ op: 'saveEnvironment', project: 'p1', environment: env });
  const r = newHttp({
    method: 'POST',
    url: '{{base}}{{path}}?t={{$timestamp}}&off={{off}}',
    headers: [
      { key: 'X-Id', value: '{{$uuid}}', enabled: true },
      { key: 'X-Missing', value: '{{nope}}', enabled: true },
    ],
  });
  r.body = { ...r.body, kind: 'json', text: '{"t":"{{token}}","n":{{$randomInt}},"at":"{{$isoTimestamp}}"}' };
  r.auth = { ...emptyAuth('bearer'), token: '{{token}}' };
  const res = await t.send(r, { context: { environment: 'e1', collection: c.id } });
  const e = got(res);
  assert.match(e.url, /^\/v1\/env\?t=\d{10}&off={{off}}$/);
  assert.match(e.headers['x-id'], /^[0-9a-f-]{36}$/);
  assert.equal(e.headers['x-missing'], '{{nope}}');
  assert.equal(e.headers.authorization, 'Bearer s3cret');
  const body = JSON.parse(e.body);
  assert.equal(body.t, 's3cret');
  assert.ok(body.n >= 0 && body.n <= 1000);
  assert.ok(!Number.isNaN(Date.parse(body.at)));
  assert.deepEqual(res.unresolved.sort(), ['nope', 'off']);

  // One the URL needs is said plainly.
  await assert.rejects(t.send(newHttp({ url: '{{host}}/x' })), /The URL uses \{\{host\}\}, which isn’t set/);
});

test('auth: bearer, basic, API key in a header or the query, inherited from a folder or the collection', async () => {
  const url = await echo();
  const t = setup();
  const r = (auth: Partial<HttpRequest['auth']>) => newHttp({ url, auth: { ...emptyAuth(), ...auth } });
  let e = got(await t.send(r({ kind: 'basic', username: 'ann', password: 'pa:ss' })));
  assert.equal(e.headers.authorization, `Basic ${Buffer.from('ann:pa:ss').toString('base64')}`);
  e = got(await t.send(r({ kind: 'apikey', key: 'X-Api-Key', value: 'k1', in: 'header' })));
  assert.equal(e.headers['x-api-key'], 'k1');
  e = got(await t.send(r({ kind: 'apikey', key: 'api key', value: 'k 2', in: 'query' })));
  assert.equal(e.url, '/?api+key=k+2');
  e = got(await t.send(r({ kind: 'none' })));
  assert.equal(e.headers.authorization, undefined);
  // A header of one's own wins over the auth.
  const own = r({ kind: 'bearer', token: 'x' });
  own.headers = [{ key: 'Authorization', value: 'Custom 1', enabled: true }];
  assert.equal(got(await t.send(own)).headers.authorization, 'Custom 1');

  const folder = { ...newFolder('F'), auth: { ...emptyAuth('bearer'), token: 'from-folder' } };
  const inner = { ...newFolder('Inner') };
  folder.items = [inner];
  const c: Collection = { ...newCollection('C'), items: [folder], auth: { ...emptyAuth('basic'), username: 'col', password: 'p' } };
  await t.call({ op: 'saveCollection', project: 'p1', collection: c });
  e = got(await t.send(r({ kind: 'inherit' }), { context: { collection: c.id, folder: inner.id } }));
  assert.equal(e.headers.authorization, 'Bearer from-folder');
  e = got(await t.send(r({ kind: 'inherit' }), { context: { collection: c.id, folder: null } }));
  assert.equal(e.headers.authorization, `Basic ${Buffer.from('col:p').toString('base64')}`);
});

test('a response’s body can be read back as a stream (to save it); cURL export fills in variables', async () => {
  const url = await echo();
  const t = setup();
  const res = await t.send(newHttp({ url: `${url}/file.json` }));
  const { readAll } = await import('@hyperpane/sdk/testing');
  const saved = await t.call<{ name: string; size: number; data: ReadableStream<Uint8Array> }>({ op: 'body', id: res.id });
  assert.equal(saved.name, 'file.json');
  assert.equal(Buffer.from(await readAll(saved.data)).toString(), text(res));
  await assert.rejects(t.call({ op: 'body', id: 'nope' }), /isn’t kept any more/);

  await t.call({ op: 'saveEnvironment', project: 'p1', environment: { id: 'e', name: 'E', vars: [{ key: 'u', value: url, enabled: true, secret: false }] } });
  const curl = await t.call<string>({ op: 'exportCurl', project: 'p1', request: newHttp({ url: '{{u}}/x', auth: { ...emptyAuth('bearer'), token: 't' } }), context: { environment: 'e' } });
  assert.equal(curl, `curl ${url}/x \\\n  -H 'Authorization: Bearer t' \\\n  -L`);
});
