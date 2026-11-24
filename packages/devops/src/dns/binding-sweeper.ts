/**
 * @file The due-bindings loop: every {@link DOMAIN_BINDING_SWEEP_INTERVAL_MS} it runs the host's
 * pre-bound due-bindings sweep once, which re-checks a bounded batch of saved domain bindings whose
 * next check time has passed (30 s doubling to 10 min, 48 h cap — `nextCheckDelayMs` in `./verify.ts`).
 *
 * Why it exists: a one-shot verify checks once and schedules the next check, but until this loop
 * nothing ran the schedule, so a binding stayed `pending` until someone asked again.
 *
 * Only the host's serving process should start it, for the webhook loop's reason: that is the one
 * process pair that serves a site, and a DNS sweep from an exporter or an agent daemon would write a
 * site's tracking state from a process nobody is watching. A root without the pre-bound sweep (a
 * hermetic test root, or one with no content database) gets an idle handle: off by injection.
 *
 * Mirrors the webhook delivery worker: unref'd timers (the injected scheduler), single flight (a tick
 * that finds the previous one running does nothing — a slow nameserver never stacks sweeps), a failed
 * sweep is logged and retried next interval, never thrown, and `stop` waits a short grace.
 */
/** Idle wait between sweeps. The shortest backoff step is 30 s, so a minute keeps a check at most
 * one interval late while an idle site costs one indexed `SELECT` per minute. */
export const DOMAIN_BINDING_SWEEP_INTERVAL_MS = 60_000;

/** Bindings re-checked per sweep, oldest due first; the rest wait for the next interval. */
export const DOMAIN_BINDING_SWEEP_LIMIT = 10;

/** How long `stop` waits for a running sweep; shares the 4 s shutdown budget with the other loops. */
export const DOMAIN_BINDING_SWEEP_STOP_GRACE_MS = 1_000;

export const DOMAIN_BINDING_SWEEP_FAILED_LINE = '[domain-dns] due-bindings sweep failed; retrying after the interval';
export const DOMAIN_BINDING_SWEEP_STOP_LATE_LINE = '[domain-dns] a due-bindings sweep was still running at shutdown; it was abandoned';

const MAX_LOGGED_MESSAGE_CHARS = 200;

/** A cancellable timer. The host's implementation should never keep the process alive. */
export interface DomainBindingSweepTimer {
  cancel(): void;
}

/** Timer port (structurally the webhook delivery worker's), injected so tests drive ticks with a fake clock. */
export interface DomainBindingSweepScheduler {
  every(required: { ms: number; run: () => void }): DomainBindingSweepTimer;
  after(required: { ms: number; run: () => void }): DomainBindingSweepTimer;
}

export interface DomainBindingSweeper {
  /** Runs one sweep now, unless one is already running (then resolves with that one). Never rejects. */
  tick(): Promise<void>;
  /** Stops scheduling sweeps and waits up to {@link DOMAIN_BINDING_SWEEP_STOP_GRACE_MS} for a running one. Idempotent. */
  stop(): Promise<void>;
}

export interface DomainBindingSweeperOptional {
  intervalMs?: number;
  limit?: number;
  log?: (line: string) => void;
}

/** One log line: the error's name and capped message, never the object (no stack or extra fields). */
function describeSweepError({ error }: { error: unknown }, _optional = {}): string {
  if (!(error instanceof Error)) return `${DOMAIN_BINDING_SWEEP_FAILED_LINE}: a non-Error value was thrown`;
  return `${DOMAIN_BINDING_SWEEP_FAILED_LINE}: ${error.name}: ${error.message.slice(0, MAX_LOGGED_MESSAGE_CHARS)}`;
}

const IDLE: DomainBindingSweeper = { tick: async () => {}, stop: async () => {} };

/**
 * Starts the loop over the pre-bound sweep; the first sweep runs one interval after start.
 *
 * @param required.sweep the host's pre-bound due-bindings sweep; absent → an idle handle, no timer.
 * @param required.scheduler the host's (unref'd) timer port.
 * @param optional.intervalMs idle wait between sweeps; default {@link DOMAIN_BINDING_SWEEP_INTERVAL_MS}.
 * @throws RangeError when `intervalMs` is not a positive finite number.
 * @example const sweeper = startDomainBindingSweeper({ sweep: verifyDue, scheduler }); await sweeper.stop();
 * @complexity O(1) per tick, beyond the sweep's own O(limit · records · nameservers) DNS reads.
 */
export function startDomainBindingSweeper(
  required: { sweep: ((required: { limit: number }) => Promise<string[]>) | undefined; scheduler: DomainBindingSweepScheduler },
  optional: DomainBindingSweeperOptional = {},
): DomainBindingSweeper {
  const { sweep, scheduler } = required;
  if (sweep === undefined) return IDLE;
  const { intervalMs = DOMAIN_BINDING_SWEEP_INTERVAL_MS, limit = DOMAIN_BINDING_SWEEP_LIMIT, log = (line: string) => console.error(line) } = optional;
  if (!(Number.isFinite(intervalMs) && intervalMs > 0)) throw new RangeError('domain binding sweep intervalMs must be a positive finite number');
  let running: Promise<void> | undefined;
  let stopped = false;

  const tick = (): Promise<void> => {
    if (stopped) return Promise.resolve();
    running ??= sweep({ limit }).then(() => undefined, (error: unknown) => log(describeSweepError({ error }))).finally(() => { running = undefined; });
    return running;
  };

  const timer = scheduler.every({ ms: intervalMs, run: () => { void tick(); } });

  const stop = async (): Promise<void> => {
    stopped = true;
    timer.cancel();
    if (running === undefined) return;
    let grace!: DomainBindingSweepTimer;
    const late = new Promise<'late'>((resolve) => { grace = scheduler.after({ ms: DOMAIN_BINDING_SWEEP_STOP_GRACE_MS, run: () => resolve('late') }); });
    const outcome = await Promise.race([running, late]);
    grace.cancel();
    if (outcome === 'late') log(DOMAIN_BINDING_SWEEP_STOP_LATE_LINE);
  };

  return { tick, stop };
}
