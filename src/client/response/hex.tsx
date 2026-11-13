// Bytes as a hex dump.

import { useMemo } from 'react';
import { toHex } from '../../shared/index.ts';
import { formatBytes } from '../lib/format.ts';

/** Bytes as a hex dump: offset, 16 bytes, their text. */
export function Hex({ bytes, max = 64 * 1024 }: { bytes: Uint8Array; max?: number }) {
  const lines = useMemo(() => {
    const b = bytes.subarray(0, max);
    const out: string[] = [];
    for (let i = 0; i < b.length; i += 16) {
      const row = b.subarray(i, i + 16);
      out.push(`${i.toString(16).padStart(8, '0')}  ${toHex(row).padEnd(47)}  ${Array.from(row, (c) => (c >= 32 && c < 127 ? String.fromCharCode(c) : '.')).join('')}`);
    }
    return out.join('\n');
  }, [bytes, max]);
  return (
    <pre className="font-mono text-[11px] leading-4 whitespace-pre select-text">
      {lines}
      {bytes.length > max && <span className="block text-[var(--node-muted)] italic">… {formatBytes(bytes.length - max)} more</span>}
    </pre>
  );
}
