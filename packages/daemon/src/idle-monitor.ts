import type { Clock } from '@jini-ai/core/primitives';
import type { SchedulerPort } from './scheduler.js';

/** A one-shot observation lifecycle; stopping permanently cancels further observations. */
export interface IdleMonitor {
  /** Idempotent; callbacks queued before cancellation become harmless. */
  stop(): void;
}

/**
 * Observe host busy state immediately, scheduling polls at most 1s ahead; fire once after a full
 * observed idle interval. Busy observations discard idle credit; the next idle
 * observation starts a new interval. Activity between observations is not tracked.
 * @param input Injected synchronous busy predicate, finite positive idleMs, clock and scheduler.
 * @param options onIdle runs synchronously after the monitor has stopped; its errors propagate.
 * @returns A permanent, idempotent stop handle. Owns at most one scheduled callback.
 * @throws RangeError for a non-positive or non-finite idleMs, before scheduling.
 * @complexity O(1) time per observation and O(1) retained space.
 * @example createIdleMonitor({ isBusy, idleMs: 900_000, clock, scheduler }, { onIdle });
 */
export function createIdleMonitor(
  { isBusy, idleMs, clock, scheduler }: {
    readonly isBusy: () => boolean;
    readonly idleMs: number;
    readonly clock: Clock;
    readonly scheduler: SchedulerPort;
  },
  { onIdle }: { readonly onIdle: () => void },
): IdleMonitor {
  if (!Number.isFinite(idleMs) || idleMs <= 0) {
    throw new RangeError('idleMs must be finite and positive');
  }
  let stopped = false;
  let idleSince: number | undefined;
  let cancelPending: (() => void) | undefined;

  const stop = (): void => {
    stopped = true;
    cancelPending?.();
    cancelPending = undefined;
  };

  // The host owns parking; this callback only observes state and reports idle.
  const observe = (): void => {
    if (stopped) return;
    const now = clock.nowMs();
    if (isBusy()) idleSince = undefined;
    else idleSince ??= now;
    const remainingMs = idleSince === undefined ? idleMs : idleMs - (now - idleSince);
    if (remainingMs <= 0) {
      stop();
      onIdle();
      return;
    }
    cancelPending = scheduler.schedule({ delayMs: Math.min(1_000, remainingMs), callback: observe });
  };

  observe();
  return { stop };
}
