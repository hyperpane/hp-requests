// A response's headers in order, and the headers that were sent.

import { useState } from 'react';
import { Copy } from 'lucide-react';
import { useHost } from '@hyperpane/sdk/client';
import { ToolButton } from '@hyperpane/ui';
import type { Response } from '../../shared/index.ts';

export function HeaderTable({ headers }: { headers: [string, string][] }) {
  return (
    <div className="grid grid-cols-[minmax(80px,max-content)_minmax(0,1fr)] gap-x-3 gap-y-0.5 font-mono text-[11px] select-text">
      {headers.map(([k, v], i) => (
        <div key={i} className="contents">
          <span className="truncate text-[var(--node-muted)]" title={k}>
            {k}
          </span>
          <span className="break-all">{v}</span>
        </div>
      ))}
    </div>
  );
}

export function HeadersView({ r }: { r: Response }) {
  const host = useHost();
  const [sent, setSent] = useState(false);
  return (
    <div className="min-h-0 flex-1 overflow-auto px-3 py-2">
      <div className="mb-1 flex items-center">
        <span className="flex-1 text-[var(--node-muted)]">
          HTTP/{r.httpVersion} {r.status} {r.statusText}
        </span>
        <ToolButton label="Copy the headers" icon={Copy} onClick={() => void host.app.clipboardWrite({ text: r.headers.map(([k, v]) => `${k}: ${v}`).join('\n') })} />
      </div>
      <HeaderTable headers={r.headers} />
      <button type="button" className="mt-3 mb-1 text-[var(--node-muted)] hover:text-[var(--node-fg)]" onClick={() => setSent(!sent)}>
        {sent ? '▾' : '▸'} Sent: {r.sent.method} {r.sent.url}
      </button>
      {sent && <HeaderTable headers={r.sent.headers} />}
    </div>
  );
}
