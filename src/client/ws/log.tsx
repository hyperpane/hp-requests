// A message as a log line: its direction, time, size and a preview, opened
// with a click.

import { useState } from 'react';
import { ArrowDownLeft, ArrowUpRight } from 'lucide-react';
import { cn } from '@hyperpane/ui';
import { clock, formatBytes } from '../lib/format.ts';
import { type Ev, asText, jsonOf, systemText } from './events.ts';

export function LogLine({ e }: { e: Ev }) {
  const [open, setOpen] = useState(false);
  if (e.type !== 'message') {
    return (
      <div className="flex min-w-0 items-center gap-2 px-2 py-0.5 text-[11px] text-[var(--node-muted)]">
        <span className="w-3.5 flex-none text-center">·</span>
        <span className="w-[86px] flex-none font-mono text-[10px]">{clock(e.at)}</span>
        <span className={cn('min-w-0 flex-1 truncate italic', e.type === 'error' && 'text-[var(--ansi-1)]')} title={systemText(e)}>
          {systemText(e)}
        </span>
      </div>
    );
  }
  const out = e.dir === 'out';
  const Icon = out ? ArrowUpRight : ArrowDownLeft;
  const text = asText(e);
  return (
    <div className="border-b border-[color-mix(in_srgb,var(--node-border)_50%,transparent)] hover:bg-[var(--node-hover)]">
      <button type="button" className="flex w-full min-w-0 items-center gap-2 px-2 py-0.5 text-left" onClick={() => setOpen(!open)}>
        <Icon className="size-3.5 flex-none" style={{ color: out ? 'var(--ansi-2)' : 'var(--ansi-4)' }} />
        <span className="w-[86px] flex-none font-mono text-[10px] text-[var(--node-muted)]">{clock(e.at)}</span>
        <span className="w-14 flex-none text-right text-[10px] text-[var(--node-muted)]">{formatBytes(e.size)}</span>
        {e.data && <span className="flex-none rounded bg-[var(--node-hover)] px-1 text-[9px] text-[var(--node-muted)]">BIN</span>}
        <span className="min-w-0 flex-1 truncate font-mono text-[11px]">{text.slice(0, 300)}</span>
      </button>
      {open && <pre className="mx-2 mb-1 max-h-80 overflow-auto rounded border border-[var(--node-border)] p-1.5 font-mono text-[11px] break-all whitespace-pre-wrap select-text">{jsonOf(e.text) !== undefined ? JSON.stringify(jsonOf(e.text), null, 2) : text}</pre>}
    </div>
  );
}
