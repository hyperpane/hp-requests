// A text area for code.

import { cn } from '@hyperpane/ui';

/** A text area for code: monospaced, Tab indents, no spell check. */
export function CodeArea({ value, onChange, placeholder, className, readOnly, onKeyDown }: { value: string; onChange?(v: string): void; placeholder?: string; className?: string; readOnly?: boolean; onKeyDown?: React.KeyboardEventHandler<HTMLTextAreaElement> }) {
  return (
    <textarea
      spellCheck={false}
      readOnly={readOnly}
      placeholder={placeholder}
      value={value}
      onChange={(e) => onChange?.(e.target.value)}
      onKeyDown={(e) => {
        onKeyDown?.(e);
        if (e.defaultPrevented) return;
        if (e.key === 'Tab' && !e.metaKey && !e.ctrlKey && !readOnly) {
          e.preventDefault();
          const el = e.currentTarget;
          const { selectionStart: a, selectionEnd: b } = el;
          const next = `${el.value.slice(0, a)}  ${el.value.slice(b)}`;
          onChange?.(next);
          requestAnimationFrame(() => el.setSelectionRange(a + 2, a + 2));
        }
      }}
      className={cn(
        'rounded-control min-h-0 w-full resize-none border border-[var(--node-border)] bg-[color-mix(in_srgb,var(--node-fg)_3%,transparent)] p-2 font-mono text-[11px] leading-4 text-[var(--node-fg)] outline-none placeholder:text-[var(--node-muted)] focus:border-[var(--node-accent)]',
        className,
      )}
    />
  );
}
