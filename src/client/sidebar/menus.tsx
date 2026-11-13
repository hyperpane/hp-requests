// What the sidebar does (the window gives it), and its menus: New, and each
// collection's, folder's and request's.

import { MoreHorizontal } from 'lucide-react';
import type { Collection, HistoryEntry, Item } from '../../shared/index.ts';
import type { Option } from '../lib/menu.ts';

export interface SidebarOps {
  open(item: Item, collection: Collection, folder: string | null): void;
  openHistory(h: HistoryEntry): void;
  /** An action from a row's menu. */
  act(action: string, collection: Collection, item: Item | null): void;
  create(what: string): void;
  clearHistory(): void;
  removeHistory(id: string): void;
  environment(action: string): void;
}

export const NEW_MENU: Option[] = [
  { id: 'http', label: 'New HTTP request' },
  { id: 'ws', label: 'New WebSocket' },
  { id: 'sse', label: 'New event stream (SSE)' },
  { id: '-', label: '', separator: true },
  { id: 'collection', label: 'New collection' },
  { id: 'import', label: 'Import cURL or Postman…' },
];

export const itemMenu = (item: Item | null): Option[] => {
  if (!item || item.type === 'folder')
    return [
      { id: 'newHttp', label: 'New request' },
      { id: 'newWs', label: 'New WebSocket' },
      { id: 'newSse', label: 'New event stream' },
      { id: 'newFolder', label: 'New folder' },
      { id: '-', label: '', separator: true },
      { id: 'settings', label: item ? 'Folder auth…' : 'Variables and auth…' },
      { id: 'rename', label: 'Rename…' },
      { id: 'duplicate', label: 'Duplicate' },
      ...(item ? [] : [{ id: 'export', label: 'Export as Postman…' }]),
      { id: '-2', label: '', separator: true },
      { id: 'delete', label: 'Delete…', danger: true },
    ];
  return [
    { id: 'open', label: 'Open' },
    ...(item.type !== 'ws' ? [{ id: 'curl', label: 'Copy as cURL' }] : []),
    { id: '-', label: '', separator: true },
    { id: 'rename', label: 'Rename…' },
    { id: 'duplicate', label: 'Duplicate' },
    { id: '-2', label: '', separator: true },
    { id: 'delete', label: 'Delete…', danger: true },
  ];
};

export function MoreButton({ onClick }: { onClick(e: React.MouseEvent): void }) {
  return (
    <button
      type="button"
      aria-label="More"
      className="flex size-5 flex-none items-center justify-center rounded text-[var(--node-muted)] opacity-0 group-hover:opacity-100 hover:bg-[var(--node-hover)] hover:text-[var(--node-fg)] focus-visible:opacity-100"
      onClick={(e) => {
        e.stopPropagation();
        onClick(e);
      }}
    >
      <MoreHorizontal className="size-3.5" />
    </button>
  );
}
