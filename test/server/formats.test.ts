// cURL both ways, and Postman's collections and environments.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fromCurl, shellWords, toCurl } from '../../src/shared/curl/index.ts';
import { type Folder, type HttpRequest, emptyAuth, newHttp } from '../../src/shared/index.ts';
import { fromPostman, fromPostmanEnvironment, toPostman } from '../../src/shared/postman.ts';
import { paramsFromUrl, pieces, queryOf, withQuery } from '../../src/shared/vars.ts';

test('shell words: quotes, $’…’, backslashes, continued lines', () => {
  assert.deepEqual(shellWords(`curl 'a b' "c \\"d\\" $x" e\\ f \\\n  $'g\\nh\\'i' -H'X: 1'`), ['curl', 'a b', 'c "d" $x', 'e f', "g\nh'i", '-HX: 1']);
  assert.throws(() => shellWords(`curl 'open`), /isn’t closed/);
});

test('cURL in: a browser’s Copy as cURL (Chrome), with JSON', () => {
  const r = fromCurl(`curl 'https://api.example.com/v1/items?page=2&q=a%20b' \\
  -H 'accept: application/json' \\
  -H 'authorization: Bearer eyJhbGc.x.y' \\
  -H 'content-type: application/json' \\
  --data-raw '{"name":"it'\\''s","n":1}' \\
  --compressed`);
  assert.equal(r.method, 'POST');
  assert.equal(r.url, 'https://api.example.com/v1/items?page=2&q=a%20b');
  assert.deepEqual(r.params, [
    { key: 'page', value: '2', enabled: true },
    { key: 'q', value: 'a%20b', enabled: true },
  ]);
  assert.deepEqual(r.headers, [{ key: 'accept', value: 'application/json', enabled: true }]);
  assert.deepEqual([r.auth.kind, r.auth.token], ['bearer', 'eyJhbGc.x.y']);
  assert.deepEqual([r.body.kind, r.body.text], ['json', `{"name":"it's","n":1}`]);
  assert.equal(r.name, 'POST /v1/items');
});

test('cURL in: forms, files, basic auth, -k, -X, combined short flags, --data-urlencode, -G', () => {
  let r = fromCurl(`curl -sSLk -XPUT -u admin:se:cret https://h/x -F 'title=hi' -F file=@/tmp/a.png\\;type=image/png -H "Content-Type: multipart/form-data; boundary=----x"`);
  assert.equal(r.method, 'PUT');
  assert.equal(r.settings.insecure, true);
  assert.deepEqual([r.auth.kind, r.auth.username, r.auth.password], ['basic', 'admin', 'se:cret']);
  assert.equal(r.body.kind, 'multipart');
  assert.deepEqual(r.body.multipart, [
    { key: 'title', value: 'hi', enabled: true, type: 'text' },
    { key: 'file', value: '/tmp/a.png', enabled: true, type: 'file' },
  ]);
  assert.deepEqual(r.headers, [], 'the browser’s multipart Content-Type goes: its boundary wouldn’t be ours');

  r = fromCurl(`curl https://h/login -d 'user=ann&pass=a%26b' -d 'remember=1'`);
  assert.equal(r.method, 'POST');
  assert.equal(r.body.kind, 'urlencoded');
  assert.deepEqual(r.body.form.map((f) => [f.key, f.value]), [
    ['user', 'ann'],
    ['pass', 'a&b'],
    ['remember', '1'],
  ]);

  r = fromCurl(`curl --data-urlencode "q=hello world" --data-urlencode 'lang=en' https://h/search`);
  assert.equal(r.body.kind, 'urlencoded');
  assert.deepEqual(r.body.form.map((f) => [f.key, f.value]), [
    ['q', 'hello world'],
    ['lang', 'en'],
  ]);

  r = fromCurl(`curl -G https://h/search -d q=1 -d x=2`);
  assert.equal(r.method, 'GET');
  assert.equal(r.url, 'https://h/search?q=1&x=2');
  assert.equal(r.body.kind, 'none');

  r = fromCurl(`curl --data-binary @payload.bin -H 'Content-Type: application/octet-stream' http://localhost:3000/up`);
  assert.deepEqual([r.method, r.body.kind, r.body.file], ['POST', 'binary', 'payload.bin']);

  r = fromCurl(`curl -X DELETE "http://localhost:8080/users/42" -H "X-Request-Id: abc" --max-time 5`);
  assert.deepEqual([r.method, r.settings.timeout, r.headers[0].key], ['DELETE', 5000, 'X-Request-Id']);

  r = fromCurl(`curl -I https://example.com`);
  assert.equal(r.method, 'HEAD');

  r = fromCurl(`curl -H 'Content-Type: application/xml' -d '<a>1</a>' https://h/x`);
  assert.deepEqual([r.body.kind, r.body.textType, r.headers.length], ['text', 'xml', 0]);

  r = fromCurl(`curl https://h/graphql -H 'content-type: application/json' --data '{"query":"query { me { id } }","variables":{"a":1}}'`);
  assert.equal(r.body.kind, 'graphql');
  assert.equal(r.body.graphql.query, 'query { me { id } }');
  assert.deepEqual(JSON.parse(r.body.graphql.variables), { a: 1 });

  assert.throws(() => fromCurl('curl -H "X: 1"'), /has no URL/);
});

