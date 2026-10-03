import type { EventEnvelope, OutboxWorkerArgs, OutboxWorkerOptions, ScheduledTask } from './ports.js';
import { DEFAULT_OUTBOX_DRAIN_INTERVAL_MS, resolvePolicy } from './policy.js';
import { processOutbox } from './worker.js';

export interface OutboxDrainer { stop(): Promise<void> }

/** Schedule only after each drain settles. stop waits for the current bounded drain, not late handlers.
 *
 * Before 2026-09-14, only inline route drains delivered rows. Commands that merely enqueued
 * events left them waiting until an unrelated write drained the queue. Start this loop only in
 * the process whose bus carries the real handlers, and only after they are subscribed. A drain
 * elsewhere can mark a row delivered without executing its intended effects (see enqueue-only).
 * One drain runs at a time: a full batch reschedules at once, otherwise the one-second default
 * idle interval bounds event latency. Bounded per-row delivery prevents a hung handler stalling
 * the loop. Retry/backoff/terminal policy stays in processOutbox, so failure of one row does not
 * prevent later rows from flowing. Drain errors, including database locking, go to onError and
 * retry after the idle interval; a throwing reporter cannot terminate the loop.
 * Inline drains remain safe alongside this loop because claims are atomic. Claim leases recover
 * after dead or overrunning claimers, so delivery is still at least once, requiring idempotent effects.
 * Scheduler callbacks defer even for zero delay; host Node timers must be unref-ed so this loop
 * never keeps the process alive by itself. stop is idempotent, cancels future scheduling and waits
 * for the bounded in-flight drain, while late handlers remain observed independently.
 * @complexity O(batchSize) publish attempts per drain; O(1) state between drains. */
export function startOutboxDrainer<Event extends EventEnvelope>(
  required: OutboxWorkerArgs<Event>,
  optional: OutboxWorkerOptions & { intervalMs?: number; onError?: (error: unknown) => void } = {},
): OutboxDrainer {
  const policy = resolvePolicy({ options: optional });
  const intervalMs = optional.intervalMs ?? DEFAULT_OUTBOX_DRAIN_INTERVAL_MS;
  if (!Number.isSafeInteger(intervalMs) || intervalMs < 0) throw new RangeError('outbox intervalMs must be a nonnegative integer');
  let stopped = false;
  let timer: ScheduledTask | undefined;
  let inFlight: Promise<void> = Promise.resolve();
  const onError = optional.onError ?? ((error: unknown) => required.logger.error({
    message: '[outbox-drainer] drain failed; retrying after the idle interval',
  }, { error }));
  const schedule = (delayMs: number): void => {
    if (stopped) return;
    timer = required.scheduler.schedule({ delayMs, callback: () => {
      // Cancellation can race an already queued callback in a host scheduler.
      if (!stopped) inFlight = drain();
    } });
  };
  const drain = async (): Promise<void> => {
    let claimed = 0;
    try { claimed = await processOutbox(required, policy); }
    catch (error) { try { onError(error); } catch { /* Keep draining despite a broken reporter. */ } }
    schedule(claimed >= policy.batchSize ? 0 : intervalMs);
  };
  schedule(0);
  return { async stop() { stopped = true; timer?.cancel(); await inFlight; } };
}
