// WebSockets against a server written in the test from the RFC (its own
// handshake and framing), and event streams split at awkward places.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { stream, testHost } from '@hyperpane/sdk/testing';
import { type SseEvent, type WsEvent, newHttp, newWs } from '../../src/shared/index.ts';
import { make } from '../../src/server/plugin.ts';
import { SseParser } from '../../src/server/sse.ts';
import { ByteQueue, frame, readFrame } from '../../src/server/ws/index.ts';
import { httpServer, wsServer } from './servers.ts';

function setup() {
  const plugin = make({ backoff: [30, 60] })(testHost({ id: 'requests' }));
  const call = (req: Record<string, unknown>) => import('@hyperpane/sdk/testing').then(({ invoke }) => invoke(plugin, req));
  return { plugin, call };
}

/** Waits for the subscription's first event that `pred` takes. */
async function until<E>(s: { events: E[]; next(): Promise<E> }, pred: (e: E) => boolean, seen = { n: 0 }): Promise<E> {
  for (;;) {
    while (seen.n < s.events.length) {
      const e = s.events[seen.n++];
      if (pred(e)) return e;
    }
    await s.next();
  }
}

test('frames: masked from the client, read back across chunks, 16- and 64-bit lengths', () => {
  for (const size of [0, 125, 126, 65535, 65536, 70000]) {
    const payload = Buffer.alloc(size, 7);
    const f = frame(2, payload);
    const q = new ByteQueue();
    // In pieces of 1000 bytes.
    let out = null;
    for (let i = 0; i < f.length; i += 1000) {
      q.push(f.subarray(i, i + 1000));
      out = readFrame(q, 1e9) ?? out;
    }
    assert.ok(out, `size ${size}`);
    assert.equal(out!.masked, true);
    assert.equal(out!.payload.length, size);
    assert.ok(out!.payload.every((b) => b === 7));
  }
  const q = new ByteQueue();
  q.push(frame(1, Buffer.alloc(200), true, null));
  assert.throws(() => readFrame(q, 100), /more than the 100 taken/);
});

test('connects with a custom header and a subprotocol the server checks; echoes text and binary', async () => {
  const server = await wsServer({
    check: (req) => (req.headers['x-token'] === 'abc' ? null : 401),
    protocol: (offered) => (offered.includes('chat.v2') ? 'chat.v2' : null),
  });
  const t = setup();
  const s = stream<WsEvent>(t.plugin, {
    op: 'ws',
    id: 'c1',
    request: newWs({ url: server.url, headers: [{ key: 'X-Token', value: 'abc', enabled: true }], protocols: 'chat.v1, chat.v2' }),
  });
  const seen = { n: 0 };
  const open = (await until(s, (e) => e.type === 'open' || e.type === 'error', seen)) as Extract<WsEvent, { type: 'open' }>;
  assert.equal(open.type, 'open', JSON.stringify(open));
  assert.equal(open.protocol, 'chat.v2');
  assert.equal(open.status, 101);
  assert.ok(open.headers.some(([k, v]) => k === 'X-Test' && v === 'yes'));
  assert.equal(server.peers[0].headers['sec-websocket-protocol'], 'chat.v1, chat.v2');

  await t.call({ op: 'wsSend', id: 'c1', text: 'hello ✓' });
  const out = await until(s, (e) => e.type === 'message', seen);
  assert.deepEqual([out.type === 'message' && out.dir, out.type === 'message' && out.text], ['out', 'hello ✓']);
  const back = await until(s, (e) => e.type === 'message', seen);
  assert.equal(back.type === 'message' && back.dir, 'in');
  assert.equal(back.type === 'message' && back.text, 'hello ✓');
  assert.equal(back.type === 'message' && back.size, Buffer.byteLength('hello ✓'));
  assert.equal(server.peers[0].frames[0].masked, true);

  await t.call({ op: 'wsSend', id: 'c1', data: Uint8Array.of(0, 1, 2, 255) });
  await until(s, (e) => e.type === 'message' && e.dir === 'out', seen);
  const bin = await until(s, (e) => e.type === 'message' && e.dir === 'in', seen);
  assert.deepEqual(bin.type === 'message' && [...bin.data!], [0, 1, 2, 255]);
  assert.equal(bin.type === 'message' && bin.text, undefined);

  // Several at once.
  const s2 = stream<WsEvent>(t.plugin, { op: 'ws', id: 'c2', request: newWs({ url: server.url, headers: [{ key: 'X-Token', value: 'abc', enabled: true }] }) });
  const open2 = await until(s2, (e) => e.type === 'open');
  assert.equal(open2.type === 'open' && open2.protocol, null);
  await t.call({ op: 'wsSend', id: 'c2', text: 'two' });
  assert.equal(((await until(s2, (e) => e.type === 'message' && e.dir === 'in')) as { text: string }).text, 'two');

  // The client closes: the server answers; it's by the client, the code kept.
  await t.call({ op: 'wsClose', id: 'c1', code: 4001, reason: 'done here' });
  const close = await until(s, (e) => e.type === 'close', seen);
  assert.deepEqual(close, { ...close, code: 4001, reason: 'done here', by: 'client' });
  assert.equal(await s.end, null);
  await assert.rejects(t.call({ op: 'wsSend', id: 'c1', text: 'late' }), /isn’t connected/);
  s2.cancel();
});

