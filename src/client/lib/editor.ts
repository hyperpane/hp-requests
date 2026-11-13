// What an open request's editor is given, and the keys the editors share.

import { useEffect, useRef } from 'react';
import type { Auth, Context } from '../../shared/index.ts';
import { Live } from './live.ts';

export interface EditorProps<R> {
  tabKey: string;
  request: R;
  onChange(r: R): void;
  onSave(): void;
  dirty: boolean;
  live: Live;
  project: string | null;
  context: Context;
  vars: Map<string, string>;
  /** Where inherited auth comes from ("Shop › Users"), or null outside a
   * collection. */
  inheritFrom: { name: string; auth: Auth } | null;
}

/** Keys the editors share: ⌘/Ctrl+Enter, ⌘/Ctrl+S. */
export function useKeys(onSend: () => void, onSave: () => void) {
  const fns = useRef({ onSend, onSave });
  fns.current = { onSend, onSave };
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
      if (e.key === 'Enter') {
        e.preventDefault();
        fns.current.onSend();
      } else if (e.key.toLowerCase() === 's' && !e.shiftKey) {
        e.preventDefault();
        fns.current.onSave();
      }
    };
    window.addEventListener('keydown', down);
    return () => window.removeEventListener('keydown', down);
  }, []);
}
