// The button that scrolls a followed list back to its newest line.

import { ArrowDown } from 'lucide-react';

export function ToEnd({ onClick }: { onClick(): void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="absolute right-3 bottom-2 flex items-center gap-1 rounded-full border border-[var(--node-border)] bg-[var(--node-bg)] px-2 py-0.5 text-[11px] shadow hover:bg-[var(--node-hover)]"
    >
      <ArrowDown className="size-3" />
      Newest
    </button>
  );
}
