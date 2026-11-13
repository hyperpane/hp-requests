// An HTTP request (or an event stream's): the method and URL, then its
// params, headers, body, auth and settings, and its answer below or beside.

import { Columns2, Plug, Rows2, Save, Send, Square, Unplug } from 'lucide-react';
import { useHost } from '@hyperpane/sdk/client';
import { NodeButton, ToolButton, cn } from '@hyperpane/ui';
import { type HttpRequest, METHODS } from '../../shared/index.ts';
import { paramsFromUrl, withQuery } from '../../shared/vars.ts';
import { AuthEditor } from './auth.tsx';
import { BodyEditor } from './body.tsx';
import { SettingsEditor } from './settings.tsx';
import { SseView } from './sse.tsx';
import { type EditorProps, useKeys } from '../lib/editor.ts';
import { dragFrom, useKept, useWidth } from '../lib/hooks.ts';
import { useLive } from '../lib/live.ts';
import { menuAt } from '../lib/menu.ts';
import { ResponseView } from '../response/view.tsx';
import { methodColor } from '../ui/badges.tsx';
import { COMMON_HEADERS, KVTable } from '../ui/kv-table.tsx';
import { Count, Tabs } from '../ui/tabs.tsx';
import { VarInput } from '../ui/var-input.tsx';

