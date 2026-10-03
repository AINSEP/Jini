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
export interface OutboxWorkerOptions {
  batchSize?: number;
  deliveryTimeoutMs?: number;
  claimLeaseMs?: number;
}
