import type { Clock, Logger } from "@jini-ai/core/primitives";
import type { DomainEvent, EventBusPort, OutboxPort } from "@jini-ai/core/contracts/events";
import type { Tracker } from "@jini-ai/core/contracts/site/diagnostics-observability";
import type {
  OutboxPort as JiniOutboxPort, OutboxRecord as JiniOutboxRecord, OutboxRetryPolicyResolver, OutboxWorkerArgs, OutboxWorkerOptions, Scheduler,
} from "./outbox/ports.js";
import { computeOutboxBackoffMs, DEFAULT_OUTBOX_CLAIM_LEASE_MS } from "./outbox/policy.js";
import { processOutbox } from "./outbox/worker.js";
import { toEnqueueOnlyOutbox } from "./outbox/enqueue-only.js";

/**
 * @file Domain-event (`@jini-ai/core/contracts/events`) port translation only. The generic outbox
 * worker (`./outbox`) owns retry, timeout, enqueue-only and drain lifecycles.
 * Domain storage owns the existing lease in next_attempt_at; there is no claim-token field and no
 * new persisted format. Neither constructing these adapters nor importing them starts a drain.
 */

/**
 * Adapt the domain event-shaped enqueue and fixed-lease claim contract to the worker port without
 * rewriting rows. The worker wrapper exposes no custom claimLeaseMs: production domain stores already
 * use the same 30-minute default. Passing a per-call lease would change the storage contract and
 * needs a separate owner decision. Domain settlement remains unfenced and carries only its existing fields.
 * @example const port = toJiniOutbox({ outbox: routeDeps.outbox });
 */
export function toJiniOutbox(required: { outbox: OutboxPort }, _optional: Record<string, never> = {}): JiniOutboxPort<DomainEvent> {
  const { outbox } = required;
  return {
    enqueue: ({ event }) => outbox.enqueue(event),
    // The domain row declares `lastError?: string | undefined`; the worker port's `lastError?: string`
    // differs only under exactOptionalPropertyTypes. Rows pass through unchanged (no copy, no rewrite).
    claimPending: ({ batchSize, nowIso }) =>
      outbox.claimPending({ batchSize, nowIso }) as Promise<readonly JiniOutboxRecord<DomainEvent>[]>,
    markDelivered: ({ id }) => outbox.markDelivered({ id }),
    markFailed: ({ id, error, nextAttemptAt, nextStatus }) => outbox.markFailed({ id, error, nextAttemptAt, nextStatus }),
  };
}

/**
 * Present a worker-port enqueue-only view through the unchanged domain port. Array copying satisfies
 * the domain mutable result type; envelopes and records retain their identity and contents.
 * @example const domainView = toCmsOutbox({ outbox: jiniView });
 */
export function toCmsOutbox(required: { outbox: JiniOutboxPort<DomainEvent> }, _optional: Record<string, never> = {}): OutboxPort {
  const { outbox } = required;
  return {
    enqueue: (event) => outbox.enqueue({ event }),
    claimPending: async ({ batchSize, nowIso }) => [...await outbox.claimPending({ batchSize, nowIso, claimLeaseMs: DEFAULT_OUTBOX_CLAIM_LEASE_MS })],
    markDelivered: ({ id }) => outbox.markDelivered({ id }),
    markFailed: ({ id, error, nextAttemptAt, nextStatus }) => outbox.markFailed({ id, error, nextAttemptAt, nextStatus }),
  };
}

/** The ports a domain outbox drain needs from its host: storage, bus, clock, timer scheduling and the error sink. */
export interface DomainOutboxRequired {
  outbox: OutboxPort; bus: EventBusPort; clock: Clock; scheduler: Scheduler; logger: Pick<Logger, "error">;
}

/**
 * Bind the domain bus, storage, clock, scheduler and logger to the existing outbox worker. The host
 * constructs the scheduler and the logger (this package owns no timer and no console sink);
 * `random` defaults to Math.random.
 * @example const worker = outboxWorkerArgs({ outbox, bus, clock, scheduler, logger }, { random: () => 0 });
 */
export function outboxWorkerArgs(
  required: DomainOutboxRequired, optional: { random?: () => number } = {},
): OutboxWorkerArgs<DomainEvent> {
  return {
    outbox: toJiniOutbox({ outbox: required.outbox }),
    bus: { publish: ({ event }) => required.bus.publish(event) },
    clock: required.clock,
    scheduler: required.scheduler,
    random: optional.random ?? Math.random,
    logger: required.logger,
  };
}

type DeliveryBus = OutboxWorkerArgs<DomainEvent>["bus"];

/** Outbox/job-queue chokepoint: each background delivery is one `outbox.deliver` operation labelled
 * with the event's stable name only (never its payload); a failed delivery is reported and still
 * rethrown, so retry/backoff stays `processOutbox`'s. Without a port the bus is used as-is.
 * @example const traced = trackOutboxDelivery({ bus: args.bus, tracker });
 * @complexity O(1) beyond the wrapped publish. */
