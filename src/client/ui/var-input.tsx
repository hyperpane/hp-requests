// A text field whose variables are colored as they're typed.

import { useEffect, useRef } from 'react';
import { NodeInput, cn } from '@hyperpane/ui';
import { pieces } from '../../shared/vars.ts';

/** A text field whose `{{variables}}` are colored: green when they're
 * set, red when they aren't. The colors are drawn behind a field with
 * clear text, so typing and selecting stay the field's own. */
export function VarInput({
  value,
  onChange,
  vars,
  className,
  placeholder,
  onKeyDown,
  list,
  mono = true,
  tall,
  ...rest
}: {
  value: string;
  onChange(v: string): void;
  vars: Map<string, string>;
  className?: string;
  placeholder?: string;
  onKeyDown?: React.KeyboardEventHandler<HTMLInputElement>;
  list?: string;
  mono?: boolean;
  /** 28px, as the URL bar's other controls; else 24px. */
  tall?: boolean;
  'aria-label'?: string;
}) {
  const back = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLInputElement>(null);
  const parts = value.includes('{{') ? pieces(value, vars) : null;
  const sync = () => {
    if (back.current && field.current) back.current.scrollLeft = field.current.scrollLeft;
  };
  useEffect(sync, [value]);
  const missing = parts?.filter((p) => p.variable === 'missing').map((p) => p.text);
  return (
    <div className={cn('relative min-w-0', className)} title={missing?.length ? `Not set: ${missing.join(', ')}` : undefined}>
      {parts && (
        <div ref={back} aria-hidden className={cn('pointer-events-none absolute inset-0 flex items-center overflow-hidden border border-transparent px-2 text-xs whitespace-pre', mono && 'font-mono')}>
          {parts.map((p, i) =>
            p.variable ? (
              <span key={i} className="rounded-sm" style={{ color: p.variable === 'ok' ? 'var(--ansi-2)' : 'var(--ansi-1)', background: p.variable === 'ok' ? 'color-mix(in srgb, var(--ansi-2) 12%, transparent)' : 'color-mix(in srgb, var(--ansi-1) 15%, transparent)' }}>
                {p.text}
              </span>
            ) : (
              <span key={i}>{p.text}</span>
            ),
          )}
        </div>
      )}
      <NodeInput
        ref={field}
        {...rest}
        list={list}
        spellCheck={false}
        autoComplete="off"
        className={cn('w-full bg-transparent', tall && 'h-7', mono && 'font-mono', parts && 'text-transparent caret-[var(--node-fg)]')}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onScroll={sync}
        onKeyUp={sync}
        onKeyDown={onKeyDown}
      />
    </div>
  );
}
