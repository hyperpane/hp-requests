// A WebSocket's messages, one stream seen two ways: a chat or a log;
// filtered, copied, cleared, following the newest.

import { useMemo, useState } from 'react';
import { Copy, MessageSquare, Rows3, Trash2 } from 'lucide-react';
import { useHost } from '@hyperpane/sdk/client';
import { NodeInput, ToolButton, cn } from '@hyperpane/ui';
import type { WsRequest } from '../../shared/index.ts';
import type { EditorProps } from '../lib/editor.ts';
import { clock } from '../lib/format.ts';
import { useFollow, useKept } from '../lib/hooks.ts';
import { useLive } from '../lib/live.ts';
import { ToEnd } from '../ui/to-end.tsx';
import { ChatLine } from './chat.tsx';
import { Composer } from './composer.tsx';
import { asText, systemText } from './events.ts';
import { LogLine } from './log.tsx';

export function Messages({ p }: { p: EditorProps<WsRequest> }) {
  const host = useHost();
  const { live, tabKey, request: r } = p;
  const ws = useLive(live, tabKey).ws;
  const [view, setView] = useKept<'chat' | 'log'>('requests.wsView', 'chat');
  const [find, setFind] = useState('');
  const events = ws?.events ?? [];
  const shown = useMemo(() => (find ? events.filter((e) => e.type === 'message' && asText(e).toLowerCase().includes(find.toLowerCase())) : events), [events, find]);
  const f = useFollow(shown.length);
  const copyAll = () =>
    void host.app.clipboardWrite({
      text: shown.map((e) => (e.type === 'message' ? `${clock(e.at)} ${e.dir === 'out' ? '→' : '←'} ${asText(e)}` : `${clock(e.at)} · ${systemText(e)}`)).join('\n'),
    });
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-w-0 items-center gap-1 px-2 py-1">
        <div className="flex flex-none rounded-md border border-[var(--node-border)] p-px">
          {(
            [
              ['chat', 'Chat', MessageSquare],
              ['log', 'Log', Rows3],
            ] as const
          ).map(([id, name, Icon]) => (
            <button
              key={id}
              type="button"
              onClick={() => setView(id)}
              className={cn('flex items-center gap-1 rounded px-2 py-0.5 text-[11px]', view === id ? 'bg-[var(--node-hover)] text-[var(--node-fg)]' : 'text-[var(--node-muted)] hover:text-[var(--node-fg)]')}
            >
              <Icon className="size-3" />
              {name}
            </button>
          ))}
        </div>
        <NodeInput className="h-6 min-w-0 flex-1" placeholder="Show only messages with…" value={find} onChange={(e) => setFind(e.target.value)} />
        <ToolButton label="Copy the messages" icon={Copy} onClick={copyAll} />
        <ToolButton label="Clear" icon={Trash2} onClick={() => live.clearWs(tabKey)} />
      </div>
      <div className="relative min-h-0 flex-1 border-y border-[var(--node-border)]">
        <div ref={f.ref} onScroll={f.onScroll} className={cn('absolute inset-0 overflow-auto', view === 'chat' ? 'px-3 py-2' : 'py-0.5')}>
          {!events.length && (
            <p className="py-6 text-center text-[var(--node-muted)]">{ws?.status === 'open' ? 'Connected. Write a message below.' : 'Connect, then send messages: they and the answers show here.'}</p>
          )}
          {view === 'chat' ? shown.map((e) => <ChatLine key={e.n} e={e} />) : shown.map((e) => <LogLine key={e.n} e={e} />)}
        </div>
        {!f.follow && <ToEnd onClick={f.toEnd} />}
      </div>
      <Composer p={p} open={ws?.status === 'open'} templates={r.templates} />
    </div>
  );
}
