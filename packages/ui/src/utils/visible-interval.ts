/**
 * @file A repeating timer that only runs while the window is visible.
 *
 * An idle app must not keep working for nobody: a poll that keeps firing while the window is
 * minimized, on another Space, or fully covered wakes the renderer and main (and whatever main does
 * per tick) for a screen no one can see. This stops the timer on `visibilitychange` → hidden and,
 * on → visible, ticks once at once (so a shown window is never a whole period stale) and restarts it.
 *
 * Plain function, not a hook, so it is testable without a DOM.
 */

/** The slice of `document` this reads. */
export interface VisibilitySource {
  readonly visibilityState: "hidden" | "visible";
  addEventListener(type: "visibilitychange", listener: () => void): void;
  removeEventListener(type: "visibilitychange", listener: () => void): void;
}

/** The two timer functions this uses, injectable for tests. */
export interface IntervalTimers {
  setInterval(required: { callback: () => void; ms: number }, optional?: Record<string, never>): unknown;
  clearInterval(required: { handle: unknown }, optional?: Record<string, never>): void;
}

const WINDOW_TIMERS: IntervalTimers = {
  setInterval: ({ callback, ms }, _optional = {}) => globalThis.setInterval(callback, ms),
  clearInterval: ({ handle }, _optional = {}) => globalThis.clearInterval(handle as ReturnType<typeof globalThis.setInterval>),
};

/**
 * Call `tick` every `periodMs` while `doc` is visible. Does not tick at start — the caller does its
 * own first load.
 *
 * @returns a stop function that clears the timer and the listener.
 * @complexity O(1) per visibility change.
 */
export function startVisibleInterval(
  { tick, periodMs }: { tick: () => void; periodMs: number }, { doc = (globalThis as unknown as { document: VisibilitySource }).document, timers = WINDOW_TIMERS }: { doc?: VisibilitySource; timers?: IntervalTimers } = {},
): () => void {
  let handle: unknown = null;
  const run = () => {
    if (handle === null) handle = timers.setInterval({ callback: tick, ms: periodMs });
  };
  const halt = () => {
    if (handle !== null) timers.clearInterval({ handle });
    handle = null;
  };
  const onVisibility = () => {
    if (doc.visibilityState === "hidden") { halt(); return; }
    if (handle !== null) return;
    tick();
    run();
  };

  if (doc.visibilityState !== "hidden") run();
  doc.addEventListener("visibilitychange", onVisibility);
  return () => {
    halt();
    doc.removeEventListener("visibilitychange", onVisibility);
  };
}
