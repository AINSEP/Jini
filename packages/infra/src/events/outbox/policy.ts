import type { OutboxWorkerOptions } from './ports.js';

export const MAX_OUTBOX_ATTEMPTS = 6;
export const DEFAULT_OUTBOX_CLAIM_LEASE_MS = 30 * 60 * 1000;
export const DEFAULT_OUTBOX_DELIVERY_TIMEOUT_MS = 60 * 1000;
export const DEFAULT_OUTBOX_DRAIN_INTERVAL_MS = 1000;

/** Source equal-jitter retry formula. Randomness is always supplied by the host. */
export function computeOutboxBackoffMs(required: { attempts: number; random: () => number }): number {
  if (!Number.isSafeInteger(required.attempts) || required.attempts < 1) throw new RangeError('outbox attempts must be a positive integer');
  const random = required.random();
  if (!Number.isFinite(random) || random < 0 || random > 1) throw new RangeError('outbox random must be between zero and one');
  const half = Math.min(30 * 60 * 1000, 30 * 1000 * 2 ** (required.attempts - 1)) / 2;
  return Math.round(half + random * half);
}

export interface ResolvedPolicy { batchSize: number; deliveryTimeoutMs: number; claimLeaseMs: number }
export function resolvePolicy(required: { options: OutboxWorkerOptions }): ResolvedPolicy {
  const policy = {
    batchSize: required.options.batchSize ?? 20,
    deliveryTimeoutMs: required.options.deliveryTimeoutMs ?? DEFAULT_OUTBOX_DELIVERY_TIMEOUT_MS,
    claimLeaseMs: required.options.claimLeaseMs ?? DEFAULT_OUTBOX_CLAIM_LEASE_MS,
  };
  for (const [name, value] of Object.entries(policy)) {
    if (!Number.isSafeInteger(value) || value < 1) throw new RangeError(`outbox ${name} must be a positive integer`);
  }
  if (policy.claimLeaseMs <= policy.batchSize * policy.deliveryTimeoutMs) {
    throw new RangeError('outbox claim lease must outlast a full batch of delivery timeouts');
  }
  return policy;
}
