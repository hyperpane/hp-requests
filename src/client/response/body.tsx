// A response's body: pretty (a JSON tree to search, markup indented), raw,
// or previewed (an image, HTML in a sandbox); copied, or saved to a file.

import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronsDownUp, ChevronsUpDown, Copy, Download, WrapText } from 'lucide-react';
import { useHost } from '@hyperpane/sdk/client';
import { JsonText, JsonTree, type JsonTreeHandle, NodeInput, ToolButton, cn } from '@hyperpane/ui';
import { ID, type Response } from '../../shared/index.ts';
import { formatBytes } from '../lib/format.ts';
import { useKept } from '../lib/hooks.ts';
import { Hex } from './hex.tsx';

export type Kind = 'json' | 'image' | 'html' | 'xml' | 'text' | 'binary';

/** The most text shown at once; the rest is saved, not drawn. */
export const SHOW = 2 * 1024 * 1024;

export function kindOf(r: Response): { kind: Kind; text: string | null; json?: unknown } {
  const ct = r.contentType.toLowerCase();
  if (ct.startsWith('image/')) return { kind: 'image', text: null };
  const bytes = r.body;
  let text: string | null = null;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes.length > SHOW * 4 ? bytes.subarray(0, SHOW * 4) : bytes);
  } catch {
    text = null;
  }
  if (text === null || (text.includes('\0') && !ct.startsWith('text/'))) return { kind: 'binary', text: null };
  const t = text.trimStart();
  if (ct.includes('json') || ((t.startsWith('{') || t.startsWith('[')) && !ct.includes('html'))) {
    try {
      return { kind: 'json', text, json: JSON.parse(text) };
    } catch {}
  }
  if (ct.includes('html')) return { kind: 'html', text };
  if (ct.includes('xml') || (t.startsWith('<?xml') && !ct)) return { kind: 'xml', text };
  return { kind: 'text', text };
}

/** XML or HTML, one tag a line, indented. */
export function indentMarkup(text: string): string {
  if (text.length > 500_000) return text;
  let depth = 0;
  return text
    .replace(/>\s*</g, '>\n<')
    .split('\n')
    .map((line) => {
      const l = line.trim();
      if (/^<\/[^>]+>$/.test(l)) depth = Math.max(0, depth - 1);
      const out = `${'  '.repeat(depth)}${l}`;
      if (/^<[^!?/][^>]*[^/]>$/.test(l) && !/^<[^>]+>.*<\/[^>]+>$/.test(l) && !/^<(br|hr|img|input|meta|link|area|base|col|embed|source|track|wbr)\b/i.test(l)) depth++;
      return out;
    })
    .join('\n');
}

