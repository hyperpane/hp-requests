// The request as a cURL command, its variables filled in, to copy.

import { useEffect, useState } from 'react';
import { Copy } from 'lucide-react';
import { useHost } from '@hyperpane/sdk/client';
import { ToolButton } from '@hyperpane/ui';
import { type Context, type HttpRequest, ID } from '../../shared/index.ts';
import { CodeArea } from '../ui/code-area.tsx';

export function CurlView({ request, project, context }: { request: HttpRequest; project: string | null; context: Context }) {
  const host = useHost();
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const key = JSON.stringify([request, context]);
  useEffect(() => {
    let live = true;
    host.call<string>(ID, { op: 'exportCurl', project, request, context }).then(
      (t) => live && (setText(t), setError(null)),
      (e: Error) => live && setError(e.message),
    );
    return () => {
      live = false;
    };
  }, [key]);
  return <CurlBox text={text} error={error} />;
}

export function CurlBox({ text, error }: { text: string | null; error: string | null }) {
  const host = useHost();
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-1 px-2 py-2">
      <div className="flex items-center">
        <span className="flex-1 text-[11px] text-[var(--node-muted)]">With variables filled in.</span>
        <ToolButton label="Copy the command" icon={Copy} disabled={!text} onClick={() => text && void host.app.clipboardWrite({ text })} />
      </div>
      {error ? <p className="text-[var(--ansi-1)]">{error}</p> : <CodeArea readOnly value={text ?? ''} className="flex-1" />}
    </div>
  );
}
