// Writing a message: text, JSON, or bytes (hex, base64); Enter sends,
// Shift+Enter is a new line; ping; and templates kept with the request,
// sent with a click.

import { BookmarkPlus, Rows3, SendHorizontal, Zap } from 'lucide-react';
import { useHost } from '@hyperpane/sdk/client';
import { ToolButton } from '@hyperpane/ui';
import { ID, type MessageFormat, type WsRequest, messagePayload, newId } from '../../shared/index.ts';
import type { EditorProps } from '../lib/editor.ts';
import { beautify } from '../lib/format.ts';
import { useKept } from '../lib/hooks.ts';
import { Picker } from '../ui/picker.tsx';

export const FORMATS: { id: MessageFormat; label: string }[] = [
  { id: 'text', label: 'Text' },
  { id: 'json', label: 'JSON' },
  { id: 'hex', label: 'Binary (hex)' },
  { id: 'base64', label: 'Binary (base64)' },
];

export function Composer({ p, open, templates }: { p: EditorProps<WsRequest>; open: boolean; templates: WsRequest['templates'] }) {
  const host = useHost();
  const { live, tabKey, request: r } = p;
  const [text, setText] = useKept(`requests.draft.${tabKey}`, '');
  const [format, setFormat] = useKept<MessageFormat>(`requests.format.${tabKey}`, 'text');

  const send = async (data: string, fmt: MessageFormat, clear: boolean) => {
    if (!open) return host.app.toast('It isn’t connected: connect first.', { error: true });
    let payload: { text?: string; bytes?: Uint8Array };
    try {
      payload = messagePayload(data, fmt);
    } catch (e) {
      return host.app.toast((e as Error).message, { error: true });
    }
    try {
      await host.call(ID, payload.bytes ? { op: 'wsSend', id: tabKey, data: payload.bytes } : { op: 'wsSend', id: tabKey, text: payload.text });
      if (clear) setText('');
    } catch (e) {
      live.note(tabKey, (e as Error).message);
    }
  };
  const ping = async () => {
    try {
      await host.call(ID, { op: 'wsPing', id: tabKey });
    } catch (e) {
      host.app.toast((e as Error).message, { error: true });
    }
  };
  const keep = async () => {
    if (!text.trim()) return host.app.toast('Write the message first, then keep it.', { error: true });
    const name = await host.ui.prompt({ title: 'Keep this message', label: 'A name for it', value: text.trim().split('\n')[0].slice(0, 32) });
    if (name === null) return;
    p.onChange({ ...r, templates: [...r.templates, { id: newId(), name: name.trim() || 'Message', data: text, format }] });
    host.app.toast('Kept with the request: save it to keep it for good.');
  };
  const templateMenu = async (e: React.MouseEvent, id: string) => {
    e.preventDefault();
    const t = r.templates.find((x) => x.id === id);
    if (!t) return;
    const pick = await host.ui.menu({ x: e.clientX, y: e.clientY }, [
      { id: 'send', label: 'Send' },
      { id: 'edit', label: 'Put in the composer' },
      { id: 'rename', label: 'Rename…' },
      { id: '-', label: '', separator: true },
      { id: 'delete', label: 'Remove', danger: true },
    ]);
    if (pick === 'send') void send(t.data, t.format, false);
    if (pick === 'edit') {
      setText(t.data);
      setFormat(t.format);
    }
    if (pick === 'rename') {
      const name = await host.ui.prompt({ title: 'Rename', label: 'Name', value: t.name });
      if (name) p.onChange({ ...r, templates: r.templates.map((x) => (x.id === id ? { ...x, name } : x)) });
    }
    if (pick === 'delete') p.onChange({ ...r, templates: r.templates.filter((x) => x.id !== id) });
  };

  return (
    <div className="flex flex-none flex-col gap-1 p-2">
      {templates.length > 0 && (
        <div className="flex max-h-14 min-w-0 flex-wrap gap-1 overflow-y-auto">
          {templates.map((t) => (
            <button
              key={t.id}
              type="button"
              title={`${t.data.slice(0, 200)}\n\nClick to send; right-click for more.`}
              onClick={() => void send(t.data, t.format, false)}
              onContextMenu={(e) => void templateMenu(e, t.id)}
              className="flex max-w-48 min-w-0 items-center gap-1 rounded-full border border-[var(--node-border)] px-2 py-0.5 text-[11px] hover:bg-[var(--node-hover)]"
            >
              <Zap className="size-3 flex-none text-[var(--ansi-3)]" />
              <span className="truncate">{t.name}</span>
            </button>
          ))}
        </div>
      )}
      <div className="flex min-w-0 items-end gap-1.5">
        <textarea
          rows={Math.min(8, Math.max(2, text.split('\n').length))}
          spellCheck={false}
          value={text}
          placeholder={open ? (format === 'hex' ? '01 02 ff …' : format === 'base64' ? 'AQL/…' : 'A message. Enter sends, Shift+Enter is a new line.') : 'Connect to send messages.'}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void send(text, format, true);
            }
          }}
          className="rounded-control min-w-0 flex-1 resize-none border border-[var(--node-border)] bg-transparent px-2 py-1.5 font-mono text-[11px] leading-4 text-[var(--node-fg)] outline-none placeholder:text-[var(--node-muted)] focus:border-[var(--node-accent)]"
        />
        <div className="flex flex-none flex-col gap-1">
          <Picker label="Format" className="h-6 w-24" value={format} options={FORMATS} onChange={(f) => setFormat(f as MessageFormat)} />
          <div className="flex gap-0.5">
            {format === 'json' && (
              <ToolButton
                label="Beautify"
                icon={Rows3}
                onClick={() => {
                  try {
                    setText(beautify(text));
                  } catch (e) {
                    host.app.toast(`That isn’t JSON yet: ${(e as Error).message}`, { error: true });
                  }
                }}
              />
            )}
            <ToolButton label="Keep as a template" icon={BookmarkPlus} onClick={() => void keep()} />
            <ToolButton label="Ping" icon={Zap} disabled={!open} onClick={() => void ping()} />
            <ToolButton label="Send (Enter)" icon={SendHorizontal} disabled={!open} onClick={() => void send(text, format, true)} />
          </div>
        </div>
      </div>
    </div>
  );
}
