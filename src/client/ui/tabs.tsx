// A row of tabs, with room for controls on the right.

import { cn } from '@hyperpane/ui';

export function Tabs<const T extends string>({ tabs, value, onChange, right, className }: { tabs: { id: T; name: React.ReactNode }[]; value: NoInfer<T>; onChange(v: NoInfer<T>): void; right?: React.ReactNode; className?: string }) {
  return (
    <div className={cn('flex min-w-0 items-center gap-0.5 border-b border-[var(--node-border)] px-2', className)}>
      <div className="flex min-w-0 flex-1 gap-0.5 overflow-x-auto [scrollbar-width:none]">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => onChange(t.id)}
            className={cn(
              '-mb-px flex-none border-b-2 px-2 py-1.5 text-xs whitespace-nowrap transition-colors duration-100',
              value === t.id ? 'border-[var(--node-accent)] text-[var(--node-fg)]' : 'border-transparent text-[var(--node-muted)] hover:text-[var(--node-fg)]',
            )}
          >
            {t.name}
          </button>
        ))}
      </div>
      {right && <div className="flex flex-none items-center gap-0.5">{right}</div>}
    </div>
  );
}

/** A count after a tab's name. */
export const Count = ({ n }: { n: number }) => (n ? <span className="ml-1 text-[var(--node-muted)]">{n}</span> : null);
