export const FIND_QUERY_SETTLE_MS = 200;
export interface FindQueryClock {
  schedule: (required: { callback: () => void; delay: number }, options?: {}) => unknown;
  cancel: (required: { timer: unknown }, options?: {}) => void;
}
/** Guest searches steal focus asynchronously. Keep keystrokes local until typing settles,
 * instead of issuing a new focus-stealing search for every controlled-input update. */
export function createFindQueryScheduler(
  _required: Record<string, never>,
  { clock = {
    schedule: ({ callback, delay }, _options = {}) => setTimeout(callback, delay),
    cancel: ({ timer }, _options = {}) => clearTimeout(timer as ReturnType<typeof setTimeout>),
  } }: { clock?: FindQueryClock } = {},
) {
  let timer: unknown;
  let pending: (() => void) | null = null;
  const cancel = (_required: Record<string, never> = {}) => {
    if (pending !== null) clock.cancel({ timer });
    pending = null;
  };
  const flush = (_required: Record<string, never> = {}) => {
    const callback = pending;
    cancel();
    callback?.();
    return callback !== null;
  };
  const schedule = ({ run }: { run: () => void }, _optional = {}) => {
    cancel();
    pending = run;
    timer = clock.schedule({ callback: flush, delay: FIND_QUERY_SETTLE_MS });
  };
  return { schedule, cancel, flush };
}
