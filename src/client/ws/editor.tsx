// A WebSocket: the URL, connect and disconnect, its status, and its
// messages, headers, auth and settings.

import { Plug, Save, Unplug } from 'lucide-react';
import { NodeButton, ToolButton, cn } from '@hyperpane/ui';
import type { WsRequest } from '../../shared/index.ts';
import { paramsFromUrl, withQuery } from '../../shared/vars.ts';
import { AuthEditor } from '../http/auth.tsx';
import { type EditorProps, useKeys } from '../lib/editor.ts';
import { useKept } from '../lib/hooks.ts';
import { useLive } from '../lib/live.ts';
import { COMMON_HEADERS, KVTable } from '../ui/kv-table.tsx';
import { Count, Tabs } from '../ui/tabs.tsx';
import { VarInput } from '../ui/var-input.tsx';
import { Messages } from './messages.tsx';

export function WsEditor(p: EditorProps<WsRequest>) {
  const { request: r, onChange, vars, live, tabKey } = p;
  const ws = useLive(live, tabKey).ws;
  const status = ws?.status ?? 'idle';
  const on = status === 'open' || status === 'connecting';
  const [sub, setSub] = useKept<'messages' | 'headers' | 'auth' | 'settings'>('requests.wsTab', 'messages');
  const set = (patch: Partial<WsRequest>) => onChange({ ...r, ...patch });
  const toggle = () => (on ? void live.disconnectWs(tabKey) : live.connectWs(tabKey, p.project, r, p.context));
  useKeys(toggle, p.onSave);

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex min-w-0 items-center gap-1.5 px-2 pt-2 pb-1.5">
        <span className="rounded-control flex h-7 flex-none items-center border border-[var(--node-border)] px-2 font-mono text-[11px] font-semibold text-[var(--ansi-5)]">WS</span>
        <VarInput
          tall
          className="flex-1"
          value={r.url}
          vars={vars}
          aria-label="URL"
          placeholder="wss://echo.example.com/socket or {{wsBase}}/chat"
          onChange={(url) => set({ url, params: paramsFromUrl(url, r.params) })}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              toggle();
            }
          }}
        />
        <NodeButton className={cn('h-7 flex-none', !on && 'border-[var(--node-accent)] text-[var(--node-accent)]')} onClick={toggle} title={on ? 'Disconnect' : 'Connect (⌘↵)'}>
          {on ? <Unplug /> : <Plug />}
          <span className="hidden sm:inline">{on ? 'Disconnect' : 'Connect'}</span>
        </NodeButton>
        <ToolButton label={p.dirty ? 'Save (⌘S)' : 'Saved'} icon={Save} active={p.dirty} onClick={p.onSave} />
      </div>
      <Tabs
        value={sub}
        onChange={setSub}
        tabs={[
          { id: 'messages', name: <>Messages<Count n={ws?.events.filter((e) => e.type === 'message').length ?? 0} /></> },
          { id: 'headers', name: <>Headers<Count n={r.headers.filter((h) => h.enabled && h.key).length} /></> },
          { id: 'auth', name: 'Auth' },
          { id: 'settings', name: 'Settings' },
        ]}
        right={<StatusBadge status={status} protocol={ws?.protocol ?? null} code={ws?.closeCode ?? null} />}
      />
      {sub === 'messages' && <Messages p={p} />}
      {sub !== 'messages' && (
        <div className="min-h-0 flex-1 overflow-auto p-2">
          {sub === 'headers' && (
            <>
              <KVTable rows={r.headers} vars={vars} keyName="Header" suggest="requests-ws-headers" onChange={(headers) => set({ headers })} />
              <datalist id="requests-ws-headers">
                {['Origin', 'Cookie', 'Authorization', ...COMMON_HEADERS].map((h, i) => (
                  <option key={i} value={h} />
                ))}
              </datalist>
              <div className="mt-3 text-[var(--node-muted)]">Query params</div>
              <KVTable rows={r.params} vars={vars} keyName="Param" onChange={(params) => set({ params, url: withQuery(r.url, params) })} />
            </>
          )}
          {sub === 'auth' && <AuthEditor auth={r.auth} onChange={(auth) => set({ auth })} vars={vars} inheritFrom={p.inheritFrom} />}
          {sub === 'settings' && (
            <div className="flex max-w-xl flex-col gap-3">
              <label className="flex flex-col gap-1">
                <span>Subprotocols</span>
                <VarInput value={r.protocols} vars={vars} onChange={(protocols) => set({ protocols })} placeholder="graphql-transport-ws, chat.v2" />
                <span className="text-[11px] text-[var(--node-muted)]">Offered in Sec-WebSocket-Protocol, comma-separated; the one the server picks shows by the status.</span>
              </label>
              <label className="flex items-start gap-2">
                <input type="checkbox" className="mt-0.5" checked={r.insecure} onChange={(e) => set({ insecure: e.target.checked })} />
                <span>
                  Ignore TLS errors
                  <span className="block text-[11px] text-[var(--node-muted)]">Connect to wss:// even when the certificate isn’t trusted.</span>
                </span>
              </label>
              <label className="flex items-start gap-2">
                <input type="checkbox" className="mt-0.5" checked={r.reconnect} onChange={(e) => set({ reconnect: e.target.checked })} />
                <span>
                  Reconnect when it drops
                  <span className="block text-[11px] text-[var(--node-muted)]">After 1, 2, 4… up to 30 seconds; not after you disconnect.</span>
                </span>
              </label>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function StatusBadge({ status, protocol, code }: { status: string; protocol: string | null; code: number | null }) {
  const color = status === 'open' ? 'var(--ansi-2)' : status === 'connecting' ? 'var(--ansi-3)' : 'var(--node-muted)';
  const text = status === 'open' ? `Open${protocol ? ` · ${protocol}` : ''}` : status === 'connecting' ? 'Connecting…' : status === 'closed' ? `Closed${code !== null && code !== undefined ? ` · ${code}` : ''}` : 'Not connected';
  return (
    <span className="flex min-w-0 items-center gap-1.5 pl-2 text-[11px] text-[var(--node-muted)]">
      <span className={cn('size-2 flex-none rounded-full', status === 'connecting' && 'animate-pulse')} style={{ background: color }} />
      <span className="max-w-40 truncate">{text}</span>
    </span>
  );
}
