// Edge hover/click auto-scroll for a horizontally-overflowing rail.
//
// A horizontally-scrolling rail is reachable by trackpad swipe, but a plain
// mouse (no trackpad, no shift+wheel habit) has no easy way to scroll it.
// This hook drives two edge zones: hover one to glide continuously, or click
// it to jump. Pair with `EdgeScrollZones` for the rendered overlay, or wire
// the returned handlers to your own UI.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';

const STEP_PX = 9; // per-frame hover-glide speed
const NUDGE_PX = 332; // click jump (~2 small cards / one large card + gap)

export interface EdgeAutoScroll {
  scrollRef: RefObject<HTMLDivElement | null>;
  edges: { left: boolean; right: boolean };
  startAutoScroll: (direction: 1 | -1) => void;
  stopAutoScroll: () => void;
  nudge: (direction: 1 | -1) => void;
}

/**
 * Wire a horizontally-scrolling element (assign `scrollRef` to it) with
 * edge-driven auto-scroll. `contentKey` should change whenever the item count
 * changes so the reachable-edge state is re-measured.
 */
export function useEdgeAutoScroll(contentKey?: unknown): EdgeAutoScroll {
  const scrollRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number | null>(null);
  const [edges, setEdges] = useState<{ left: boolean; right: boolean }>({
    left: false,
    right: false,
  });

  const stopAutoScroll = useCallback(() => {
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  const startAutoScroll = useCallback(
    (direction: 1 | -1) => {
      stopAutoScroll();
      const step = () => {
        const el = scrollRef.current;
        if (!el) return;
        const maxScroll = el.scrollWidth - el.clientWidth;
        el.scrollLeft += direction * STEP_PX;
        const reachedEnd =
          direction < 0 ? el.scrollLeft <= 0 : el.scrollLeft >= maxScroll;
        if (reachedEnd) {
          stopAutoScroll();
          return;
        }
        rafRef.current = requestAnimationFrame(step);
      };
      rafRef.current = requestAnimationFrame(step);
    },
    [stopAutoScroll],
  );

  const nudge = useCallback((direction: 1 | -1) => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollBy({ left: direction * NUDGE_PX, behavior: 'smooth' });
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return undefined;
    const updateEdges = () => {
      const maxScroll = el.scrollWidth - el.clientWidth;
      setEdges({
        left: el.scrollLeft > 1,
        right: el.scrollLeft < maxScroll - 1,
      });
    };
    updateEdges();
    el.addEventListener('scroll', updateEdges, { passive: true });
    // ResizeObserver is absent in jsdom; the scroll listener still keeps edges
    // fresh, so observing the viewport is a best-effort extra.
    const observer =
      typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(updateEdges)
        : null;
    observer?.observe(el);
    return () => {
      el.removeEventListener('scroll', updateEdges);
      observer?.disconnect();
    };
  }, [contentKey]);

  // Cancel any in-flight glide when the rail unmounts.
  useEffect(() => stopAutoScroll, [stopAutoScroll]);

  return { scrollRef, edges, startAutoScroll, stopAutoScroll, nudge };
}
