// A message as a chat bubble: sent on the right, received on the left,
// JSON as a tree, binary as hex; and system lines in between.

import { useState } from 'react';
import { useHost } from '@hyperpane/sdk/client';
import { JsonTree, cn } from '@hyperpane/ui';
import { toBase64, toHex } from '../../shared/index.ts';
import { clock, formatBytes } from '../lib/format.ts';
import { type Ev, jsonOf, systemText } from './events.ts';

export function ChatLine({ e }: { e: Ev }) {
  const host = useHost();
  const [raw, setRaw] = useState(false);
  if (e.type !== 'message') {
    const bad = e.type === 'error' || (e.type === 'close' && e.code !== 1000 && e.by !== 'client');
    return (
      <div className="my-1.5 flex justify-center">
        <span className={cn('max-w-[90%] truncate rounded-full px-2 py-0.5 text-center text-[10px]', bad ? 'bg-[color-mix(in_srgb,var(--ansi-1)_12%,transparent)] text-[var(--ansi-1)]' : 'bg-[var(--node-hover)] text-[var(--node-muted)]')} title={systemText(e)}>
          {systemText(e)} · {clock(e.at).slice(0, 8)}
        </span>
      </div>
    );
  }
  const out = e.dir === 'out';
  const json = jsonOf(e.text);
  return (
    <div className={cn('group my-1 flex', out ? 'justify-end' : 'justify-start')}>
      <div className={cn('flex max-w-[85%] min-w-0 flex-col', out ? 'items-end' : 'items-start')}>
        <div
          className={cn(
            'max-w-full min-w-0 rounded-xl px-2.5 py-1.5',
            out ? 'rounded-br-sm bg-[color-mix(in_srgb,var(--node-accent)_22%,transparent)]' : 'rounded-bl-sm bg-[color-mix(in_srgb,var(--node-fg)_8%,transparent)]',
          )}
        >
          {e.data ? (
            <div className="min-w-0">
              <div className="text-[10px] text-[var(--node-muted)]">Binary · {formatBytes(e.size)}</div>
              <div className="font-mono text-[11px] break-all">{toHex(e.data.subarray(0, 48))}{e.data.length > 48 && ' …'}</div>
            </div>
          ) : json !== undefined && !raw ? (
            <div className="min-w-0 overflow-x-auto font-mono text-[11px]">
              <JsonTree value={json} depth={1} />
            </div>
          ) : (
            <div className="font-mono text-[11px] break-words whitespace-pre-wrap select-text">{e.text || <span className="text-[var(--node-muted)] italic">empty</span>}</div>
          )}
        </div>
        <div className="flex items-center gap-1.5 px-1 text-[10px] text-[var(--node-muted)]">
          <span>{clock(e.at).slice(0, 8)}</span>
          <span>{formatBytes(e.size)}</span>
          <span className="flex gap-1.5 opacity-0 group-hover:opacity-100">
            {json !== undefined && (
              <button type="button" className="hover:text-[var(--node-fg)]" onClick={() => setRaw(!raw)}>
                {raw ? 'Tree' : 'Raw'}
              </button>
            )}
            <button type="button" className="hover:text-[var(--node-fg)]" onClick={() => void host.app.clipboardWrite({ text: e.data ? toBase64(e.data) : (e.text ?? '') })}>
              Copy{e.data ? ' (base64)' : ''}
            </button>
          </span>
        </div>
      </div>
    </div>
  );
}
