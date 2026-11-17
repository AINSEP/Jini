/** Time port for one page capture: the work budget, its timers and the hard-stop signal read the same clock,
 * so a test can drive every deadline of a capture from one fake. Defaults to the real functions. */
export interface CaptureClock {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
  /** A signal that aborts with a TimeoutError after `ms` of this clock. */
  deadlineSignal(ms: number): AbortSignal;
}

/** The real clock. Globals are read at call time so fake-timer test setups still apply. */
export const REAL_CAPTURE_CLOCK: CaptureClock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: handle => clearTimeout(handle as ReturnType<typeof setTimeout>),
  deadlineSignal: ms => AbortSignal.timeout(ms),
};
