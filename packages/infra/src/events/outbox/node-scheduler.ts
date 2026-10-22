import type { Scheduler } from './ports.js';

/**
 * Node host scheduler for outbox delivery and drain timers. Callbacks are always deferred,
 * including zero-delay drains, and timers never keep an otherwise idle process alive.
 * Cancellation is idempotent; this factory starts no timer and owns no background loop.
 * @example const scheduler = createNodeOutboxScheduler({}, {});
 */
export function createNodeOutboxScheduler(
  _required: Record<string, never>, _optional: Record<string, never> = {},
): Scheduler {
  return {
    /** Schedule a deferred callback and return its cancellation handle. */
    schedule({ delayMs, callback }) {
      const timer = setTimeout(callback, delayMs);
      timer.unref();
      return { cancel() { clearTimeout(timer); } };
    },
  };
}
