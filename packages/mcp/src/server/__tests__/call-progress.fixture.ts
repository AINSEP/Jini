import type { Logger } from '@jini-ai/core/primitives';

import type { CallProgressScheduler } from '../call-progress.js';

export type Warning = { message: string; error?: unknown };

/** Fake of the scheduler port: time only moves when the test calls `advance`. */
export function createFakeScheduler() {
  const repeating = new Map<number, { callback: () => void; intervalMs: number; nextAt: number }>();
  let now = 0;
  let nextHandle = 1;
  const intervals: number[] = [];
  const scheduler: CallProgressScheduler = {
    repeat: ({ callback, intervalMs }) => {
      const handle = nextHandle++;
      intervals.push(intervalMs);
      repeating.set(handle, { callback, intervalMs, nextAt: now + intervalMs });
      return handle;
    },
    cancel: ({ handle }) => { repeating.delete(handle as number); },
  };
  return {
    scheduler,
    intervals,
    active: () => repeating.size,
    advance: ({ ms }: { ms: number }) => {
      const target = now + ms;
      for (;;) {
        const due = [...repeating.values()].filter(entry => entry.nextAt <= target).sort((a, b) => a.nextAt - b.nextAt)[0];
        if (!due) break;
        now = due.nextAt;
        due.nextAt += due.intervalMs;
        due.callback();
      }
      now = target;
    },
  };
}

export function createFakeLogger() {
  const warnings: Warning[] = [];
  const logger: Logger = {
    info: () => {},
    error: () => {},
    warn: ({ message }, optional = {}) => { warnings.push({ message, ...(optional.error === undefined ? {} : { error: optional.error }) }); },
  };
  return { logger, warnings };
}