export function HttpEditor(p: EditorProps<HttpRequest>) {
  const host = useHost();
  const { request: r, onChange, vars, live, tabKey } = p;
  const state = useLive(live, tabKey);
  const sse = r.type === 'sse';
  const [sub, setSub] = useKept<'params' | 'headers' | 'body' | 'auth' | 'settings'>('requests.requestTab', 'params');
  const [layout, setLayout] = useKept<'below' | 'beside'>('requests.layout', 'below');
  const [at, setAt] = useKept('requests.splitAt', 0.42);
  const [box, width] = useWidth<HTMLDivElement>();
  const beside = layout === 'beside' && width >= 760;

  const set = (patch: Partial<HttpRequest>) => onChange({ ...r, ...patch });
  const sending = !!state.sending;
  const connected = sse && (state.sse?.status === 'open' || state.sse?.status === 'connecting');
  const go = () => {
    if (sse) {
      if (connected) live.disconnectSse(tabKey);
      else live.connectSse(tabKey, p.project, r, p.context);
    } else if (sending) live.cancel(tabKey);
    else void live.send(tabKey, p.project, r, p.context);
  };
  useKeys(go, p.onSave);

  const pickMethod = async (e: React.MouseEvent<HTMLButtonElement>) => {
    const id = await menuAt(
      host,
      e.currentTarget,
      [
        ...METHODS.map((m) => ({ id: m, label: m })),
        { id: '-', label: '', separator: true },
        { id: 'custom', label: 'Another method…' },
        { id: '-2', label: '', separator: true },
        { id: 'sse', label: sse ? '✓ Event stream (SSE)' : 'Event stream (SSE)' },
      ],
      sse ? undefined : r.method,
    );
    if (!id) return;
    if (id === 'sse') return set({ type: sse ? 'http' : 'sse' });
    if (id === 'custom') {
      const m = await host.ui.prompt({ title: 'Method', label: 'Any method the server takes (PROPFIND, PURGE…)', value: METHODS.includes(r.method) ? '' : r.method });
      if (m && /^[A-Za-z!#$%&'*+.^_`|~-]+$/.test(m.trim())) set({ method: m.trim().toUpperCase() });
      else if (m) host.app.toast(`“${m}” can’t be a method: letters and a few symbols only.`, { error: true });
      return;
    }
    set({ method: id });
  };

  const headerCount = r.headers.filter((h) => h.enabled && h.key).length;
  const paramCount = r.params.filter((h) => h.enabled && h.key).length;
  const bodyKind = r.body.kind;

  return (
    <div ref={box} className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex min-w-0 items-center gap-1.5 px-2 pt-2 pb-1.5">
        <button
          type="button"
          onClick={pickMethod}
          className="rounded-control flex h-7 flex-none items-center border border-[var(--node-border)] px-2 font-mono text-[11px] font-semibold hover:bg-[var(--node-hover)]"
          style={{ color: methodColor(sse ? 'SSE' : r.method) }}
          title={sse ? `An event stream (${r.method})` : 'Method'}
        >
          {sse ? `SSE ${r.method === 'GET' ? '' : r.method}`.trim() : r.method}
        </button>
        <VarInput
          tall
          className="flex-1"
          value={r.url}
          vars={vars}
          aria-label="URL"
          placeholder={sse ? 'https://example.com/events' : 'https://api.example.com/items or {{base}}/items'}
          onChange={(url) => set({ url, params: paramsFromUrl(url, r.params) })}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey) {
              e.preventDefault();
              go();
            }
          }}
        />
        <NodeButton
          className={cn('h-7 flex-none', !(sending || connected) && 'border-[var(--node-accent)] text-[var(--node-accent)]')}
          onClick={go}
          title={sse ? (connected ? 'Disconnect' : 'Connect (⌘↵)') : sending ? 'Cancel' : 'Send (⌘↵)'}
        >
          {sse ? connected ? <Unplug /> : <Plug /> : sending ? <Square /> : <Send />}
          <span className="hidden sm:inline">{sse ? (connected ? 'Disconnect' : 'Connect') : sending ? 'Cancel' : 'Send'}</span>
        </NodeButton>
        <ToolButton label={p.dirty ? 'Save (⌘S)' : 'Saved'} icon={Save} active={p.dirty} onClick={p.onSave} />
      </div>
      <div className={cn('flex min-h-0 min-w-0 flex-1', beside ? 'flex-row' : 'flex-col')}>
        <div className="flex min-h-0 min-w-0 flex-col" style={beside ? { width: `${at * 100}%` } : { height: `${at * 100}%`, minHeight: 90 }}>
          <Tabs
            value={sub}
            onChange={setSub}
            tabs={[
              { id: 'params', name: <>Params<Count n={paramCount} /></> },
              { id: 'headers', name: <>Headers<Count n={headerCount} /></> },
              { id: 'body', name: <>Body{bodyKind !== 'none' && <span className="ml-1 text-[var(--node-muted)]">·</span>}</> },
              { id: 'auth', name: <>Auth{r.auth.kind !== 'none' && r.auth.kind !== 'inherit' && <span className="ml-1 text-[var(--node-muted)]">·</span>}</> },
              { id: 'settings', name: 'Settings' },
            ]}
            right={<ToolButton label={beside ? 'Response below' : 'Response beside'} icon={beside ? Rows2 : Columns2} onClick={() => setLayout(beside ? 'below' : 'beside')} />}
          />
          <div className="min-h-0 flex-1 overflow-auto p-2">
            {sub === 'params' && (
              <KVTable rows={r.params} vars={vars} keyName="Param" onChange={(params) => set({ params, url: withQuery(r.url, params) })} />
            )}
            {sub === 'headers' && (
              <>
                <KVTable rows={r.headers} vars={vars} keyName="Header" suggest="requests-headers" onChange={(headers) => set({ headers })} />
                <datalist id="requests-headers">
                  {COMMON_HEADERS.map((h) => (
                    <option key={h} value={h} />
                  ))}
                </datalist>
                <p className="mt-2 text-[11px] text-[var(--node-muted)]">User-Agent, Accept, Accept-Encoding and Content-Type are added when they aren’t here.</p>
              </>
            )}
            {sub === 'body' && <BodyEditor r={r} set={set} vars={vars} />}
            {sub === 'auth' && <AuthEditor auth={r.auth} onChange={(auth) => set({ auth })} vars={vars} inheritFrom={p.inheritFrom} />}
            {sub === 'settings' && <SettingsEditor r={r} set={set} />}
          </div>
        </div>
        <div
          role="separator"
          aria-orientation={beside ? 'vertical' : 'horizontal'}
          className={cn('flex-none bg-[var(--node-border)] hover:bg-[var(--node-accent)]', beside ? 'w-px cursor-col-resize px-px' : 'h-px cursor-row-resize py-px')}
          onPointerDown={(e) => {
            const total = beside ? box.current!.clientWidth : box.current!.clientHeight - 40;
            const start = at;
            dragFrom(e, (dx, dy) => setAt(Math.max(0.15, Math.min(0.85, start + (beside ? dx : dy) / Math.max(total, 1)))));
          }}
        />
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {sse ? (
            <SseView tabKey={tabKey} live={live} />
          ) : state.sending ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 text-[var(--node-muted)]">
              <span className="animate-pulse">Sending…</span>
              <NodeButton onClick={() => live.cancel(tabKey)}>Cancel</NodeButton>
            </div>
          ) : state.error ? (
            <div className="m-2 rounded-md border border-[color-mix(in_srgb,var(--ansi-1)_40%,transparent)] bg-[color-mix(in_srgb,var(--ansi-1)_8%,transparent)] p-3 text-[var(--ansi-1)] select-text">{state.error}</div>
          ) : state.response ? (
            <ResponseView response={state.response} request={r} project={p.project} context={p.context} />
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-1 px-4 text-center text-[var(--node-muted)]">
              <span>Send it to see the answer here.</span>
              <span className="text-[11px]">⌘↵ (Ctrl+Enter) sends, ⌘S (Ctrl+S) saves.</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
