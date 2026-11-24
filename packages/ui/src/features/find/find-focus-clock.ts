import type { FindQueryClock } from './find-query-scheduler.js';

/**
 * The timing slice the find hooks drive: the clock their focus-reclaim window is measured on, the
 * animation frames their per-frame reclaim runs on, and the timers behind both the deferred blur
 * reclaim and the typing-settle scheduler. Injected so a test can step every one of them by hand;
 * {@link liveFindClock} is the real browser wiring.
 */
export interface FindFocusClock extends FindQueryClock {
  now: () => number;
  requestFrame: (input: { callback: () => void }) => number;
  cancelFrame: (input: { frame: number }) => void;
}

/** The window's own `performance`, animation-frame and timer functions. @complexity O(1). */
export const liveFindClock: FindFocusClock = {
  now: () => performance.now(),
  requestFrame: ({ callback }) => requestAnimationFrame(callback),
  cancelFrame: ({ frame }) => cancelAnimationFrame(frame),
  schedule: ({ callback, delay }, _options = {}) => setTimeout(callback, delay),
  cancel: ({ timer }, _options = {}) => clearTimeout(timer as ReturnType<typeof setTimeout>),
};
