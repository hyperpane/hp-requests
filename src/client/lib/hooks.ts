// The window's hooks: a setting kept in this browser, an element's width,
// a pointer drag, a list that follows its end, and saving soon after the
// last change.

import { useEffect, useRef, useState } from 'react';
import { useHost } from '@hyperpane/sdk/client';

export type Host = ReturnType<typeof useHost>;

/** A per-viewer setting kept in this browser (it may not be kept). */
export function useKept<T>(key: string, initial: T): [T, (v: T | ((old: T) => T)) => void] {
  const [v, setV] = useState<T>(() => read(key, initial));
  const last = useRef(key);
  useEffect(() => {
    if (last.current !== key) {
      last.current = key;
      setV(read(key, initial));
    }
  }, [key]);
  return [
    v,
    (next) => {
      setV((old) => {
        const value = typeof next === 'function' ? (next as (o: T) => T)(old) : next;
        try {
          localStorage.setItem(key, JSON.stringify(value));
        } catch {}
        return value;
      });
    },
  ];
}

export function read<T>(key: string, initial: T): T {
  try {
    const s = localStorage.getItem(key);
    return s === null ? initial : (JSON.parse(s) as T);
  } catch {
    return initial;
  }
}

/** An element's width, as it changes. */
export function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}

/** Follows a pointer drag from a handle: `move` gets how far it went. */
export function dragFrom(e: React.PointerEvent<HTMLElement>, move: (dx: number, dy: number) => void) {
  const x = e.clientX;
  const y = e.clientY;
  const el = e.currentTarget;
  el.setPointerCapture(e.pointerId);
  const onMove = (ev: PointerEvent) => move(ev.clientX - x, ev.clientY - y);
  const up = () => {
    el.removeEventListener('pointermove', onMove);
    el.removeEventListener('pointerup', up);
  };
  el.addEventListener('pointermove', onMove);
  el.addEventListener('pointerup', up);
}

/** Keeps a list scrolled to its end while it's there; scrolled up, it
 * stays put and says there's more. */
export function useFollow(dep: unknown) {
  const ref = useRef<HTMLDivElement>(null);
  const [follow, setFollow] = useState(true);
  useEffect(() => {
    if (follow && ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [dep, follow]);
  return {
    ref,
    follow,
    onScroll: (e: React.UIEvent<HTMLDivElement>) => {
      const el = e.currentTarget;
      setFollow(el.scrollTop + el.clientHeight >= el.scrollHeight - 12);
    },
    toEnd: () => {
      setFollow(true);
      if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
    },
  };
}

/** Saves a little after the last change, so typing isn't a write a key. */
export function useSoon<T>(value: T, save: (v: T) => void, ms = 500) {
  const first = useRef(true);
  const fn = useRef(save);
  fn.current = save;
  const key = JSON.stringify(value);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const t = setTimeout(() => fn.current(value), ms);
    return () => clearTimeout(t);
  }, [key]);
}
