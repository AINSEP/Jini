import { nowIso } from '@jini-ai/core/primitives';
import type { EventEnvelope, OutboxClaim, OutboxRecord, OutboxRetryPolicy, OutboxWorkerArgs, OutboxWorkerOptions, Scheduler } from './ports.js';
import { computeOutboxBackoffMs, MAX_OUTBOX_ATTEMPTS, resolvePolicy } from './policy.js';
import type { ResolvedPolicy } from './policy.js';
import type { Completion, DispatchResult, Empty, Fence, FencedClaim, FencedOutboxPort } from './ports.js';

type RetryRow<Event extends EventEnvelope> = Pick<OutboxRecord<Event>, 'id' | 'event' | 'attempts'>;
type WorkerServices<Event extends EventEnvelope> = Pick<OutboxWorkerArgs<Event>, 'clock' | 'scheduler' | 'random' | 'logger'>;
type FencedWorkerArgs<Event extends EventEnvelope> = WorkerServices<Event> & {
  scope: string; outbox: FencedOutboxPort<Event>;
  authorize(input: { claim: FencedClaim<Event> }, options?: Empty): Promise<boolean>;
  dispatch(input: { claim: FencedClaim<Event> }, options?: Empty): Promise<DispatchResult>;
};

type PublishOutcome = { ok: true } | { ok: false; error: unknown };
const TIMED_OUT = Symbol('delivery timed out');

function addMs(iso: string, delayMs: number): string { return new Date(Date.parse(iso) + delayMs).toISOString(); }
function claim(row: OutboxRecord): OutboxClaim {
  return { id: row.id, ...(row.claimToken === undefined ? {} : { claimToken: row.claimToken }) };
}
const DEFAULT_RETRY_POLICY: OutboxRetryPolicy = { maxAttempts: MAX_OUTBOX_ATTEMPTS, backoffMs: computeOutboxBackoffMs };
type FailurePlan = { delayMs: number; nextStatus: 'pending' | 'failed' };

function failureStatus(required: { row: Pick<OutboxRecord, 'attempts'>; retry: OutboxRetryPolicy }): 'pending' | 'failed' {
  return required.row.attempts >= required.retry.maxAttempts ? 'failed' : 'pending';
}
function report<Event extends EventEnvelope>(required: { args: WorkerServices<Event>; message: string; error: unknown }): void {
  try { required.args.logger.error({ message: required.message }, { error: required.error }); } catch { /* Reporter cannot kill a background delivery. */ }
}
function reportPolicyFailure<Event extends EventEnvelope>(required: { args: WorkerServices<Event>; row: RetryRow<Event>; error: unknown }): void {
  report({ args: required.args, error: required.error,
    message: `[outbox-worker] the retry policy for outbox event "${required.row.event.name}" (${required.row.id}) failed; using the default policy for this row` });
}

/**
 * Picks the row's retry policy once per claim. Host resolver code runs inside the worker, so a
 * resolver that throws or returns an invalid cap must not reject the batch: that would leave this
 * row (and every later row in the batch) processing until the lease expires, and fail the same way
 * on every reclaim. Falling back to the default policy is the smallest choice that still records
 * an outcome and still terminates: at worst the row gets the bounded default schedule and cap.
 */
function retryPolicyFor<Event extends EventEnvelope>(required: {
  args: WorkerServices<Event>; row: RetryRow<Event>; policy: ResolvedPolicy;
}): OutboxRetryPolicy {
  try {
    const custom = required.policy.retryPolicyForEvent?.({ event: required.row.event });
    if (custom === undefined) return DEFAULT_RETRY_POLICY;
    if (!Number.isSafeInteger(custom.maxAttempts) || custom.maxAttempts < 1) {
      throw new RangeError(`maxAttempts ${String(custom.maxAttempts)} is not a positive integer; fix the host retry-policy resolver`);
    }
    return custom;
  } catch (error) {
    reportPolicyFailure({ ...required, error });
    return DEFAULT_RETRY_POLICY;
  }
}