test('a refused handshake says what the server said', async () => {
  const server = await wsServer({ check: () => 403 });
  const t = setup();
  const s = stream<WsEvent>(t.plugin, { op: 'ws', id: 'x', request: newWs({ url: server.url }) });
  const err = await until(s, (e) => e.type === 'error');
  assert.match((err as { message: string }).message, /answered 403 Refused, not a WebSocket upgrade: Go away/);
  assert.equal(await s.end, null);

  // An http:// server that isn't a WebSocket one.
  const plain = await httpServer((_req, res) => res.end('just http'));
  const s2 = stream<WsEvent>(t.plugin, { op: 'ws', id: 'y', request: newWs({ url: plain.replace('http', 'ws') }) });
  assert.match(((await until(s2, (e) => e.type === 'error')) as { message: string }).message, /answered 200 OK, not a WebSocket upgrade: just http/);
  const s3 = stream<WsEvent>(t.plugin, { op: 'ws', id: 'z', request: newWs({ url: 'ws://127.0.0.1:1' }) });
  assert.match(((await until(s3, (e) => e.type === 'error')) as { message: string }).message, /Couldn’t connect to 127\.0\.0\.1:1: nothing is listening there/);
});

test('fragmented messages, pings both ways, a large message, and the server closing with a code', async () => {
  const big = Buffer.alloc(3 * 1024 * 1024, 'x');
  const server = await wsServer({
    onConnect: (p) => {
      // A text message in three frames, with a ping between them.
      p.send(1, 'hel', false);
      p.send(9, 'are you there');
      p.send(0, 'lo, ', false);
      p.send(0, 'world', true);
    },
    onFrame: (p, f) => {
      if (f.opcode === 1 && f.payload.toString() === 'big') {
        p.send(2, big);
        return true;
      }
      if (f.opcode === 1 && f.payload.toString() === 'bye') {
        p.send(8, Buffer.concat([Buffer.from([0x0f, 0xa1]), Buffer.from('server is done')]));
        return true;
      }
    },
  });
  const t = setup();
  const s = stream<WsEvent>(t.plugin, { op: 'ws', id: 'f', request: newWs({ url: server.url }) });
  const seen = { n: 0 };
  await until(s, (e) => e.type === 'open', seen);
  const ping = await until(s, (e) => e.type === 'ping', seen);
  assert.equal(ping.type === 'ping' && ping.dir, 'in');
  const msg = await until(s, (e) => e.type === 'message', seen);
  assert.equal(msg.type === 'message' && msg.text, 'hello, world');
  // The ping was answered with its payload.
  await new Promise((r) => setTimeout(r, 20));
  const pong = server.peers[0].frames.find((f) => f.opcode === 10);
  assert.equal(pong?.payload.toString(), 'are you there');

  await t.call({ op: 'wsPing', id: 'f', text: 'p' });
  const back = await until(s, (e) => e.type === 'pong', seen);
  assert.equal(back.type === 'pong' && typeof back.ms, 'number');

  // A client message in fragments, and one over 64 KiB, reach the server whole.
  await t.call({ op: 'wsSend', id: 'f', text: 'y'.repeat(100_000) });
  const echoed = await until(s, (e) => e.type === 'message' && e.dir === 'in', seen);
  assert.equal(echoed.type === 'message' && echoed.size, 100_000);

  await t.call({ op: 'wsSend', id: 'f', text: 'big' });
  const large = await until(s, (e) => e.type === 'message' && e.dir === 'in', seen);
  assert.equal(large.type === 'message' && large.size, big.length);

  await t.call({ op: 'wsSend', id: 'f', text: 'bye' });
  const close = await until(s, (e) => e.type === 'close', seen);
  assert.deepEqual(close, { ...close, code: 4001, reason: 'server is done', by: 'server' });
  // The client answered the close with the same code.
  await new Promise((r) => setTimeout(r, 20));
  const answer = server.peers[0].frames.find((f) => f.opcode === 8);
  assert.equal(answer?.payload.readUInt16BE(0), 4001);
  assert.equal(await s.end, null);
});