test('cURL out and back in: the same request', () => {
  const cases: HttpRequest[] = [
    newHttp({ url: 'https://h/x?a=1', headers: [{ key: 'X-A', value: "it's", enabled: true }] }),
    { ...newHttp({ method: 'POST', url: 'https://h/j' }), body: { ...newHttp().body, kind: 'json', text: '{\n  "a": "b c"\n}' } },
    { ...newHttp({ method: 'PATCH', url: 'https://h/f' }), body: { ...newHttp().body, kind: 'urlencoded', form: [{ key: 'a', value: 'x y&z', enabled: true }] } },
    {
      ...newHttp({ method: 'POST', url: 'https://h/m' }),
      body: { ...newHttp().body, kind: 'multipart', multipart: [
        { key: 'a', value: '1', enabled: true, type: 'text' },
        { key: 'f', value: '/tmp/x y.bin', enabled: true, type: 'file' },
      ] },
    },
    { ...newHttp({ method: 'PUT', url: 'https://h/b' }), body: { ...newHttp().body, kind: 'binary', file: '/tmp/b.bin' } },
    { ...newHttp({ method: 'POST', url: 'https://h/t' }), body: { ...newHttp().body, kind: 'text', text: '<x/>', textType: 'html' } },
    newHttp({ method: 'DELETE', url: 'https://h/d', auth: { ...emptyAuth('basic'), username: 'u', password: "p'w" } }),
    newHttp({ method: 'GET', url: 'https://h/b', auth: { ...emptyAuth('bearer'), token: 'tok' }, settings: { timeout: 30_000, followRedirects: true, insecure: true } }),
    newHttp({ method: 'HEAD', url: 'https://h/h' }),
    { ...newHttp({ method: 'POST', url: 'https://h/g' }), body: { ...newHttp().body, kind: 'graphql', graphql: { query: 'query Q { a }', variables: '{\n  "x": 1\n}' } } },
  ];
  for (const r of cases) {
    const back = fromCurl(toCurl(r));
    const pick = (x: HttpRequest) => ({
      method: x.method,
      url: x.url,
      headers: x.headers,
      body: { ...x.body, ...(x.body.kind === 'graphql' ? { graphql: { query: x.body.graphql.query, variables: JSON.stringify(JSON.parse(x.body.graphql.variables)) } } : {}) },
      auth: x.auth.kind === 'inherit' ? 'inherit' : x.auth,
      insecure: x.settings.insecure,
    });
    assert.deepEqual(pick(back), pick(r), toCurl(r));
  }
});

test('the URL’s query and the params table follow each other', () => {
  assert.deepEqual(queryOf('http://h/x?a=1&b&c={{v}}#frag'), [
    { key: 'a', value: '1', enabled: true },
    { key: 'b', value: '', enabled: true },
    { key: 'c', value: '{{v}}', enabled: true },
  ]);
  assert.equal(
    withQuery('http://h/x?old=1#f', [
      { key: 'a', value: '1', enabled: true },
      { key: 'off', value: '2', enabled: false },
      { key: 'flag', value: '', enabled: true },
    ]),
    'http://h/x?a=1&flag#f',
  );
  assert.deepEqual(paramsFromUrl('http://h/?x=1', [{ key: 'off', value: '2', enabled: false }, { key: 'gone', value: '', enabled: true }]), [
    { key: 'x', value: '1', enabled: true },
    { key: 'off', value: '2', enabled: false },
  ]);
  assert.deepEqual(pieces('{{a}}/x/{{b}}/{{$uuid}}', new Map([['a', '1']])), [
    { text: '{{a}}', variable: 'ok' },
    { text: '/x/' },
    { text: '{{b}}', variable: 'missing' },
    { text: '/' },
    { text: '{{$uuid}}', variable: 'ok' },
  ]);
});