function planWith(required: { row: Pick<OutboxRecord, 'attempts'>; retry: OutboxRetryPolicy; random: () => number; error: unknown }): FailurePlan {
  const { row, retry, error } = required;
  const delayMs = retry.backoffMs({ attempts: row.attempts, random: required.random, error });
  if (!Number.isFinite(delayMs) || delayMs < 0) throw new RangeError(`retry delay ${delayMs}ms is not finite and nonnegative; fix the host retry policy`);
  const terminal = failureStatus({ row, retry }) === 'failed' || retry.retryable?.({ error }) === false;
  return { delayMs, nextStatus: terminal ? 'failed' : 'pending' };
}

/**
 * Next delay and status for a failed attempt. A custom policy whose backoff or retryable throws, or
 * yields a non-finite or negative delay, falls back to the default plan for the same reason as
 * {@link retryPolicyFor}. The default plan itself is not guarded, so its historical behaviour
 * (including the RangeError for host randomness outside 0..1) is unchanged.
 *
 * Why this is a second fallback rather than one shared with {@link retryPolicyFor}: the two run at
 * different moments with different inputs. The resolver runs once per claim, before publishing,
 * because the over-cap seal needs the cap; `backoffMs` and `retryable` can only run after a failure,
 * because they take that failure's error. No single up-front check can validate both.
 */
function failurePlan<Event extends EventEnvelope>(required: {
  args: WorkerServices<Event>; row: RetryRow<Event>; retry: OutboxRetryPolicy; error: unknown;
}): FailurePlan {
  const { args, row, retry, error } = required;
  if (retry !== DEFAULT_RETRY_POLICY) {
    try { return planWith({ row, retry, random: args.random, error }); }
    catch (policyError) { reportPolicyFailure({ args, row, error: policyError }); }
  }
  return planWith({ row, retry: DEFAULT_RETRY_POLICY, random: args.random, error });
}

/**
 * Resolves with the publishing outcome, or {@link TIMED_OUT} once `timeoutMs` passes, whichever
 * comes first.
 *
 * A handler cannot be cancelled: a publish that loses the race keeps running and may still finish
 * later (see `recordOverrun`, which observes it after the timeout is recorded). The timer is cleared
 * as soon as the race settles and is `unref`'d, so it never keeps a process alive.
 *
 * @complexity O(1) beyond the awaited promise itself.
 */
async function settleWithin<Outcome>(required: { publishing: Promise<Outcome>; scheduler: Scheduler; timeoutMs: number }): Promise<Outcome | typeof TIMED_OUT> {
  let task: ReturnType<Scheduler['schedule']> | undefined;
  const timeout = new Promise<typeof TIMED_OUT>(resolve => {
    task = required.scheduler.schedule({ delayMs: required.timeoutMs, callback: () => resolve(TIMED_OUT) });
  });
  try { return await Promise.race([required.publishing, timeout]); }
  finally { task?.cancel(); }
}

/**
 * Records a publish's outcome: `markDelivered` on success, or a normal backed-off `markFailed` on
 * failure — including when `markDelivered` itself throws, which falls through to the failure branch
 * exactly as before this file's 2026-09-16 revision.
 *
 * @complexity O(1) beyond the two port calls it may make.
 */
async function recordOutcome<Event extends EventEnvelope>(required: {
  args: OutboxWorkerArgs<Event>; row: OutboxRecord<Event>; outcome: PublishOutcome; retry: OutboxRetryPolicy;
}): Promise<void> {
  const { args, row, outcome, retry } = required;
  let error: unknown;
  if (outcome.ok) {
    try { await args.outbox.markDelivered(claim(row)); return; }
    catch (markError) { error = markError; }
  } else { error = outcome.error; }
  // Anchored to the clock read HERE, not to the batch's claim instant in `processOutbox` (2026-09-07
  // audit, claim #6). The claim instant is when `claimPending` was called; every row after the first
  // is marked some time later, so a batch that takes longer to reach this row than the backoff it
  // computes would schedule a retry already in the past — the row is then re-claimed on the
  // very next tick with no backoff at all, precisely when a slow, failing handler is the reason
  // backoff exists. The floor is 15s (`computeOutboxBackoffMs` at `attempts = 1`, `random = 0`)
  // and the bus is in-process, so this needs a pathologically slow handler to bite; it is fixed
  // because the correct anchor costs one clock read, not because it was observed in the wild.
  const plan = failurePlan({ args, row, retry, error });
  const nextAttemptAt = addMs(nowIso({ clock: args.clock }), plan.delayMs);
  await args.outbox.markFailed({ ...claim(row), error: error instanceof Error ? error.message : 'unknown outbox error',
    nextAttemptAt, nextStatus: plan.nextStatus });
}

