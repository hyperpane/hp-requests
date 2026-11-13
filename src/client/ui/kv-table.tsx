// Key/value rows: params, headers, form fields, variables.

import { Trash2 } from 'lucide-react';
import { ToolButton, cn } from '@hyperpane/ui';
import type { KV } from '../../shared/index.ts';
import { VarInput } from './var-input.tsx';

export const COMMON_HEADERS = [
  'Accept',
  'Accept-Encoding',
  'Accept-Language',
  'Authorization',
  'Cache-Control',
  'Connection',
  'Content-Type',
  'Cookie',
  'If-Match',
  'If-Modified-Since',
  'If-None-Match',
  'Origin',
  'Referer',
  'User-Agent',
  'X-API-Key',
  'X-Correlation-ID',
  'X-Forwarded-For',
  'X-Requested-With',
  'X-Request-ID',
];

/** Key/value rows with a checkbox each, and an empty row at the end that
 * becomes a new one as it's typed in. */
export function KVTable({
  rows,
  onChange,
  vars,
  keyName = 'Key',
  valueName = 'Value',
  suggest,
  extra,
}: {
  rows: KV[];
  onChange(rows: KV[]): void;
  vars: Map<string, string>;
  keyName?: string;
  valueName?: string;
  /** A datalist's id, for the keys. */
  suggest?: string;
  /** More for a row (a secret toggle, a file/text switch), before delete. */
  extra?(row: KV, i: number): React.ReactNode;
}) {
  const all = [...rows, { key: '', value: '', enabled: true }];
  const set = (i: number, r: Partial<KV>) => {
    if (i === rows.length) onChange([...rows, { key: '', value: '', enabled: true, ...r }]);
    else onChange(rows.map((x, j) => (j === i ? { ...x, ...r } : x)));
  };
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <div className="flex items-center gap-1.5 px-0.5 text-[10px] tracking-wide text-[var(--node-muted)] uppercase">
        <span className="w-4 flex-none" />
        <span className="min-w-0 flex-1">{keyName}</span>
        <span className="min-w-0 flex-[1.4]">{valueName}</span>
        <span className="w-6 flex-none" />
      </div>
      {all.map((r, i) => {
        const last = i === rows.length;
        return (
          <div key={i} className="group flex min-w-0 items-center gap-1.5">
            <input type="checkbox" className="w-4 flex-none" checked={!last && r.enabled} disabled={last} aria-label="Send this one" onChange={(e) => set(i, { enabled: e.target.checked })} />
            <VarInput className={cn('flex-1', !last && !r.enabled && 'opacity-50')} value={r.key} vars={vars} list={suggest} placeholder={last ? `Add ${keyName.toLowerCase()}` : keyName} onChange={(key) => set(i, { key })} aria-label={keyName} />
            <VarInput className={cn('flex-[1.4]', !last && !r.enabled && 'opacity-50')} value={r.value} vars={vars} placeholder={valueName} onChange={(value) => set(i, { value })} aria-label={valueName} />
            {!last && extra?.(r, i)}
            {last ? <span className="w-6 flex-none" /> : <ToolButton label="Remove" icon={Trash2} className="flex-none opacity-60 group-hover:opacity-100" onClick={() => onChange(rows.filter((_, j) => j !== i))} />}
          </div>
        );
      })}
    </div>
  );
}
