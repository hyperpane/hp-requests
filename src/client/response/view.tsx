// A response: its status, time and size, and its tabs (body, headers,
// cookies, timings, cURL).

import { useMemo } from 'react';
import { type Context, type HttpRequest, type Response, parseSetCookie } from '../../shared/index.ts';
import { formatBytes, formatMs } from '../lib/format.ts';
import { useKept } from '../lib/hooks.ts';
import { BodyView } from './body.tsx';
import { CookiesView } from './cookies.tsx';
import { CurlView } from './curl.tsx';
import { HeadersView } from './headers.tsx';
import { TimingsView } from './timings.tsx';
import { StatusPill } from '../ui/badges.tsx';
import { Count, Tabs } from '../ui/tabs.tsx';

export function ResponseView({ response: r, request, project, context }: { response: Response; request: HttpRequest; project: string | null; context: Context }) {
  const [tab, setTab] = useKept<'body' | 'headers' | 'cookies' | 'timings' | 'curl'>('requests.responseTab', 'body');
  const cookies = useMemo(() => r.headers.filter(([k]) => k.toLowerCase() === 'set-cookie').map(([, v]) => parseSetCookie(v)), [r]);
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'body', name: 'Body' },
          { id: 'headers', name: <>Headers<Count n={r.headers.length} /></> },
          { id: 'cookies', name: <>Cookies<Count n={cookies.length} /></> },
          { id: 'timings', name: 'Timings' },
          { id: 'curl', name: 'cURL' },
        ]}
        right={<Summary r={r} />}
      />
      {tab === 'body' && <BodyView r={r} />}
      {tab === 'headers' && <HeadersView r={r} />}
      {tab === 'cookies' && <CookiesView cookies={cookies} />}
      {tab === 'timings' && <TimingsView r={r} />}
      {tab === 'curl' && <CurlView request={request} project={project} context={context} />}
    </div>
  );
}

export function Summary({ r }: { r: Response }) {
  return (
    <div className="flex min-w-0 items-center gap-2 pl-2 text-[11px] text-[var(--node-muted)]">
      <StatusPill status={r.status} text={r.statusText} />
      <span className="flex-none" title="Total time">
        {formatMs(r.timings.total)}
      </span>
      <span className="hidden flex-none sm:inline" title={`${formatBytes(r.wireSize)} on the wire`}>
        {formatBytes(r.size)}
        {r.truncated && ' (cut)'}
      </span>
    </div>
  );
}