/**
 * Records a delivery timeout: `lastError` is written at once so the drain is never stalled behind an
 * overrunning handler, but unlike an ordinary failure the row is not due again until
 * `DEFAULT_OUTBOX_CLAIM_LEASE_MS` later, not the normal backoff (2026-09-16). The handler is still
 * running and cannot be cancelled — retrying it in 15-30s would run a second copy of it while the
 * first is still live, which is the exact duplicate the claim lease exists to prevent (see this
 * file's header doc). Its own outcome, once it settles, replaces this record via
 * {@link recordOutcome} — attached only after the timeout record's write has settled, so a
 * publish that finishes while that write is still in flight is still written last. A handler that
 * never settles at all is retried at the lease horizon, exactly like a claimer that died mid-delivery.
 *
 * Residual risk, not fixed here: a handler still running past that horizon can have its row reclaimed
 * by a second drain, and this recorder's eventual late write is not fenced against that second drain's
 * own outcome when a host port (including the CMS port) has no claim token to check against.
 * Token-capable adapters fence these writes; the unfenced host retains its historical race.
 *
 * @complexity O(1) beyond the port calls it makes; the late write happens off the caller's stack.
 */
async function recordOverrun<Event extends EventEnvelope>(required: {
  args: OutboxWorkerArgs<Event>; row: OutboxRecord<Event>; publishing: Promise<PublishOutcome>; policy: ResolvedPolicy;
  retry: OutboxRetryPolicy;
}): Promise<void> {
  const { args, row, publishing, policy, retry } = required;
  try {
    // Only the cap decides this status; `retry.retryable` (consulted by `planWith`) is deliberately
    // not asked. A timeout is not the handler's error: the handler is still running and may yet
    // succeed, and its real outcome replaces this record through `recordOutcome`, which does apply
    // `retryable`. Asking the classifier now would judge an error the handler never produced.
    await args.outbox.markFailed({ ...claim(row),
      error: `delivery of outbox event "${row.event.name}" (${row.id}) timed out after ${policy.deliveryTimeoutMs}ms`,
      nextAttemptAt: addMs(nowIso({ clock: args.clock }), policy.claimLeaseMs), nextStatus: failureStatus({ row, retry }) });
  } finally {
    // Attached only after the timeout record settles, so a publish that settles meanwhile is still
    // written LAST. The captured publish outcome never rejects, so this chain never produces an unhandled
    // rejection on its own; a `recordOutcome` failure is caught and reported instead of
    // thrown, because nothing here is awaited by the caller.
    // The original adapter has no fence. Tokens, where supported, prevent stale late writes.
    void publishing.then(outcome => recordOutcome({ args, row, outcome, retry })).catch(error => {
      report({ args, message: `[outbox-worker] could not record the late outcome of outbox event "${row.event.name}" (${row.id})`, error });
    });
  }
}

/**
 * Publishes one claimed row and records its outcome.
 *
 * A row whose `attempts` already exceeds its retry policy's `maxAttempts` (`MAX_OUTBOX_ATTEMPTS` by
 * default) is sealed as `"failed"` without being published (2026-09-14). A failed attempt at the cap seals the row, so the only way past the cap is
 * a claim that expired with no recorded outcome: its claimer died mid-delivery, possibly because a
 * handler crashed the process. Publishing it again could repeat that crash on every lease expiry.
 *
 * @complexity O(subscribed handlers for the event's name).
 */