test('a message over the limit closes with 1009; a dropped connection reconnects when asked', async () => {
  let connections = 0;
  const server = await wsServer({
    onConnect: (p) => {
      connections++;
      if (connections === 1) p.send(2, Buffer.alloc(2000));
      if (connections === 2) setTimeout(() => p.socket.destroy(), 10);
    },
  });
  const plugin = make({ backoff: [20], maxMessage: 1000 })(testHost({ id: 'requests' }));
  const s = stream<WsEvent>(plugin, { op: 'ws', id: 'r', request: newWs({ url: server.url, reconnect: true }) });
  const seen = { n: 0 };
  const err = await until(s, (e) => e.type === 'error', seen);
  assert.match((err as { message: string }).message, /more than the 1000 taken/);
  const close = await until(s, (e) => e.type === 'close', seen);
  assert.equal(close.type === 'close' && close.code, 1009);
  // Closed by the client (for the size): no reconnecting.
  assert.equal(await s.end, null);

  // The second connection is dropped by the server's side: it comes back.
  const s2 = stream<WsEvent>(plugin, { op: 'ws', id: 'r2', request: newWs({ url: server.url, reconnect: true }) });
  const seen2 = { n: 0 };
  const lost = await until(s2, (e) => e.type === 'close', seen2);
  assert.deepEqual(lost.type === 'close' && [lost.code, lost.by], [1006, 'network']);
  await until(s2, (e) => e.type === 'reconnecting', seen2);
  await until(s2, (e) => e.type === 'open', seen2);
  assert.equal(connections, 3);
  s2.cancel();
});

test('event streams: parsed across chunk boundaries (CR LF split too), with ids, names, retry', () => {
  const got: { id: string | null; event: string; data: string; retry: number | null }[] = [];
  const p = new SseParser((e) => got.push(e));
  const text = ': comment\r\nid: 1\r\nevent: tick\r\ndata: a\r\ndata: b\r\n\r\ndata: plain\n\nretry: 500\ndata: {"x":1}\r\rid: 7\ndata:no space\n\n';
  const bytes = Buffer.from(text);
  // Every split point, including between \r and \n.
  for (let cut = 1; cut < bytes.length; cut++) {
    got.length = 0;
    const q = new SseParser((e) => got.push(e));
    q.push(bytes.subarray(0, cut));
    q.push(bytes.subarray(cut));
    assert.equal(got.length, 4, `cut at ${cut}`);
  }
  got.length = 0;
  for (const b of bytes) p.push(Uint8Array.of(b));
  assert.deepEqual(got, [
    { id: '1', event: 'tick', data: 'a\nb', retry: null },
    { id: '1', event: 'message', data: 'plain', retry: null },
    { id: '1', event: 'message', data: '{"x":1}', retry: 500 },
    { id: '7', event: 'message', data: 'no space', retry: null },
  ]);
  // UTF-8 split inside a character.
  const out: string[] = [];
  const u = new SseParser((e) => out.push(e.data));
  const d = Buffer.from('data: é✓\n\n');
  u.push(d.subarray(0, 7));
  u.push(d.subarray(7));
  assert.deepEqual(out, ['é✓']);
});

test('an event stream, through the server part, until it ends', async () => {
  const url = await httpServer((req, res) => {
    if (req.headers.accept !== 'text/event-stream') return res.writeHead(406).end('want event-stream');
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.write('event: hi\ndata: one\n');
    setTimeout(() => res.write('\nid: 2\ndata: tw'), 10);
    setTimeout(() => res.end('o\n\n'), 20);
  });
  const t = setup();
  const s = stream<SseEvent>(t.plugin, { op: 'sse', request: newHttp({ type: 'sse', url }) });
  assert.equal(await s.end, null);
  assert.deepEqual(
    s.events.map((e) => (e.type === 'event' ? [e.event, e.data, e.id] : e.type)),
    ['open', ['hi', 'one', null], ['message', 'two', '2'], 'end'],
  );
  const bad = await httpServer((_req, res) => res.writeHead(500).end('broken'));
  const s2 = stream<SseEvent>(t.plugin, { op: 'sse', request: newHttp({ type: 'sse', url: bad }) });
  assert.match((await s2.end) ?? '', /answered 500 Internal Server Error: broken/);
});
