import { nowIso } from '@jini-ai/core/primitives';
import type { EventEnvelope, OutboxClaim, OutboxRecord, OutboxWorkerArgs, OutboxWorkerOptions, Scheduler } from './ports.js';
import { computeOutboxBackoffMs, MAX_OUTBOX_ATTEMPTS, resolvePolicy } from './policy.js';
import type { ResolvedPolicy } from './policy.js';

type PublishOutcome = { ok: true } | { ok: false; error: unknown };
const TIMED_OUT = Symbol('delivery timed out');

function addMs(iso: string, delayMs: number): string { return new Date(Date.parse(iso) + delayMs).toISOString(); }
function claim(row: OutboxRecord): OutboxClaim {
  return { id: row.id, ...(row.claimToken === undefined ? {} : { claimToken: row.claimToken }) };
}
function failureStatus(row: OutboxRecord): 'pending' | 'failed' {
  return row.attempts >= MAX_OUTBOX_ATTEMPTS ? 'failed' : 'pending';
}
function report<Event extends EventEnvelope>(required: { args: OutboxWorkerArgs<Event>; message: string; error: unknown }): void {
  try { required.args.logger.error({ message: required.message }, { error: required.error }); } catch { /* Reporter cannot kill a background delivery. */ }
}

async function settleWithin(required: { publishing: Promise<PublishOutcome>; scheduler: Scheduler; timeoutMs: number }): Promise<PublishOutcome | typeof TIMED_OUT> {
  let task: ReturnType<Scheduler['schedule']> | undefined;
  const timeout = new Promise<typeof TIMED_OUT>(resolve => {
    task = required.scheduler.schedule({ delayMs: required.timeoutMs, callback: () => resolve(TIMED_OUT) });
  });
  try { return await Promise.race([required.publishing, timeout]); }
  finally { task?.cancel(); }
}

async function recordOutcome<Event extends EventEnvelope>(required: {
  args: OutboxWorkerArgs<Event>; row: OutboxRecord<Event>; outcome: PublishOutcome;
}): Promise<void> {
  const { args, row, outcome } = required;
  let error: unknown;
  if (outcome.ok) {
    try { await args.outbox.markDelivered(claim(row)); return; }
    catch (markError) { error = markError; }
  } else { error = outcome.error; }
  // Read the failure clock now, rather than anchoring retries to an earlier batch claim.
  const nextAttemptAt = addMs(nowIso({ clock: args.clock }), computeOutboxBackoffMs({ attempts: row.attempts, random: args.random }));
  await args.outbox.markFailed({ ...claim(row), error: error instanceof Error ? error.message : 'unknown outbox error',
    nextAttemptAt, nextStatus: failureStatus(row) });
}

async function recordOverrun<Event extends EventEnvelope>(required: {
  args: OutboxWorkerArgs<Event>; row: OutboxRecord<Event>; publishing: Promise<PublishOutcome>; policy: ResolvedPolicy;
}): Promise<void> {
  const { args, row, publishing, policy } = required;
  try {
    await args.outbox.markFailed({ ...claim(row),
      error: `delivery of outbox event "${row.event.name}" (${row.id}) timed out after ${policy.deliveryTimeoutMs}ms`,
      nextAttemptAt: addMs(nowIso({ clock: args.clock }), policy.claimLeaseMs), nextStatus: failureStatus(row) });
  } finally {
    // Attach only after the timeout write settles, so a meanwhile-completed handler writes last.
    // The original adapter has no fence. Tokens, where supported, prevent stale late writes.
    void publishing.then(outcome => recordOutcome({ args, row, outcome })).catch(error => {
      report({ args, message: `[outbox-worker] could not record the late outcome of outbox event "${row.event.name}" (${row.id})`, error });
    });
  }
}

async function deliver<Event extends EventEnvelope>(required: {
  args: OutboxWorkerArgs<Event>; row: OutboxRecord<Event>; policy: ResolvedPolicy;
}): Promise<void> {
  const { args, row, policy } = required;
  if (row.attempts > MAX_OUTBOX_ATTEMPTS) {
    await args.outbox.markFailed({ ...claim(row),
      error: `claimed ${row.attempts} times; the last claim expired with no recorded outcome (its claimer likely died mid-delivery)`,
      nextAttemptAt: nowIso({ clock: args.clock }), nextStatus: 'failed' });
    return;
  }
  // Capture synchronous throws as well as asynchronous failures; no publish rejection escapes.
  const publishing: Promise<PublishOutcome> = Promise.resolve().then(() => args.bus.publish({ event: row.event }))
    .then(() => ({ ok: true as const }), error => ({ ok: false as const, error }));
  const outcome = await settleWithin({ publishing, scheduler: args.scheduler, timeoutMs: policy.deliveryTimeoutMs });
  if (outcome === TIMED_OUT) { await recordOverrun({ args, row, publishing, policy }); return; }
  await recordOutcome({ args, row, outcome });
}

/** Claim and deliver a bounded batch. Delivery is at least once, with six attempts and capped backoff.
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
