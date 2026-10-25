import type { Clock, Logger } from '@jini-ai/core/primitives';
/** The complete application envelope passes through unchanged; only name is read by the worker. */
export interface EventEnvelope { readonly name: string }
export interface OutboxRecord<Event extends EventEnvelope = EventEnvelope> {
  readonly id: string;
  readonly event: Event;
  readonly status: 'pending' | 'processing' | 'delivered' | 'failed';
  /** One-based count, incremented atomically by claimPending. */
  readonly attempts: number;
  readonly nextAttemptAt: string;
  readonly createdAt: string;
  readonly lastError?: string;
  /** Optional fencing receipt supplied and checked by capable host adapters. */
  readonly claimToken?: string;
}
export interface OutboxClaim { id: string; claimToken?: string }
export interface OutboxPort<Event extends EventEnvelope = EventEnvelope> {
  enqueue(required: { event: Event }): Promise<void>;
  /**
   * Atomically claim due pending rows and expired processing leases, excluding terminal rows.
   * Increment attempts and persist nowIso + claimLeaseMs before returning detached row copies.
   */
  claimPending(required: { batchSize: number; nowIso: string; claimLeaseMs: number }): Promise<readonly OutboxRecord<Event>[]>;
  /** If a claimToken is present, stale outcomes must not overwrite a newer claim. */
  markDelivered(required: OutboxClaim): Promise<void>;
  /** If a claimToken is present, stale outcomes must not overwrite a newer claim. */
  markFailed(required: OutboxClaim & { error: string; nextAttemptAt: string; nextStatus: 'pending' | 'failed' }): Promise<void>;
}
export interface EventPublisher<Event extends EventEnvelope = EventEnvelope> {
  publish(required: { event: Event }): Promise<void>;
}

export interface ScheduledTask { cancel(): void }
export interface Scheduler {
  /** Deferred callback, even for delayMs=0. Node adapters should unref their timers. */
  schedule(required: { delayMs: number; callback: () => void }): ScheduledTask;
}

export interface OutboxWorkerArgs<Event extends EventEnvelope = EventEnvelope> {
  outbox: OutboxPort<Event>;
  bus: EventPublisher<Event>;
  clock: Clock;
  scheduler: Scheduler;
  random: () => number;
  logger: Pick<Logger, 'error'>;
}
/**
 * Retry policy for one event, chosen by the host per event name. Events with no policy keep the
 * default six attempts and 15s..30min equal-jitter backoff. `error` is whatever failed the attempt
 * (a publish failure, or a storage failure recording a delivery). A policy that throws, or returns an
 * invalid cap or delay, is reported and the row falls back to the default policy (see worker.ts).
 */
export interface OutboxRetryPolicy {
  /** Positive integer cap; a failed attempt at or past it is terminal. */
  readonly maxAttempts: number;
  /** Finite, nonnegative delay before the next attempt. */
  backoffMs(required: { attempts: number; random: () => number; error: unknown }): number;
  /** `false` makes this failure terminal at once; absent means every failure is retryable. */
  retryable?(required: { error: unknown }): boolean;
}
/** The only per-event retry seam: return a policy for events that need one, `undefined` otherwise. */
export type OutboxRetryPolicyResolver = (required: { event: EventEnvelope }) => OutboxRetryPolicy | undefined;
export interface OutboxWorkerOptions {
  batchSize?: number;
  deliveryTimeoutMs?: number;
  claimLeaseMs?: number;
  retryPolicyForEvent?: OutboxRetryPolicyResolver | undefined;
}

/** Reserved optional object for boundaries with no current options. */
export type Empty = Record<string, never>;
/** The event a fenced row carries, unique per (scope, idempotencyKey). */
export type Intent<E> = { event: E; scope: string; idempotencyKey: string };
/** An intent plus the digest of the request that produced it (see `outboxRequestDigest`). */
export type EnqueueIntent<E> = Intent<E> & { requestDigest: string };
/** Replays under (scope, idempotencyKey) match the original digest; a different one conflicts. */
export type EnqueueReceipt =
  | { status: 'inserted' | 'existing' }
  | { status: 'conflict'; reason: 'request-digest-mismatch' };
/** Every transition checks identity, scope, token, allowed state and an unexpired lease atomically. */
export type Fence = { id: string; scope: string; claimToken: string; nowIso: string };
/** Detached lease receipt; attempts is one-based and incremented atomically by claimReady. */
export type FencedClaim<E> = Intent<E> & {
  id: string; claimToken: string; leaseExpiresAt: string; attempts: number;
};
export type Completion =
  | { status: 'delivered' | 'denied' | 'failed' | 'uncertain' }
  | { status: 'pending'; nextAttemptAt: string };
/** Only confirmed-no-effect permits a retry; throws and unrecognized results are uncertain. */
export type DispatchResult = {
  kind: 'delivered' | 'permanent-failure' | 'confirmed-no-effect' | 'uncertain';
};

/**
 * Opt-in durable fencing contract, independent of the legacy OutboxPort and host schema.
 * Adapters own atomic transitions; uncertain rows require host reconciliation, never auto-reclaim.
 * Enqueueing is the separate, opt-in `FencedEnqueuePort`.
 */
export interface FencedOutboxPort<E> {
  /**
   * Recover at most limit expired rows in scope. A leased row never passed the beginDispatch fence,
   * so it was provably never sent: return it to pending. Only dispatching rows become uncertain.
   */
  recoverExpired(input: { scope: string; nowIso: string; limit: number }, options?: Empty): Promise<number>;
  /** Claim only due pending rows in scope; persist a fresh token, lease and incremented attempts. */
  claimReady(input: { scope: string; batchSize: number; nowIso: string; claimLeaseMs: number }, options?: Empty): Promise<readonly FencedClaim<E>[]>;
  /** Atomically persist leased → dispatching under the complete fence; false denies dispatch. */
  beginDispatch(input: Fence, options?: Empty): Promise<boolean>;
  /**
   * Atomically complete under the fence. Leased rows permit denied, failed or uncertain;
   * dispatching rows permit delivered, failed, uncertain or pending. Other transitions return
   * false, including attempts to release uncertain/terminal rows. Pending requires a confirmed
   * no-effect outcome. A failure here must never be interpreted as a transport failure/retry.
   */
  complete(input: Fence & { completion: Completion }, options?: Empty): Promise<boolean>;
}

/**
 * Opt-in idempotent enqueue for fenced rows; `Tx` is the host's live transaction session type.
 * Run the exported `fencedOutboxConformance` cases against every adapter.
 * @example await outbox.enqueueWithReceipt({ intent }, { transaction: liveSession });
 */
export interface FencedEnqueuePort<E, Tx> {
  /**
   * Atomically insert under unique (scope, idempotencyKey), or compare the digest with the original:
   * equal is `existing`, different is a conflict that preserves the original row and its event.
   * A supplied transaction is the caller's exact live session: the insert joins it, so it commits or
   * rolls back with the caller's own intent writes, and enqueue never opens, commits or retries
   * another. Reject closed or unsupported sessions. Without one, the insert commits on its own.
   * A key inserted by another still-open transaction is never inserted twice: wait for it or reject.
   */
  enqueueWithReceipt(required: { intent: EnqueueIntent<E> }, optional?: { transaction?: Tx }): Promise<EnqueueReceipt>;
}
