/**
 * @file The generic outbound webhook delivery loop: every interval it runs one delivery pass
 * (`processDueDeliveries` bound to the host's ports), single flight, and on `stop` it cancels the
 * running pass through an AbortSignal so the in-flight request settles and unattempted claims are
 * released before the host closes its storage. Hosts own where it runs and which ports it binds.
 *
 * Single flight: a tick that finds the previous one still running does nothing, so a slow receiver
 * (up to the per-request total deadline times the batch) never stacks claims on top of each other.
 */

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

const MAX_LOGGED_MESSAGE_CHARS = 200;
/** Bounds the scan of a pathological message before URLs are removed. */
const MAX_SCANNED_MESSAGE_CHARS = 2_000;

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
}

/** The abort reason a running pass sees; recorded as the interrupted attempt's error. */
export class WebhookDeliveryWorkerStoppedError extends Error {
  constructor() {
    super("webhook delivery worker stopped");
    this.name = "AbortError";
  }
}

/**
 * One log line for a failed tick: the error's name, message (URLs removed, length capped) and
 * `code`. Never the error object itself, its `cause`, stack or extra fields: a repo or transport
 * error can carry a receiver URL with credentials, request headers or a payload.
 *
 * @complexity O(message length).
 */
export function describeWebhookTickError(required: { error: unknown }, _optional = {}): string {
  const { error } = required;
  if (!(error instanceof Error)) return `${WEBHOOK_DELIVERY_FAILED_LINE}: a non-Error value was thrown`;
  // Any space-separated word holding "://" is dropped whole (scheme, userinfo, host, query alike).
  const words = error.message.slice(0, MAX_SCANNED_MESSAGE_CHARS).split(" ");
  const message = words.map((word) => (word.includes("://") ? "[url]" : word)).join(" ").slice(0, MAX_LOGGED_MESSAGE_CHARS);
  const code = (error as { code?: unknown }).code;
  const codeSuffix = typeof code === "string" || typeof code === "number" ? ` (code ${code})` : "";
  return `${WEBHOOK_DELIVERY_FAILED_LINE}: ${error.name}: ${message}${codeSuffix}`;
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
  const { intervalMs = WEBHOOK_DELIVERY_INTERVAL_MS, stopGraceMs = WEBHOOK_DELIVERY_STOP_GRACE_MS, scheduler = nodeWebhookDeliveryScheduler, log = (line: string) => console.error(line) } = optional;
  assertPositiveFinite(intervalMs, "intervalMs");
  assertPositiveFinite(stopGraceMs, "stopGraceMs");
  const controller = new AbortController();
  let running: Promise<void> | undefined;

  const tick = (): Promise<void> => {
    if (controller.signal.aborted) return Promise.resolve();
    running ??= required.processDue({ signal: controller.signal }).then(
      () => undefined,
      (error: unknown) => log(describeWebhookTickError({ error })),
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
    if (outcome === "late") log(WEBHOOK_DELIVERY_STOP_LATE_LINE);
  };

  return { tick, stop };
}
