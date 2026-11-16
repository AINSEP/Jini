import type { Clock } from '@jini-ai/core/primitives';
import type { QueryCacheSchedulerPort } from '@jini-ai/core/fetch';

/** Browser timer adapter for the query cache; hosts inject their own where timers must be controlled. */
export const browserScheduler: QueryCacheSchedulerPort = {
  schedule: ({ callback, delayMs }) => setTimeout(callback, delayMs),
  cancel: ({ handle }) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/** Browser wall clock for freshness decisions. */
export const browserClock: Clock = { nowMs: () => Date.now() };