async function deliver<Event extends EventEnvelope>(required: {
  args: OutboxWorkerArgs<Event>; row: OutboxRecord<Event>; policy: ResolvedPolicy;
}): Promise<void> {
  const { args, row, policy } = required;
  const retry = retryPolicyFor(required);
  if (row.attempts > retry.maxAttempts) {
    await args.outbox.markFailed({ ...claim(row),
      error: `claimed ${row.attempts} times; the last claim expired with no recorded outcome (its claimer likely died mid-delivery)`,
      nextAttemptAt: nowIso({ clock: args.clock }), nextStatus: 'failed' });
    return;
  }
  /**
   * Starts `bus.publish({ event: row.event })` and resolves with its outcome. It never rejects — a
   * synchronous throw from the bus counts as a failed outcome, same as an async rejection — so it
   * is safe to leave running unawaited (see `recordOverrun`) without an unhandled rejection.
   * @complexity O(1) beyond the publish itself.
   */
  // Capture synchronous throws as well as asynchronous failures; no publish rejection escapes.
  const publishing: Promise<PublishOutcome> = Promise.resolve().then(() => args.bus.publish({ event: row.event }))
    .then(() => ({ ok: true as const }), error => ({ ok: false as const, error }));
  const outcome = await settleWithin({ publishing, scheduler: args.scheduler, timeoutMs: policy.deliveryTimeoutMs });
  if (outcome === TIMED_OUT) { await recordOverrun({ args, row, publishing, policy, retry }); return; }
  await recordOutcome({ args, row, outcome, retry });
}

/** Claim and deliver a bounded batch. Delivery is at least once, with six attempts and capped backoff
 * unless the host's optional `retryPolicyForEvent` resolver gives an event its own cap, backoff and
 * terminal errors (see {@link retryPolicyFor}); every other event keeps the defaults below.
 *
 * Reliability bridge: synchronous command writes enqueue persisted events, while this worker
 * owns retry policy for asynchronous side effects. Hosts provide storage and their subscribed bus;
 * storage adapters persist nextStatus rather than independently deciding retry versus terminal.
 * Before the 2026-09-06 fix, nextAttemptAt was the claim instant and attempts were never read,
 * so poison events spun at full batch rate forever. A failed row is now permanently excluded
 * from claimPending, regardless of its nextAttemptAt. One cap lives in policy.ts, exported here.
 * Equal-jitter exponential backoff deliberately parallels webhook delivery without importing a
 * domain worker: half = min(cap, base * 2^(attempts-1)) / 2; delay = half + random() * half.
 * Retry delay is at least half the step and at most the step, preventing zero-delay herds.
 * Attempts are one-based, incremented atomically at claim time. Base is 30 seconds, cap is
 * 30 minutes, and the six retry lower bounds are 15s, 30s, 1m, 2m, 4m and 8m. Internal bus
 * failure usually indicates a bug or brief outage, so this window is shorter than external delivery.
 * Randomness is required from the host for deterministic tests; there is no ambient random default.
 *
 * The 2026-09-14 claim lease fixes rows stuck processing forever after a crash or watcher reload.
 * claimPending atomically leases due pending and expired-processing rows, excludes terminal rows,
 * increments attempts, and returns detached copies. The adapter must persist nowIso + claimLeaseMs.
 * A lease must outlast the slowest full live batch or a second drain can redeliver a live row.
 * The default is 20 rows with one minute per delivery inside a 30-minute claim lease; custom
 * bounds are validated before claiming and require adapters that honor the passed lease.
 * A row claimed beyond the six-attempt cap is sealed without publishing: its last claimer may
 * have died in a crashing handler, and publishing again could repeat that crash on every expiry.
 *
 * A handler that never settled used to stall both inline drains and the background loop forever.
 * Since 2026-09-16 each publish is raced against the bounded timeout. The handler cannot be
 * cancelled: its immediate timeout error becomes visible, but the next due time is the lease
 * horizon, rather than ordinary 15-30s backoff that would start another copy while it is live.
 * A full default timeout batch takes 20 minutes. The timer is cancelled as soon as the race
 * settles; the host scheduler defers callbacks even at zero delay and must unref Node timers.
 * Synchronous bus throws and asynchronous failures become non-rejecting publish outcomes, so
 * observing a late handler cannot cause an unhandled publish rejection.
 *
 * Late outcome observation is attached only after the timeout write settles, so even a handler
 * that finishes during that write records last. Success marks delivered; markDelivered failure
 * falls through to normal backoff, anchored to the failure clock rather than the earlier claim.
 * Late recorder failures reach injected logging, whose own failure cannot kill delivery.
 * A never-settling handler is retried at the lease horizon just like a dead claimer.
 * Residual risk: a handler still live beyond the horizon may overlap another claimer. Optional
 * adapter claim tokens accompany every outcome and fence stale late writes. An unfenced adapter
 * retains the historical late-write race; even fenced delivery is at least once and effects need
 * host idempotency. No storage schema or connection is created by this orchestration.
 *
 * The complete envelope and its identity pass through unchanged; only name is read by the worker.
 * The host retains payload and workspace metadata. There are no global timers, console calls,
 * Date.now or Math.random dependencies in orchestration; clock and logging use the kernel ports.
 * @complexity O(batchSize) publish attempts, each O(subscribed handlers for the event name). */
