// A choice that opens the app's menu instead of a native select.

import { ChevronDown } from 'lucide-react';
import { useHost } from '@hyperpane/sdk/client';
import { cn } from '@hyperpane/ui';
import { type Option, menuAt } from '../lib/menu.ts';

/** A choice that opens the app's own menu: its label shortens with an
 * ellipsis instead of running out of its box, as a native select's does. */
export function Picker({
  value,
  options,
  onChange,
  label,
  className,
  render,
}: {
  value: string;
  options: Option[];
  onChange(id: string): void;
  label: string;
  className?: string;
  render?(o: Option | undefined): React.ReactNode;
}) {
  const host = useHost();
  const current = options.find((o) => o.id === value);
  return (
    <button
      type="button"
      aria-label={label}
      title={current?.label ?? label}
      className={cn(
        'rounded-control flex h-7 min-w-0 items-center gap-1 border border-[var(--node-border)] px-2 text-left hover:bg-[var(--node-hover)] focus-visible:border-[var(--node-accent)] focus-visible:outline-none',
        className,
      )}
      onClick={async (e) => {
        const id = await menuAt(host, e.currentTarget, options, value);
        if (id && id !== value) onChange(id);
      }}
    >
      <span className="min-w-0 flex-1 truncate">{render ? render(current) : (current?.label ?? label)}</span>
      <ChevronDown className="size-3.5 flex-none text-[var(--node-muted)]" />
    </button>
  );
}
