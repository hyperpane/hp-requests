// A request's body: none, JSON (with Beautify), text by type, a form
// (URL-encoded or multipart, with files on the server), a file, GraphQL.

import { Sparkles } from 'lucide-react';
import { useHost } from '@hyperpane/sdk/client';
import { NodeButton, ToolButton } from '@hyperpane/ui';
import { type BodyKind, type FormField, type HttpRequest, TEXT_TYPES, type TextType } from '../../shared/index.ts';
import { beautify } from '../lib/format.ts';
import { CodeArea } from '../ui/code-area.tsx';
import { KVTable } from '../ui/kv-table.tsx';
import { Picker } from '../ui/picker.tsx';
import { VarInput } from '../ui/var-input.tsx';

export const BODY_KINDS: { id: BodyKind; label: string }[] = [
  { id: 'none', label: 'No body' },
  { id: 'json', label: 'JSON' },
  { id: 'text', label: 'Text, XML, HTML' },
  { id: 'urlencoded', label: 'Form (URL-encoded)' },
  { id: 'multipart', label: 'Multipart form' },
  { id: 'binary', label: 'A file (binary)' },
  { id: 'graphql', label: 'GraphQL' },
];

export function BodyEditor({ r, set, vars }: { r: HttpRequest; set(p: Partial<HttpRequest>): void; vars: Map<string, string> }) {
  const host = useHost();
  const b = r.body;
  const setBody = (patch: Partial<HttpRequest['body']>) => set({ body: { ...b, ...patch } });
  const pretty = (text: string, put: (t: string) => void) => {
    try {
      put(beautify(text));
    } catch (e) {
      host.app.toast(`That isn’t JSON yet: ${(e as Error).message}`, { error: true });
    }
  };
  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <div className="flex min-w-0 items-center gap-1.5">
        <Picker label="Body" className="w-44 flex-none" value={b.kind} options={BODY_KINDS} onChange={(kind) => setBody({ kind: kind as BodyKind })} />
        {b.kind === 'text' && (
          <Picker
            label="Type"
            className="w-28 flex-none"
            value={b.textType}
            options={(Object.entries(TEXT_TYPES) as [TextType, { name: string }][]).map(([id, t]) => ({ id, label: t.name }))}
            onChange={(t) => setBody({ textType: t as TextType })}
          />
        )}
        <span className="flex-1" />
        {b.kind === 'json' && (
          <NodeButton onClick={() => pretty(b.text, (text) => setBody({ text }))}>
            <Sparkles />
            Beautify
          </NodeButton>
        )}
      </div>
      {b.kind === 'none' && <p className="text-[var(--node-muted)]">This request has no body.</p>}
      {(b.kind === 'json' || b.kind === 'text') && (
        <CodeArea className="min-h-32 flex-1" value={b.text} onChange={(text) => setBody({ text })} placeholder={b.kind === 'json' ? '{\n  "name": "{{name}}"\n}' : 'The body, as it’s sent'} />
      )}
      {b.kind === 'urlencoded' && <KVTable rows={b.form} vars={vars} keyName="Field" onChange={(form) => setBody({ form })} />}
      {b.kind === 'multipart' && (
        <>
          <KVTable
            rows={b.multipart}
            vars={vars}
            keyName="Field"
            valueName="Value, or a file’s path on the server"
            onChange={(rows) => setBody({ multipart: rows.map((x) => ({ type: 'text', ...x }) as FormField) })}
            extra={(row, i) => {
              const f = row as FormField;
              return (
                <button
                  type="button"
                  className="rounded-control h-6 w-10 flex-none border border-[var(--node-border)] text-[10px] text-[var(--node-muted)] hover:text-[var(--node-fg)]"
                  title={f.type === 'file' ? 'A file: the value is its path on the server' : 'Text'}
                  onClick={() => setBody({ multipart: b.multipart.map((x, j) => (j === i ? { ...x, type: x.type === 'file' ? 'text' : 'file' } : x)) })}
                >
                  {f.type === 'file' ? 'File' : 'Text'}
                </button>
              );
            }}
          />
          <p className="text-[11px] text-[var(--node-muted)]">A file’s path is on the server; a relative one is in the project’s folder.</p>
        </>
      )}
      {b.kind === 'binary' && (
        <label className="flex flex-col gap-1">
          <span className="text-[var(--node-muted)]">The file to send, on the server (a relative path is in the project’s folder)</span>
          <VarInput value={b.file} vars={vars} onChange={(file) => setBody({ file })} placeholder="/path/to/file.bin" />
        </label>
      )}
      {b.kind === 'graphql' && (
        <div className="flex min-h-0 flex-1 flex-col gap-1">
          <span className="text-[var(--node-muted)]">Query</span>
          <CodeArea className="min-h-24 flex-[2]" value={b.graphql.query} onChange={(query) => setBody({ graphql: { ...b.graphql, query } })} placeholder={'query {\n  me { id name }\n}'} />
          <div className="flex items-center">
            <span className="flex-1 text-[var(--node-muted)]">Variables (JSON)</span>
            <ToolButton label="Beautify" icon={Sparkles} onClick={() => pretty(b.graphql.variables, (variables) => setBody({ graphql: { ...b.graphql, variables } }))} />
          </div>
          <CodeArea className="min-h-16 flex-1" value={b.graphql.variables} onChange={(variables) => setBody({ graphql: { ...b.graphql, variables } })} placeholder='{ "id": "{{userId}}" }' />
        </div>
      )}
    </div>
  );
}