export async function processOutbox<Event extends EventEnvelope>(
  required: OutboxWorkerArgs<Event>, optional: OutboxWorkerOptions = {},
): Promise<number> {
  const policy = resolvePolicy({ options: optional });
  const rows = await required.outbox.claimPending({ batchSize: policy.batchSize, nowIso: nowIso({ clock: required.clock }), claimLeaseMs: policy.claimLeaseMs });
  for (const row of rows) await deliver({ args: required, row, policy });
  return rows.length;
}

/** Build a fresh transition fence from host time, never the earlier batch-claim instant. */
function currentFence<Event extends EventEnvelope>(input: {
  args: FencedWorkerArgs<Event>; row: FencedClaim<Event>;
}): Fence {
  return { id: input.row.id, scope: input.args.scope, claimToken: input.row.claimToken,
    nowIso: nowIso({ clock: input.args.clock }) };
}

/** Reject expired, malformed or cross-scope receipts before an irreversible effect. */
function isLiveClaim<Event extends EventEnvelope>(input: {
  args: FencedWorkerArgs<Event>; row: FencedClaim<Event>;
}): boolean {
  return input.row.scope === input.args.scope && input.row.claimToken.length > 0
    && input.args.clock.nowMs() < Date.parse(input.row.leaseExpiresAt);
}

/**
 * Classify untrusted host transport results conservatively. A malformed result (including a
 * throwing getter) cannot establish absence of effects; the captured promise maps throws below.
 */
function dispatchKind(input: { result: unknown }): DispatchResult['kind'] {
  if (typeof input.result !== 'object' || input.result === null) return 'uncertain';
  const kind: unknown = Reflect.get(input.result, 'kind');
  switch (kind) {
    case 'delivered': case 'permanent-failure': case 'confirmed-no-effect': return kind;
    default: return 'uncertain';
  }
}

/** Reuse worker retry policy only after the host confirms the attempt had no effect. */
function fencedCompletion<Event extends EventEnvelope>(input: {
  args: FencedWorkerArgs<Event>; row: FencedClaim<Event>; retry: OutboxRetryPolicy;
  kind: DispatchResult['kind'];
}): Completion {
  switch (input.kind) {
    case 'delivered': return { status: 'delivered' };
    case 'permanent-failure': return { status: 'failed' };
    case 'uncertain': return { status: 'uncertain' };
    case 'confirmed-no-effect': {
      const plan = failurePlan({ ...input, error: { kind: input.kind } });
      if (plan.nextStatus === 'failed') return { status: 'failed' };
      return { status: 'pending', nextAttemptAt: addMs(nowIso({ clock: input.args.clock }), plan.delayMs) };
    }
    default: { const exhaustive: never = input.kind; throw new TypeError(`unknown dispatch kind: ${String(exhaustive)}`); }
  }
}

/**
 * Bound a pre-dispatch gate by the delivery timeout so a hung host call cannot hold the batch (or a
 * pump's stop()) forever. Nothing has been sent yet, so a timeout records no completion; the lease
 * expires and recovery decides. A late result is ignored and a late rejection stays handled.
 */
async function boundedGate<Event extends EventEnvelope>(input: {
  args: FencedWorkerArgs<Event>; policy: ResolvedPolicy; start: () => Promise<boolean>;
}): Promise<boolean | typeof TIMED_OUT> {
  const gate = Promise.resolve().then(input.start);
  gate.catch(() => {});
  return settleWithin({ publishing: gate, scheduler: input.args.scheduler, timeoutMs: input.policy.deliveryTimeoutMs });
}

