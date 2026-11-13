// The strip of open tabs: each with its method, name and an unsaved dot;
// closed with its button or the middle button.

import { useEffect, useRef } from 'react';
import { PanelLeft, Plus, X } from 'lucide-react';
import { ToolButton, cn } from '@hyperpane/ui';
import { type Tab, dirty, methodOf } from '../lib/model.ts';
import { MethodBadge } from '../ui/badges.tsx';

export function TabStrip({
  tabs,
  active,
  name,
  onActivate,
  onClose,
  onNew,
  sideOpen,
  toggleSide,
}: {
  tabs: Tab[];
  active: string | null;
  name(t: Tab): string;
  onActivate(k: string): void;
  onClose(k: string): void;
  onNew(e: React.MouseEvent<HTMLButtonElement>): void;
  sideOpen: boolean;
  toggleSide(): void;
}) {
  const strip = useRef<HTMLDivElement>(null);
  useEffect(() => {
    strip.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [active]);
  return (
    <div className="flex h-8 flex-none items-stretch border-b border-[var(--node-border)]">
      <ToolButton label={sideOpen ? 'Hide the sidebar' : 'Show the sidebar'} icon={PanelLeft} active={sideOpen} className="mx-1 self-center" onClick={toggleSide} />
      <div ref={strip} className="flex min-w-0 flex-1 items-stretch overflow-x-auto [scrollbar-width:thin]">
        {tabs.map((t) => {
          const on = t.key === active;
          const d = dirty(t);
          return (
            <div
              key={t.key}
              data-active={on}
              onClick={() => onActivate(t.key)}
              onAuxClick={(e) => e.button === 1 && onClose(t.key)}
              className={cn(
                'group relative flex max-w-48 min-w-0 flex-none cursor-default items-center gap-1.5 border-r border-[var(--node-border)] pr-1 pl-2',
                on ? 'bg-[var(--node-bg)] text-[var(--node-fg)]' : 'text-[var(--node-muted)] hover:bg-[var(--node-hover)]',
              )}
              title={t.kind === 'request' ? `${name(t)}\n${t.request.url}` : name(t)}
            >
              {on && <span className="absolute inset-x-0 bottom-0 h-0.5 bg-[var(--node-accent)]" />}
              {t.kind === 'request' ? <MethodBadge method={methodOf(t.request)} className="w-auto" /> : <span className="text-[10px] text-[var(--node-muted)]">{t.kind === 'environment' ? 'ENV' : 'SET'}</span>}
              <span className={cn('min-w-0 flex-1 truncate', t.kind === 'request' && !t.collection && 'italic')}>{name(t)}</span>
              <button
                type="button"
                aria-label="Close"
                className="relative flex size-4 flex-none items-center justify-center rounded hover:bg-[var(--node-hover)]"
                onClick={(e) => {
                  e.stopPropagation();
                  onClose(t.key);
                }}
              >
                {d && <span className="size-1.5 rounded-full bg-[var(--node-fg)] group-hover:hidden" />}
                <X className={cn('size-3', d && 'hidden group-hover:block')} />
              </button>
            </div>
          );
        })}
      </div>
      <ToolButton label="New tab" icon={Plus} className="mx-1 self-center" onClick={onNew} />
    </div>
  );
}
