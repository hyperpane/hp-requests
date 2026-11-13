// Reading an answer's body: decompressed (gzip, deflate, br, zstd where
// Node has it), up to a limit, within the deadline, cancellable; and as it
// came, with a note, when it can't be decompressed.

import type http from 'node:http';
import zlib from 'node:zlib';
import { PluginError } from '@hyperpane/sdk/server';

/** The encodings this reads, as Accept-Encoding offers them. */
export const ENCODINGS = ['gzip', 'deflate', 'br', ...('createZstdDecompress' in zlib ? ['zstd'] : [])];

function decoder(encoding: string): NodeJS.ReadWriteStream | null {
  switch (encoding) {
    case 'gzip':
    case 'x-gzip':
      return zlib.createGunzip({ finishFlush: zlib.constants.Z_SYNC_FLUSH });
    case 'deflate':
      return zlib.createInflate({ finishFlush: zlib.constants.Z_SYNC_FLUSH });
    case 'br':
      return zlib.createBrotliDecompress();
    case 'zstd': {
      const z = (zlib as unknown as { createZstdDecompress?: () => NodeJS.ReadWriteStream }).createZstdDecompress;
      return z ? z() : null;
    }
    default:
      return null;
  }
}

/** Reads a body, decompressed, up to `max` bytes. */
export function readBody(res: http.IncomingMessage, max: number, signal?: AbortSignal, deadline?: number | null): Promise<{ bytes: Buffer; wire: number; truncated: boolean; end: number; note: string | null }> {
  return new Promise((resolve, reject) => {
    let wire = 0;
    let size = 0;
    let truncated = false;
    let note: string | null = null;
    const chunks: Buffer[] = [];
    const raw: Buffer[] = [];
    const encodings = String(res.headers['content-encoding'] ?? '')
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter((e) => e && e !== 'identity');
    let stream: NodeJS.ReadableStream = res;
    const decoders: NodeJS.ReadWriteStream[] = [];
    // Applied in the reverse of the order they were.
    for (const e of [...encodings].reverse()) {
      const d = decoder(e);
      if (!d) {
        note = `It’s encoded as ${e}, which isn’t read here: this is the body as it came.`;
        decoders.length = 0;
        stream = res;
        break;
      }
      decoders.push(d);
      stream = stream.pipe(d);
    }
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      cleanup();
      resolve({ bytes: Buffer.concat(chunks), wire, truncated, end: performance.now(), note });
    };
    const fail = (e: Error) => {
      if (finished) return;
      finished = true;
      cleanup();
      res.destroy();
      reject(e);
    };
    const onAbort = () => fail(new PluginError('Cancelled.'));
    const timer = deadline ? setTimeout(() => fail(new PluginError('The answer took too long to download: it’s past the timeout.')), Math.max(0, deadline - performance.now())) : null;
    const cleanup = () => {
      if (timer) clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    res.on('data', (c: Buffer) => {
      wire += c.length;
      if (decoders.length) raw.push(c);
    });
    res.on('error', (e) => fail(e));
    stream.on('data', (c: Buffer) => {
      if (finished) return;
      if (size + c.length > max) {
        chunks.push(c.subarray(0, max - size));
        size = max;
        truncated = true;
        finish();
        res.destroy();
        return;
      }
      size += c.length;
      chunks.push(c);
    });
    stream.on('end', finish);
    for (const d of decoders)
      d.on('error', (e: Error) => {
        // A body that says it's compressed but isn't: shown as it came.
        if (finished) return;
        note = `It says it’s ${encodings.join(', ')}, but it couldn’t be decompressed (${e.message}): this is the body as it came.`;
        const asItCame = () => {
          chunks.length = 0;
          chunks.push(Buffer.concat(raw).subarray(0, max));
          finish();
        };
        if (res.complete) asItCame();
        else {
          res.on('end', asItCame);
          res.resume();
        }
      });
    if (signal?.aborted) onAbort();
  });
}
