/**
 * @file Characterization pins for the outbox's DEFAULT retry behaviour, written against the worker
 * and drainer before the per-event retry-policy resolver was added. Every event that does not opt
 * into a resolver must keep exactly this schedule, cap, timeout horizon and drainer pass-through.
 */
import { afterEach, expect, test, vi } from 'vitest';
import { DEFAULT_OUTBOX_CLAIM_LEASE_MS, processOutbox, startOutboxDrainer } from '../index.js';
import { deferred, fixture, NOW, row } from './fixtures.js';

afterEach(() => { vi.useRealTimers(); });

const at = (offsetMs: number): string => new Date(Date.parse(NOW) + offsetMs).toISOString();

test.each([
  // attempts, random, expected delay, expected status: equal jitter 15s..30min, six attempts.
  [1, 0, 15_000, 'pending'], [1, 1, 30_000, 'pending'],
  [2, 0, 30_000, 'pending'], [3, 0, 60_000, 'pending'],
  [4, 0, 120_000, 'pending'], [5, 1, 480_000, 'pending'],
  [6, 0, 480_000, 'failed'], [6, 1, 960_000, 'failed'],
] as const)('default failure at attempt %i (random %d) retries after %ims as %s', async (attempts, random, delayMs, status) => {
  const f = fixture([row('evt', attempts)]);
  f.args.random = () => random;
  f.bus.publish.mockRejectedValueOnce(new Error('offline'));
  await processOutbox(f.args);
  expect(f.outbox.markFailed).toHaveBeenCalledWith({ id: 'evt', error: 'offline', nextAttemptAt: at(delayMs), nextStatus: status });
});

test('a timeout at the default cap seals the row at the lease horizon', async () => {
  vi.useFakeTimers();
  const f = fixture([row('held', 6)]);
  const held = deferred();
  f.bus.publish.mockImplementationOnce(() => held.promise);
  const processing = processOutbox(f.args, { deliveryTimeoutMs: 10 });
  await vi.advanceTimersByTimeAsync(10);
  await processing;
  expect(f.outbox.markFailed).toHaveBeenCalledWith({ id: 'held',
    error: 'delivery of outbox event "demo.event" (held) timed out after 10ms',
    nextAttemptAt: at(DEFAULT_OUTBOX_CLAIM_LEASE_MS), nextStatus: 'failed' });
  held.resolve();
  await vi.advanceTimersByTimeAsync(0);
});

test('the drainer forwards worker options to every drain', async () => {
  vi.useFakeTimers();
  const f = fixture([]);
  const drainer = startOutboxDrainer(f.args, { batchSize: 2, deliveryTimeoutMs: 1_000, claimLeaseMs: 5_000, intervalMs: 10 });
  await vi.advanceTimersByTimeAsync(0);
  expect(f.outbox.claimPending).toHaveBeenCalledWith({ batchSize: 2, nowIso: NOW, claimLeaseMs: 5_000 });
  await drainer.stop();
});
