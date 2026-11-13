// A method's colored badge and a status's pill.

import { cn } from '@hyperpane/ui';
import { statusClass } from '../../shared/index.ts';

export const METHOD_COLOR: Record<string, string> = {
  GET: 'var(--ansi-2)',
  POST: 'var(--ansi-3)',
  PUT: 'var(--ansi-4)',
  PATCH: 'var(--ansi-5)',
  DELETE: 'var(--ansi-1)',
  HEAD: 'var(--ansi-6)',
  OPTIONS: 'var(--ansi-6)',
  WS: 'var(--ansi-5)',
  SSE: 'var(--ansi-6)',
};

export const methodColor = (m: string) => METHOD_COLOR[m.toUpperCase()] ?? 'var(--node-muted)';

/** A method's short badge, in its color (`WS`, `SSE` for the others). */
export function MethodBadge({ method, className }: { method: string; className?: string }) {
  const short = method === 'DELETE' ? 'DEL' : method === 'OPTIONS' ? 'OPT' : method.length > 5 ? method.slice(0, 4) : method;
  return (
    <span className={cn('inline-block w-9 flex-none text-right font-mono text-[10px] font-semibold', className)} style={{ color: methodColor(method) }}>
      {short}
    </span>
  );
}

export const STATUS_COLOR = { info: 'var(--ansi-6)', ok: 'var(--ansi-2)', redirect: 'var(--ansi-4)', client: 'var(--ansi-3)', server: 'var(--ansi-1)', none: 'var(--node-muted)' };

export const statusColor = (status: number | null | undefined) => STATUS_COLOR[statusClass(status)];

export function StatusPill({ status, text }: { status: number | null; text?: string }) {
  const color = statusColor(status);
  return (
    <span
      className="inline-flex h-5 flex-none items-center rounded px-1.5 font-mono text-[11px] font-semibold"
      style={{ color, background: `color-mix(in srgb, ${color} 15%, transparent)` }}
    >
      {status ?? 'Error'}
      {text ? ` ${text}` : ''}
    </span>
  );
}
