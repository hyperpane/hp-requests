// Importing: a cURL command (it opens as a new request), or a Postman
// collection or environment (added to the project), pasted or from a file
// on this computer.

import { useRef, useState } from 'react';
import { FileUp, X } from 'lucide-react';
import { useHost } from '@hyperpane/sdk/client';
import { NodeButton, ToolButton } from '@hyperpane/ui';
import { type HttpRequest, ID } from '../../shared/index.ts';
import { CodeArea } from '../ui/code-area.tsx';

export function ImportDialog({ project, onClose, onRequest }: { project: string; onClose(): void; onRequest(r: HttpRequest): void }) {
  const host = useHost();
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const t = text.trim();
  const kind = !t ? null : /^curl(\s|$)/.test(t) ? 'cURL command' : t.startsWith('{') ? 'Postman file' : null;

  const go = async () => {
    setError(null);
    if (!kind) return setError('Paste a cURL command (it starts with curl) or a Postman collection or environment (JSON).');
    setBusy(true);
    try {
      if (kind === 'cURL command') onRequest(await host.call<HttpRequest>(ID, { op: 'importCurl', command: t }));
      else {
        const done = await host.call<{ kind: string; name: string }>(ID, { op: 'import', project, data: t });
        host.app.toast(`Imported the ${done.kind} “${done.name}”`);
        onClose();
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center bg-[color-mix(in_srgb,var(--node-bg)_70%,transparent)] p-4" onClick={onClose}>
      <div
        className="flex max-h-full w-full max-w-xl min-w-0 flex-col gap-2 rounded-lg border border-[var(--node-border)] bg-[var(--node-bg)] p-3 shadow-lg"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onClose();
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            void go();
          }
        }}
      >
        <div className="flex items-center">
          <span className="flex-1 font-medium">Import</span>
          <ToolButton label="Close" icon={X} onClick={onClose} />
        </div>
        <p className="text-[var(--node-muted)]">A cURL command (as “Copy as cURL” gives it) opens as a new request. A Postman collection (v2.1) or environment is added to the project.</p>
        <CodeArea className="h-48 flex-none" value={text} onChange={setText} placeholder={"curl 'https://api.example.com/items' -H 'Accept: application/json'\n\nor a Postman collection’s JSON"} />
        {error && <p className="text-[var(--ansi-1)] select-text">{error}</p>}
        <div className="flex flex-wrap items-center gap-1.5">
          <input
            ref={file}
            type="file"
            accept=".json,application/json"
            className="hidden"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (!f) return;
              if (f.size > 20 * 1024 * 1024) return setError('That file is over 20 MB: is it a Postman export?');
              setText(await f.text());
            }}
          />
          <NodeButton onClick={() => file.current?.click()}>
            <FileUp />
            Choose a file…
          </NodeButton>
          <span className="min-w-0 flex-1 truncate text-[11px] text-[var(--node-muted)]">{kind ? `It’s a ${kind}.` : ''}</span>
          <NodeButton onClick={onClose}>Cancel</NodeButton>
          <NodeButton className="border-[var(--node-accent)] text-[var(--node-accent)]" disabled={!t || busy} onClick={() => void go()}>
            {busy ? 'Importing…' : 'Import'}
          </NodeButton>
        </div>
      </div>
    </div>
  );
}