export function trackOutboxDelivery({ bus, tracker }: { bus: DeliveryBus; tracker: Tracker }, _optional: Record<string, never> = {}): DeliveryBus {
  return { publish: (input) => tracker.trace({ name: "outbox.deliver", run: async (span) => {
    const result = await bus.publish(input);
    span.setOutcome({ outcome: "delivered", failed: false });
    return result;
  } }, { attributes: { "event.name": input.event.name } }) };
}

/**
 * An `OutboxPort` view that enqueues but never claims, for a process that writes content but does
 * not own event delivery.
 *
 * Process ownership:
 * An agent daemon and a site-serving process may share one content database, but each builds its
 * own in-memory bus. The real subscribers (sitemap invalidation, form notifications, webhook
 * fan-out, newsletter batches) are attached only to the serving process's bus. Tools that drain
 * inline after every write would, in the daemon, publish rows to a bus without those handlers and
 * mark them `delivered`, losing those events and any other pending rows claimed in the same batch.
 * Behind this view every daemon drain claims nothing, the rows stay `pending`, and the serving
 * process's background drainer delivers them.
 *
 * `markDelivered`/`markFailed` reject: nothing reaches them without claiming a row first, and this
 * view never hands one out, so a call is a wiring bug and fails loudly.
 *
 * @param required.outbox the real (shared) outbox to enqueue into.
 * @returns a new `OutboxPort`; `outbox` itself is not modified.
 * @example const daemonOutbox = toEnqueueOnlyDomainOutbox({ outbox: routeDeps.outbox });
 * @complexity O(1) per call beyond the wrapped `enqueue`.
 */
export function toEnqueueOnlyDomainOutbox(required: { outbox: OutboxPort }, _optional: Record<string, never> = {}): OutboxPort {
  return toCmsOutbox({ outbox: toEnqueueOnlyOutbox({ outbox: toJiniOutbox({ outbox: required.outbox }) }) });
}

/**
 * Exponential backoff with "equal jitter", owned by `./outbox/policy.ts`:
 * `half = min(cap, base * 2^(attempts-1)) / 2`, then `half + random() * half` — always at least
 * `half`, at most the full exponential step, so retries never collapse to zero delay (thundering
 * herd) or drift outside the exponential envelope. `attempts` is 1-based (the count *after* the
 * failing attempt that just happened — `claimPending` increments it before the attempt runs).
 * At `attempts = 1..6` with the default constants, the un-jittered midpoints are roughly 15s, 30s,
 * 1m, 2m, 4m, 8m — an internal in-process event-bus failure is expected to be a real bug or a
 * short-lived dependency outage, not a slow external endpoint, so this window is far shorter than
 * an outgoing-webhook worker's ~1-day one.
 *
 * `random` is injectable (defaults to `Math.random`) purely for deterministic tests.
 *
 * @throws RangeError for invalid attempts or randomness.
 * @example computeDomainOutboxBackoffMs({ attempts: 1 }, { random: () => 0 }); // 15000
 * @complexity O(1).
 */
export function computeDomainOutboxBackoffMs({ attempts }: { attempts: number }, optional: { random?: () => number } = {}): number {
  return computeOutboxBackoffMs({ attempts, random: optional.random ?? Math.random });
}

/**
 * Claims due domain outbox rows and attempts to publish each to the event bus, marking delivered on
 * success or scheduling a backed-off retry (or permanent exclusion past `MAX_OUTBOX_ATTEMPTS`) on
 * failure. See the worker's `deliver` for a row claimed more than `MAX_OUTBOX_ATTEMPTS` times. Each
 * delivery may run at most `deliveryTimeoutMs` (default `DEFAULT_OUTBOX_DELIVERY_TIMEOUT_MS`) before
 * the drain moves on; see the worker's `recordOverrun`. `retryPolicyForEvent` is the host's per-event
 * retry table (events it returns a policy for use their own cap and backoff).
 *
 * @throws RangeError before claiming if the batch/timeout bounds are invalid or outlast the lease.
 * @example await processDomainOutbox({ outbox, bus, clock, scheduler, logger }, { batchSize: 1 });
 * @complexity O(batchSize) publish attempts, each O(subscribed handlers for the event's name).
 */
export async function processDomainOutbox(
  required: DomainOutboxRequired,
  optional: { batchSize?: number; random?: () => number; deliveryTimeoutMs?: number; retryPolicyForEvent?: OutboxRetryPolicyResolver } = {},
): Promise<number> {
  const options: OutboxWorkerOptions = { retryPolicyForEvent: optional.retryPolicyForEvent };
  if (optional.batchSize !== undefined) options.batchSize = optional.batchSize;
  if (optional.deliveryTimeoutMs !== undefined) options.deliveryTimeoutMs = optional.deliveryTimeoutMs;
  return processOutbox(outboxWorkerArgs(required, optional.random ? { random: optional.random } : {}), options);
}
