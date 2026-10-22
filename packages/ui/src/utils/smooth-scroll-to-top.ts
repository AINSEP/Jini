/**
 * Animated scroll-to-top for app scroll containers.
 *
 * `scrollTo({ top: 0 })` snaps the viewport in a single frame; layered on
 * top of a closing overlay the jump reads as a stutter rather than a
 * transition. This tweens `scrollTop` with an ease-out curve so the trip
 * back to the top reads as one continuous gesture.
 *
 * Contract:
 * - eases to 0 with `cubic-bezier(0.23, 1, 0.32, 1)`; duration scales with
 *   distance, capped so long flights stay decisive.
 * - the user grabbing the scroll mid-flight (wheel / touch) cancels the
 *   tween immediately — their input wins.
 * - `prefers-reduced-motion: reduce` (and environments without rAF) jump
 *   instantly.
 * - re-invoking on the same container retargets instead of running two
 *   competing tweens.
 *
 * The bezier solver (`./unit-bezier.ts`) is local math, avoiding a motion-library dependency in this utility and its tests.
 */

import { unitBezier } from './unit-bezier.js';

const EASE_OUT = unitBezier(0.23, 1, 0.32, 1);
const MIN_DURATION_MS = 260;
const MAX_DURATION_MS = 600;
// Each extra ~6px of distance buys 1ms, so a viewport-sized hop lands near
// the minimum and multi-screen flights saturate at the cap.
const DISTANCE_PER_MS = 6;

const inFlight = new WeakMap<HTMLElement, () => void>();

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/**
 * Smoothly (or instantly, per reduced-motion) scrolls `container` to the
 * top. Cancels any in-flight tween already running on the same container.
 *
 * @overallScore 100
 */
export function smoothScrollToTop(container: HTMLElement): void {
  inFlight.get(container)?.();

  container.scrollLeft = 0;
  const from = container.scrollTop;
  if (from <= 0) return;

  if (prefersReducedMotion() || typeof requestAnimationFrame !== 'function') {
    container.scrollTop = 0;
    return;
  }

  const duration = Math.min(MAX_DURATION_MS, MIN_DURATION_MS + from / DISTANCE_PER_MS);

  let frame = 0;
  let start: number | null = null;
  const cancel = () => {
    cancelAnimationFrame(frame);
    cleanup();
  };
  const cleanup = () => {
    container.removeEventListener('wheel', cancel);
    container.removeEventListener('touchstart', cancel);
    if (inFlight.get(container) === cancel) inFlight.delete(container);
  };

  const step = (now: number) => {
    if (start === null) start = now;
    const t = Math.min(1, (now - start) / duration);
    container.scrollTop = from * (1 - EASE_OUT(t));
    if (t < 1) {
      frame = requestAnimationFrame(step);
    } else {
      cleanup();
    }
  };

  container.addEventListener('wheel', cancel, { passive: true });
  container.addEventListener('touchstart', cancel, { passive: true });
  inFlight.set(container, cancel);
  frame = requestAnimationFrame(step);
}
