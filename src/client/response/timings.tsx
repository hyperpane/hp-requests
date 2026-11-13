// Where the time went (a waterfall: lookup, connect, TLS, first byte,
// download), the connection, the certificate and the redirects.

import type { Response } from '../../shared/index.ts';
import { formatBytes, formatMs } from '../lib/format.ts';
import { StatusPill } from '../ui/badges.tsx';

export function TimingsView({ r }: { r: Response }) {
  const t = r.timings;
  const phases = [
    { name: 'DNS lookup', ms: t.dns, color: 'var(--ansi-6)' },
    { name: 'Connect', ms: t.connect, color: 'var(--ansi-3)' },
    { name: 'TLS handshake', ms: t.tls, color: 'var(--ansi-5)' },
    { name: 'Waiting (first byte)', ms: t.firstByte, color: 'var(--ansi-2)' },
    { name: 'Download', ms: t.download, color: 'var(--ansi-4)' },
  ];
  const total = Math.max(t.total, 0.1);
  let at = 0;
  return (
    <div className="min-h-0 flex-1 overflow-auto px-3 py-2">
      <div className="flex flex-col gap-1">
        {phases.map((p) => {
          const start = at;
          if (p.ms !== null) at += p.ms;
          return (
            <div key={p.name} className="flex min-w-0 items-center gap-2">
              <span className="w-32 flex-none truncate text-[var(--node-muted)]">{p.name}</span>
              <div className="relative h-3 min-w-0 flex-1 rounded-sm bg-[var(--node-hover)]">
                {p.ms !== null && <div className="absolute inset-y-0 rounded-sm" style={{ left: `${(start / total) * 100}%`, width: `max(2px, ${(p.ms / total) * 100}%)`, background: p.color }} />}
              </div>
              <span className="w-16 flex-none text-right font-mono text-[11px]">{p.ms === null ? '—' : formatMs(p.ms)}</span>
            </div>
          );
        })}
        <div className="flex items-center gap-2 border-t border-[var(--node-border)] pt-1">
          <span className="w-32 flex-none font-medium">Total</span>
          <span className="flex-1" />
          <span className="w-16 flex-none text-right font-mono text-[11px] font-medium">{formatMs(t.total)}</span>
        </div>
      </div>
      <dl className="mt-3 grid grid-cols-[max-content_minmax(0,1fr)] gap-x-3 gap-y-0.5 text-[11px]">
        <dt className="text-[var(--node-muted)]">Address</dt>
        <dd className="truncate font-mono">{r.remote ?? '—'}</dd>
        <dt className="text-[var(--node-muted)]">HTTP</dt>
        <dd className="font-mono">{r.httpVersion}</dd>
        <dt className="text-[var(--node-muted)]">Size</dt>
        <dd>
          {formatBytes(r.size)}
          {r.wireSize !== r.size && ` (${formatBytes(r.wireSize)} compressed)`}
        </dd>
        {r.tls && (
          <>
            <dt className="text-[var(--node-muted)]">TLS</dt>
            <dd className="truncate">
              {r.tls.protocol} · {r.tls.cipher}
            </dd>
            <dt className="text-[var(--node-muted)]">Certificate</dt>
            <dd className="truncate" title={r.tls.error ?? undefined}>
              {r.tls.subject} by {r.tls.issuer}
              {r.tls.validTo && `, until ${r.tls.validTo}`}
              {!r.tls.authorized && <span className="text-[var(--ansi-1)]"> · not trusted ({r.tls.error})</span>}
            </dd>
          </>
        )}
      </dl>
      {r.redirects.length > 0 && (
        <div className="mt-3">
          <div className="mb-1 text-[var(--node-muted)]">Redirects</div>
          {r.redirects.map((h, i) => (
            <div key={i} className="flex min-w-0 items-center gap-2 font-mono text-[11px]">
              <StatusPill status={h.status} />
              <span className="min-w-0 truncate" title={`${h.url} → ${h.location}`}>
                {h.url} → {h.location}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
