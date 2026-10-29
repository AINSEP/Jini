import { useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import type { PreviewCanvasSize } from '../../types.js';

/**
 * Measures an element's content-box size, re-measuring on resize (via
 * `ResizeObserver` when available) and on the window `resize` event as a
 * fallback. Used to fit a fixed-size viewport preset (tablet/mobile) inside
 * whatever space the host actually gives the preview pane.
 */
export function usePreviewCanvasSize<T extends HTMLElement>(): [RefObject<T | null>, PreviewCanvasSize | undefined] {
  const ref = useRef<T | null>(null);
  const [size, setSize] = useState<PreviewCanvasSize | undefined>(undefined);

  useEffect(() => {
    // No `typeof window === 'undefined'` SSR guard here: a `useEffect` body
    // never runs during server rendering (effects only fire post-mount on
    // the client, where `window` always exists) — a guard here would be
    // dead code, not a real defense. See this package's Phase 9.5
    // dead-branch-gets-refactored-away rule.
    const el = ref.current;
    if (!el) return undefined;
    const measure = () => {
      const rect = el.getBoundingClientRect();
      setSize({ width: rect.width, height: rect.height });
    };
    measure();
    let observer: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(measure);
      observer.observe(el);
    }
    window.addEventListener('resize', measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, []);

  return [ref, size];
}