const SAMPLE = {
  info: { name: 'Shop API', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' },
  auth: { type: 'bearer', bearer: [{ key: 'token', value: '{{token}}', type: 'string' }] },
  variable: [{ key: 'base', value: 'https://shop.test' }],
  item: [
    {
      name: 'Products',
      auth: { type: 'apikey', apikey: [{ key: 'key', value: 'X-Key' }, { key: 'value', value: 'k' }, { key: 'in', value: 'header' }] },
      item: [
        {
          name: 'List',
          request: { method: 'GET', header: [{ key: 'Accept', value: 'application/json' }, { key: 'X-Off', value: '1', disabled: true }], url: { raw: '{{base}}/products?page=1', host: ['{{base}}'], path: ['products'], query: [{ key: 'page', value: '1' }, { key: 'size', value: '10', disabled: true }] } },
        },
        {
          name: 'Create',
          request: { method: 'POST', header: [], url: '{{base}}/products', body: { mode: 'raw', raw: '{"name":"x"}', options: { raw: { language: 'json' } } } },
        },
        {
          name: 'Upload',
          request: { method: 'POST', url: '{{base}}/upload', body: { mode: 'formdata', formdata: [{ key: 'f', type: 'file', src: '/tmp/a.png' }, { key: 't', value: 'v', type: 'text' }] } },
        },
      ],
    },
    { name: 'Login', request: { method: 'POST', url: '{{base}}/login', auth: { type: 'basic', basic: [{ key: 'username', value: 'u' }, { key: 'password', value: 'p' }] }, body: { mode: 'urlencoded', urlencoded: [{ key: 'a', value: '1' }] } } },
    { name: 'Graph', request: { method: 'POST', url: '{{base}}/graphql', auth: { type: 'noauth' }, body: { mode: 'graphql', graphql: { query: '{ me }', variables: '{"a":1}' } } } },
    { name: 'Live', request: { method: 'GET', url: 'wss://shop.test/live' } },
  ],
  event: [{ listen: 'test', script: { exec: ['pm.test()'] } }],
};

test('Postman v2.1: folders, requests, headers, bodies, auth and variables', () => {
  const c = fromPostman(SAMPLE);
  assert.equal(c.name, 'Shop API');
  assert.deepEqual(c.variables, [{ key: 'base', value: 'https://shop.test', enabled: true }]);
  assert.deepEqual([c.auth.kind, c.auth.token], ['bearer', '{{token}}']);
  const folder = c.items[0] as Folder;
  assert.equal(folder.type, 'folder');
  assert.deepEqual([folder.auth.kind, folder.auth.key, folder.auth.in], ['apikey', 'X-Key', 'header']);
  const [list, create, upload] = folder.items as HttpRequest[];
  assert.equal(list.url, '{{base}}/products?page=1');
  assert.deepEqual(list.params, [
    { key: 'page', value: '1', enabled: true },
    { key: 'size', value: '10', enabled: false },
  ]);
  assert.deepEqual(list.headers[1], { key: 'X-Off', value: '1', enabled: false });
  assert.equal(list.auth.kind, 'inherit');
  assert.deepEqual([create.body.kind, create.body.text], ['json', '{"name":"x"}']);
  assert.deepEqual(upload.body.multipart[0], { key: 'f', value: '/tmp/a.png', enabled: true, type: 'file' });
  const [, login, graph, live] = c.items as HttpRequest[];
  assert.deepEqual([login.auth.kind, login.auth.username, login.body.kind], ['basic', 'u', 'urlencoded']);
  assert.deepEqual([graph.auth.kind, graph.body.kind, graph.body.graphql.query], ['none', 'graphql', '{ me }']);
  assert.equal((live as unknown as { type: string }).type, 'ws');

  // Out and back in.
  const again = fromPostman(JSON.parse(JSON.stringify(toPostman(c))));
  const strip = (x: unknown) => JSON.parse(JSON.stringify(x, (k, v) => (k === 'id' ? undefined : v)));
  assert.deepEqual(strip(again), strip(c));

  assert.throws(() => fromPostman({ info: { schema: 'v1.0.0' } }), /Postman v1 collection/);
  assert.throws(() => fromPostman({ hello: 1 }), /isn’t a Postman collection/);
});

test('Postman environments: enabled and secret kept', () => {
  const e = fromPostmanEnvironment({ name: 'Prod', values: [{ key: 'base', value: 'https://p', enabled: true }, { key: 'token', value: 't', enabled: true, type: 'secret' }, { key: 'old', value: 'x', enabled: false }] });
  assert.equal(e.name, 'Prod');
  assert.deepEqual(e.vars, [
    { key: 'base', value: 'https://p', enabled: true, secret: false },
    { key: 'token', value: 't', enabled: true, secret: true },
    { key: 'old', value: 'x', enabled: false, secret: false },
  ]);
});
