/**
 * @file The generic outbound webhook delivery loop: every interval it runs one delivery pass
 * (`processDueDeliveries` bound to the host's ports), single flight, and on `stop` it cancels the
 * running pass through an AbortSignal so the in-flight request settles and unattempted claims are
 * released before the host closes its storage. Hosts own where it runs and which ports it binds.
 *
 * Single flight: a tick that finds the previous one still running does nothing, so a slow receiver
 * (up to the per-request total deadline times the batch) never stacks claims on top of each other.
 */

import { describeErrorForLog } from "@jini-ai/core";
import { createConsoleLogger, type Logger } from '@jini-ai/core/primitives';

/** Idle wait between ticks. Short enough that a delivery leaves within seconds, long enough that
 * an idle site costs one indexed `SELECT` per interval. */
export const WEBHOOK_DELIVERY_INTERVAL_MS = 15_000;

/**
 * How long `stop` waits for the cancelled pass to settle. Cancellation makes the in-flight request
 * reject at once, so what remains is a few storage writes; a pass still running after the grace is
 * abandoned, not awaited, and its claims are recovered by their lease.
 */
export const WEBHOOK_DELIVERY_STOP_GRACE_MS = 1_000;

/** Prefix of the one line logged for a failed tick; the loop keeps running after it. */
export const WEBHOOK_DELIVERY_FAILED_LINE = "[webhooks] delivery tick failed; retrying after the interval";

/** Logged when `stop` gives up waiting on a running tick. */
export const WEBHOOK_DELIVERY_STOP_LATE_LINE = "[webhooks] a delivery tick was still running at shutdown; it was abandoned";


/** A cancellable timer. The default implementation never keeps the process alive. */
export interface WebhookDeliveryTimer {
  cancel(): void;
}

/** Timer port, injected so tests drive ticks with a fake clock. */
export interface WebhookDeliveryScheduler {
  every(required: { ms: number; run: () => void }): WebhookDeliveryTimer;
  after(required: { ms: number; run: () => void }): WebhookDeliveryTimer;
}

/** Node timers, unref'd: like the outbox drainer's, the loop must never hold a stopping process open. */
export const nodeWebhookDeliveryScheduler: WebhookDeliveryScheduler = {
  every: ({ ms, run }) => {
    const handle = setInterval(run, ms);
    handle.unref();
    return { cancel: () => clearInterval(handle) };
  },
  after: ({ ms, run }) => {
    const handle = setTimeout(run, ms);
    handle.unref();
    return { cancel: () => clearTimeout(handle) };
  },
};

export interface WebhookDeliveryWorker {
  /** Runs one tick now, unless one is already running (then resolves with that one). Never rejects. */
  tick(): Promise<void>;
  /** Stops scheduling ticks, cancels a running one and waits up to the stop grace for it. Idempotent. */
  stop(): Promise<void>;
}

export interface WebhookDeliveryWorkerRequired {
  /** One delivery pass. `signal` aborts when the worker stops; pass it to `processDueDeliveries`. */
  processDue: (required: { signal: AbortSignal }) => Promise<unknown>;
}

export interface WebhookDeliveryWorkerOptional {
  intervalMs?: number;
  /** How long `stop` waits for the cancelled pass; default {@link WEBHOOK_DELIVERY_STOP_GRACE_MS}. */
  stopGraceMs?: number;
  scheduler?: WebhookDeliveryScheduler;
  log?: (line: string) => void;
  report?: Pick<Logger, 'error' | 'warn'>;
}

/** The abort reason a running pass sees; recorded as the interrupted attempt's error. */
export class WebhookDeliveryWorkerStoppedError extends Error {
  constructor() {
    super("webhook delivery worker stopped");
    this.name = "AbortError";
  }
}

/**
 * One log line for a failed tick: fixed words plus the error's class and an approved code
 * (`describeErrorForLog`). Never the message, the error object itself, its `cause` text, stack or
 * extra fields: a repo or transport error can carry a receiver URL with credentials, request
 * headers or a payload.
 *
 * @complexity O(1).
 */
export function describeWebhookTickError(required: { error: unknown }, _optional = {}): string {
  return `${WEBHOOK_DELIVERY_FAILED_LINE}: ${describeErrorForLog({ err: required.error })}`;
}

function assertPositiveFinite(value: number, name: string): void {
  if (!(Number.isFinite(value) && value > 0)) throw new RangeError(`webhook delivery ${name} must be a positive finite number`);
}

/**
 * Starts the loop. The first tick runs one interval after start.
 *
 * @param required.processDue one delivery pass, given the worker's stop signal.
 * @param optional.intervalMs idle wait between ticks; default {@link WEBHOOK_DELIVERY_INTERVAL_MS}.
 * @throws RangeError when `intervalMs` or `stopGraceMs` is not a positive finite number.
 * @example const worker = startWebhookDeliveryWorker({ processDue: ({ signal }) => processDueDeliveries({ deps }, { signal }) }); await worker.stop();
 * @complexity O(1) per tick, beyond `processDue`.
 */
export function startWebhookDeliveryWorker(
  required: WebhookDeliveryWorkerRequired,
  optional: WebhookDeliveryWorkerOptional = {},
): WebhookDeliveryWorker {
  const { intervalMs = WEBHOOK_DELIVERY_INTERVAL_MS, stopGraceMs = WEBHOOK_DELIVERY_STOP_GRACE_MS, scheduler = nodeWebhookDeliveryScheduler, log, report = createConsoleLogger({ prefix: '' }) } = optional;
  const logger = report;
  assertPositiveFinite(intervalMs, "intervalMs");
  assertPositiveFinite(stopGraceMs, "stopGraceMs");
  const controller = new AbortController();
  let running: Promise<void> | undefined;

  const tick = (): Promise<void> => {
    if (controller.signal.aborted) return Promise.resolve();
    running ??= required.processDue({ signal: controller.signal }).then(
      () => undefined,
      (error: unknown) => {
        if (log) log(describeWebhookTickError({ error }));
        else logger.error({ message: WEBHOOK_DELIVERY_FAILED_LINE }, { error });
      },
    ).finally(() => { running = undefined; });
    return running;
  };

  const timer = scheduler.every({ ms: intervalMs, run: () => { void tick(); } });

  const stop = async (): Promise<void> => {
    if (!controller.signal.aborted) controller.abort(new WebhookDeliveryWorkerStoppedError());
    timer.cancel();
    if (running === undefined) return;
    let grace!: WebhookDeliveryTimer;
    const late = new Promise<"late">((resolve) => { grace = scheduler.after({ ms: stopGraceMs, run: () => resolve("late") }); });
    const outcome = await Promise.race([running, late]);
    grace.cancel();
    if (outcome === "late") {
      if (log) log(WEBHOOK_DELIVERY_STOP_LATE_LINE);
      else logger.warn({ message: WEBHOOK_DELIVERY_STOP_LATE_LINE });
    }
  };

  return { tick, stop };
}
