// An event stream's events as they come: filtered, copied, cleared.

import { useState } from 'react';
import { Copy, Trash2 } from 'lucide-react';
import { useHost } from '@hyperpane/sdk/client';
import { NodeInput, ToolButton } from '@hyperpane/ui';
import { clock } from '../lib/format.ts';
import { useFollow } from '../lib/hooks.ts';
import { Live, useLive } from '../lib/live.ts';
import { ToEnd } from '../ui/to-end.tsx';

export function SseView({ tabKey, live }: { tabKey: string; live: Live }) {
  const host = useHost();
  const s = useLive(live, tabKey).sse;
  const [find, setFind] = useState('');
  const events = (s?.events ?? []).filter((e) => !find || (e.type === 'event' && `${e.event} ${e.data} ${e.id ?? ''}`.toLowerCase().includes(find.toLowerCase())));
  const f = useFollow(events.length);
  const count = s?.events.filter((e) => e.type === 'event').length ?? 0;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-w-0 items-center gap-1.5 border-b border-[var(--node-border)] px-2 py-1">
        <span
          className="size-2 flex-none rounded-full"
          style={{ background: s?.status === 'open' ? 'var(--ansi-2)' : s?.status === 'connecting' ? 'var(--ansi-3)' : 'var(--node-muted)' }}
        />
        <span className="flex-none text-[11px] text-[var(--node-muted)]">
          {s?.status === 'open' ? 'Listening' : s?.status === 'connecting' ? 'Connecting…' : s ? 'Closed' : 'Not connected'} · {count} events
        </span>
        <NodeInput className="h-6 min-w-0 flex-1" placeholder="Show only events with…" value={find} onChange={(e) => setFind(e.target.value)} />
        <ToolButton
          label="Copy the events"
          icon={Copy}
          onClick={() => void host.app.clipboardWrite({ text: events.map((e) => (e.type === 'event' ? `${e.event}${e.id ? ` #${e.id}` : ''}: ${e.data}` : e.type)).join('\n') })}
        />
        <ToolButton label="Clear" icon={Trash2} onClick={() => live.clearSse(tabKey)} />
      </div>
      <div className="relative min-h-0 flex-1">
        <div ref={f.ref} onScroll={f.onScroll} className="absolute inset-0 overflow-auto px-2 py-1">
          {!s && <p className="py-3 text-center text-[var(--node-muted)]">Connect to listen for its events.</p>}
          {events.map((e) => (
            <div key={e.n} className="flex min-w-0 gap-2 border-b border-[color-mix(in_srgb,var(--node-border)_50%,transparent)] py-1">
              <span className="w-[86px] flex-none font-mono text-[10px] text-[var(--node-muted)]">{clock(e.at)}</span>
              {e.type === 'event' ? (
                <div className="min-w-0 flex-1">
                  <div className="flex gap-2 text-[11px]">
                    <span className="font-medium text-[var(--ansi-6)]">{e.event}</span>
                    {e.id && <span className="text-[var(--node-muted)]">#{e.id}</span>}
                    {e.retry !== null && <span className="text-[var(--node-muted)]">retry {e.retry} ms</span>}
                  </div>
                  <pre className="font-mono text-[11px] break-all whitespace-pre-wrap select-text">{e.data}</pre>
                </div>
              ) : (
                <span className="min-w-0 flex-1 text-[11px] text-[var(--node-muted)] italic">{e.type === 'open' ? `Connected (${e.status})` : e.message}</span>
              )}
            </div>
          ))}
          {s?.error && <p className="py-2 text-[var(--ansi-1)]">{s.error}</p>}
        </div>
        {!f.follow && <ToEnd onClick={f.toEnd} />}
      </div>
    </div>
  );
}