/**
 * Authorization and the durable begin marker precede dispatch. A failed/unavailable fence never
 * reaches transport. Recheck expiry AFTER awaiting storage: begin may have used up the lease.
 */
async function dispatchFenced<Event extends EventEnvelope>(input: {
  args: FencedWorkerArgs<Event>; row: FencedClaim<Event>; policy: ResolvedPolicy;
  retry: OutboxRetryPolicy;
}): Promise<Completion | undefined> {
  const { args, row, policy, retry } = input;
  if (!isLiveClaim(input)) return;
  if (row.attempts > retry.maxAttempts) return { status: 'failed' };
  const authorized = await boundedGate({ ...input, start: () => args.authorize({ claim: row }, {}) });
  if (authorized === TIMED_OUT) return;
  if (authorized !== true) return { status: 'denied' };
  if (await boundedGate({ ...input, start: () => args.outbox.beginDispatch(currentFence(input), {}) }) !== true) return;
  if (!isLiveClaim(input)) return;
  // Capture both synchronous and asynchronous failures; a late result is observed but never
  // writes over uncertainty or releases a row for an automatic retry.
  const publishing = (async () => dispatchKind({ result: await args.dispatch({ claim: row }, {}) }))()
    .catch(() => 'uncertain' as const);
  const outcome = await settleWithin({ publishing, scheduler: args.scheduler, timeoutMs: policy.deliveryTimeoutMs });
  const kind = outcome === TIMED_OUT ? 'uncertain' : outcome;
  return fencedCompletion({ ...input, kind });
}

/**
 * Keep storage acknowledgements outside outcome/retry classification: complete may have committed
 * before throwing. Leave its durable state fenced for recovery/reconciliation rather than retrying.
 */
async function deliverFenced<Event extends EventEnvelope>(input: {
  args: FencedWorkerArgs<Event>; row: FencedClaim<Event>; policy: ResolvedPolicy;
}): Promise<void> {
  try {
    const retry = retryPolicyFor(input);
    const completion = await dispatchFenced({ ...input, retry });
    if (completion === undefined) return;
    const accepted = await input.args.outbox.complete({ ...currentFence(input), completion }, {});
    if (!accepted) report({ args: input.args, message: '[fenced-outbox] completion fence rejected; host reconciliation required', error: completion });
  } catch (error) {
    report({ args: input.args, message: '[fenced-outbox] attempt unresolved; durable fence retained for host recovery', error });
  }
}

/**
 * Recover expired leases (never-dispatched leased rows to pending, dispatching rows to uncertain),
 * then process a bounded batch of due pending rows.
 * Only explicit confirmed-no-effect results use the existing retry policy. Throws, invalid results
 * and timeouts cannot release an attempt; late results never overwrite uncertainty. A storage
 * acknowledgement failure leaves the durable dispatch marker for host reconciliation, since it
 * may have committed before throwing. Hosts supply atomic storage; no tables or sessions open here.
 *
 * @param input Host ports, scope, authorization gate and effect dispatcher.
 * @param options Existing outbox bounds and per-event retry policy, with unchanged defaults.
 * @returns Number of claimed rows, including denied or unresolved attempts.
 * @throws RangeError for invalid bounds; recovery/claim storage failures propagate before dispatch.
 * @example await processFencedOutbox({ scope, outbox, authorize, dispatch, clock, scheduler, random, logger });
 * @complexity O(batchSize) sequential gate/transport/storage calls, with bounded transport waits.
 */
export async function processFencedOutbox<Event extends EventEnvelope>(
  input: FencedWorkerArgs<Event>, options: OutboxWorkerOptions = {},
): Promise<number> {
  const policy = resolvePolicy({ options });
  await input.outbox.recoverExpired({ scope: input.scope, nowIso: nowIso({ clock: input.clock }), limit: policy.batchSize }, {});
  const rows = await input.outbox.claimReady({ scope: input.scope, batchSize: policy.batchSize,
    nowIso: nowIso({ clock: input.clock }), claimLeaseMs: policy.claimLeaseMs }, {});
  for (const row of rows) await deliverFenced({ args: input, row, policy });
  return rows.length;
}
