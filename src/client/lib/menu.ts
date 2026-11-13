// The app's own menu, opened under an element or at a point.

import type { Host } from './hooks.ts';

export interface Option {
  id: string;
  label: string;
  separator?: boolean;
  disabled?: boolean;
  danger?: boolean;
}

/** Opens the app's menu under an element (or at a point): the chosen id. */
export async function menuAt(host: Host, at: HTMLElement | { x: number; y: number }, options: Option[], current?: string): Promise<string | null> {
  const p = at instanceof HTMLElement ? (({ left, bottom }) => ({ x: left, y: bottom + 2 }))(at.getBoundingClientRect()) : at;
  return host.ui.menu(
    p,
    options.map((o) => ({ id: o.id, label: current !== undefined && o.id === current ? `✓ ${o.label}` : o.label, separator: o.separator, disabled: o.disabled, danger: o.danger })),
  );
}