export function BodyView({ r }: { r: Response }) {
  const host = useHost();
  const found = useMemo(() => kindOf(r), [r]);
  const [mode, setMode] = useState<'pretty' | 'raw' | 'preview'>(found.kind === 'image' ? 'preview' : 'pretty');
  const [find, setFind] = useState('');
  const [wrap, setWrap] = useKept('requests.wrap', true);
  const tree = useRef<JsonTreeHandle>(null);
  useEffect(() => setMode(found.kind === 'image' ? 'preview' : 'pretty'), [r.id]);
  const url = useMemo(() => (found.kind === 'image' || found.kind === 'html' ? URL.createObjectURL(new Blob([r.body as BlobPart], { type: r.contentType || 'application/octet-stream' })) : null), [r.id]);
  useEffect(() => () => void (url && URL.revokeObjectURL(url)), [url]);

  const text = found.text ?? '';
  const shown = text.length > SHOW ? text.slice(0, SHOW) : text;
  const pretty = useMemo(() => {
    if (found.kind === 'json' && found.json !== undefined) return JSON.stringify(found.json, null, 2);
    if (found.kind === 'xml' || found.kind === 'html') return indentMarkup(shown);
    return shown;
  }, [r.id]);
  const modes: { id: typeof mode; name: string }[] = [
    { id: 'pretty', name: 'Pretty' },
    { id: 'raw', name: 'Raw' },
    ...(found.kind === 'image' || found.kind === 'html' ? [{ id: 'preview' as const, name: 'Preview' }] : []),
  ];
  const save = () =>
    void host.app.saveStream(ID, { op: 'body', id: r.id }, { name: (() => {
      const base = new URL(r.url).pathname.split('/').filter(Boolean).pop() || 'response';
      const ext = found.kind === 'json' ? '.json' : found.kind === 'html' ? '.html' : found.kind === 'xml' ? '.xml' : '';
      return base.includes('.') || !ext ? base : base + ext;
    })() }).catch((e: Error) => host.app.toast(e.message, { error: true }));

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-w-0 items-center gap-1 px-2 py-1">
        <div className="flex flex-none rounded-md border border-[var(--node-border)] p-px">
          {modes.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => setMode(m.id)}
              className={cn('rounded px-2 py-0.5 text-[11px]', mode === m.id ? 'bg-[var(--node-hover)] text-[var(--node-fg)]' : 'text-[var(--node-muted)] hover:text-[var(--node-fg)]')}
            >
              {m.name}
            </button>
          ))}
        </div>
        {found.kind === 'json' && mode === 'pretty' ? (
          <>
            <NodeInput className="h-6 min-w-0 flex-1" placeholder="Find a key or a value" value={find} onChange={(e) => setFind(e.target.value)} />
            <ToolButton label="Open all" icon={ChevronsUpDown} onClick={() => tree.current?.expandAll()} />
            <ToolButton label="Close all" icon={ChevronsDownUp} onClick={() => tree.current?.collapseAll()} />
          </>
        ) : (
          <span className="min-w-0 flex-1 truncate text-[11px] text-[var(--node-muted)]">{r.contentType || 'No Content-Type'}</span>
        )}
        {mode !== 'preview' && found.text !== null && <ToolButton label={wrap ? 'Don’t wrap lines' : 'Wrap lines'} icon={WrapText} active={wrap} onClick={() => setWrap(!wrap)} />}
        {found.text !== null && <ToolButton label="Copy the body" icon={Copy} onClick={() => void host.app.clipboardWrite({ text: mode === 'pretty' ? pretty : text })} />}
        <ToolButton label="Save the body to a file" icon={Download} onClick={save} />
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-2 pb-2">
        {r.size === 0 ? (
          <p className="py-3 text-[var(--node-muted)]">No body.</p>
        ) : mode === 'preview' && url ? (
          found.kind === 'image' ? (
            <div className="flex justify-center rounded-md border border-[var(--node-border)] bg-[repeating-conic-gradient(var(--node-hover)_0_25%,transparent_0_50%)] bg-[length:16px_16px] p-2">
              <img src={url} alt="The response" className="max-h-full max-w-full object-contain" />
            </div>
          ) : (
            <iframe title="Preview" sandbox="" srcDoc={text} className="h-full min-h-60 w-full rounded-md border border-[var(--node-border)] bg-white" />
          )
        ) : found.kind === 'binary' || found.kind === 'image' ? (
          <Hex bytes={r.body} />
        ) : found.kind === 'json' && mode === 'pretty' && text.length < 5_000_000 ? (
          <div className="font-mono text-[11px]">
            <JsonTree value={found.json} search={find} depth={2} handle={tree} footer />
          </div>
        ) : (
          <div className={cn('font-mono text-[11px] leading-4 select-text', wrap ? 'break-all whitespace-pre-wrap' : 'whitespace-pre')}>
            {found.kind === 'json' && mode === 'raw' ? <JsonText text={shown} /> : mode === 'pretty' ? pretty : shown}
          </div>
        )}
        {(r.truncated || text.length > SHOW) && (
          <p className="pt-2 text-[11px] text-[var(--node-muted)] italic">
            {r.truncated ? `Only the first ${formatBytes(r.size)} were read. ` : `Only the first ${formatBytes(SHOW)} are shown. `}Save it to see the rest.
          </p>
        )}
      </div>
    </div>
  );
}
