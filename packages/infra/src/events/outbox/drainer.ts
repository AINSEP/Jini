import type { Empty, EventEnvelope, OutboxWorkerArgs, OutboxWorkerOptions, ScheduledTask, Scheduler } from './ports.js';
import { DEFAULT_OUTBOX_DRAIN_INTERVAL_MS, resolvePolicy } from './policy.js';
import { processOutbox } from './worker.js';

export interface OutboxDrainer {
  /** Stops scheduling drains, then resolves once a drain already running has settled. Idempotent. */
  stop(): Promise<void>;
}

/** An inert, independently owned serial loop. Stopping is terminal, even before the first start. */
export interface SerialPump {
  /** Idempotent while running; schedules the first callback after the configured interval. */
  start(input: Empty, options?: Empty): void;
  /**
   * Cancel queued work and await the entire active callback, including its rejection. Idempotent.
   * A callback may call stop but must not await it: stop awaits that same callback and would hang.
   */
  stop(input: Empty, options?: Empty): Promise<void>;
}

/**
 * One lifecycle owner for both scheduling contracts. Delay selection belongs to the caller:
 * legacy drains accelerate full batches; the independent pump always waits its fixed interval.
 */
function createSchedulingLoop<Result>(input: {
  scheduler: Scheduler; firstDelayMs: number; callback: () => Promise<Result>;
  nextDelayMs: (result: Result | undefined) => number; onError: (error: unknown) => void;
}): SerialPump {
  let started = false;
  let stopped = false;
  let generation = 0;
  let timer: ScheduledTask | undefined;
  let inFlight: Promise<void> = Promise.resolve();
  /** Schedule only after settlement; generation also rejects a stale queued callback. */
  const schedule = (delayMs: number): void => {
    if (stopped) return;
    const ticket = ++generation;
    timer = input.scheduler.schedule({ delayMs, callback: () => {
      // Cancellation can race an already queued callback in a host scheduler.
      if (stopped || ticket !== generation) return;
      ++generation;
      // Publish the whole flight before invoking host code, so a reentrant stop observes it.
      inFlight = Promise.resolve().then(run);
    } });
  };
  /** Report failure in isolation, then select the next delay after the complete callback settles. */
  const run = async (): Promise<void> => {
    let result: Result | undefined;
    try { result = await input.callback(); }
    catch (error) {
      try { input.onError(error); } catch {
        // The loop must outlive a reporter that throws; the drain error itself is already lost to it.
      }
    }
    schedule(input.nextDelayMs(result));
  };
  return {
    start(_input: Empty, _options: Empty = {}) {
      if (started || stopped) return;
      started = true;
      schedule(input.firstDelayMs);
    },
    async stop(_input: Empty, _options: Empty = {}) {
      if (!stopped) { stopped = true; timer?.cancel(); }
      await inFlight;
    },
  };
}

/**
 * Construct an inert pump with no outbox dependency. First and subsequent callbacks wait the full
 * interval; results never accelerate scheduling. stop is terminal and awaits the entire callback.
 *
 * @param input Deferred scheduler, positive integer interval and asynchronous callback.
 * @param options Optional isolated error reporter; a throwing reporter cannot end the loop.
 * @returns Independent lifecycle with idempotent start/stop methods.
 * @throws RangeError if intervalMs is not a positive safe integer, before any work is scheduled.
 * @example const pump = createSerialPump({ scheduler, intervalMs: 1000, callback: async () => drain() }); pump.start({});
 * @complexity O(1) state and one queued task per instance, beyond the host callback.
 */
export function createSerialPump(
  input: { scheduler: Scheduler; intervalMs: number; callback(input: Empty, options?: Empty): Promise<unknown> },
  options: { onError?(input: { error: unknown }, options?: Empty): void } = {},
): SerialPump {
  if (!Number.isSafeInteger(input.intervalMs) || input.intervalMs < 1) throw new RangeError('serial pump intervalMs must be a positive integer');
  return createSchedulingLoop({ scheduler: input.scheduler, firstDelayMs: input.intervalMs,
    callback: () => input.callback({}, {}), nextDelayMs: () => input.intervalMs,
    onError: error => options.onError?.({ error }, {}) });
}

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
  const onError = optional.onError ?? ((error: unknown) => required.logger.error({
    message: '[outbox-drainer] drain failed; retrying after the idle interval',
  }, { error }));
  const loop = createSchedulingLoop({ scheduler: required.scheduler, firstDelayMs: 0,
    callback: () => processOutbox(required, policy),
    nextDelayMs: claimed => (claimed ?? 0) >= policy.batchSize ? 0 : intervalMs, onError });
  loop.start({});
  return { stop: () => loop.stop({}) };
}
