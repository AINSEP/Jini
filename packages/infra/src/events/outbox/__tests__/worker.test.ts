import { afterEach, expect, test, vi } from 'vitest';
import { computeOutboxBackoffMs, DEFAULT_OUTBOX_CLAIM_LEASE_MS, DEFAULT_OUTBOX_DELIVERY_TIMEOUT_MS,
  MAX_OUTBOX_ATTEMPTS, processOutbox } from '../index.js';
import { deferred, fixture, NOW, row } from './fixtures.js';

// Generalized from the source worker suite: port outcomes replace the host storage implementation.
afterEach(() => { vi.useRealTimers(); });

test('processOutbox publishes pending events unchanged and marks delivered', async () => {
  const record = row();
  const f = fixture([record]);
  expect(await processOutbox(f.args)).toBe(1);
  expect(f.outbox.claimPending).toHaveBeenCalledWith({ batchSize: 20, nowIso: NOW, claimLeaseMs: DEFAULT_OUTBOX_CLAIM_LEASE_MS });
  expect(f.bus.publish).toHaveBeenCalledWith({ event: record.event });
  expect(f.bus.publish.mock.calls[0]![0].event).toBe(record.event);
  expect(f.outbox.markDelivered).toHaveBeenCalledWith({ id: 'evt-1' });
  expect(f.outbox.markFailed).not.toHaveBeenCalled();
});

test('processOutbox respects optional batchSize and returns zero for an empty claim', async () => {
  const f = fixture([]);
  expect(await processOutbox(f.args, { batchSize: 1 })).toBe(0);
  expect(f.outbox.claimPending).toHaveBeenCalledWith({ batchSize: 1, nowIso: NOW, claimLeaseMs: DEFAULT_OUTBOX_CLAIM_LEASE_MS });
  expect(f.bus.publish).not.toHaveBeenCalled();
});

test.each([new Error('handler failed to execute'), 'literal string error'])('publish rejection records source error semantics: %s', async error => {
  const f = fixture();
  f.bus.publish.mockRejectedValueOnce(error);
  expect(await processOutbox(f.args)).toBe(1);
  expect(f.outbox.markFailed).toHaveBeenCalledWith({ id: 'evt-1', error: error instanceof Error ? error.message : 'unknown outbox error',
    nextAttemptAt: '2026-02-21T12:00:15.000Z', nextStatus: 'pending' });
});

test('synchronous publisher throws are captured and the next row still delivers', async () => {
  const f = fixture([row('bad'), row('good')]);
  f.bus.publish.mockImplementationOnce(() => { throw new Error('sync failure'); });
  expect(await processOutbox(f.args)).toBe(2);
  expect(f.outbox.markFailed).toHaveBeenCalledWith(expect.objectContaining({ id: 'bad', error: 'sync failure' }));
  expect(f.outbox.markDelivered).toHaveBeenCalledWith({ id: 'good' });
});

test('MAX_OUTBOX_ATTEMPTS is six and default lease outlasts every timeout in a full batch', () => {
  expect(MAX_OUTBOX_ATTEMPTS).toBe(6);
  expect(DEFAULT_OUTBOX_CLAIM_LEASE_MS).toBeGreaterThan(20 * DEFAULT_OUTBOX_DELIVERY_TIMEOUT_MS);
});

test('equal jitter stays within the source exponential envelope and caps at thirty minutes', () => {
  // Copied source formula assertions, generalized to the required argument object.
  const steps = [30_000, 60_000, 120_000, 240_000, 480_000, 960_000];
  for (const [index, step] of steps.entries()) {
    expect(computeOutboxBackoffMs({ attempts: index + 1, random: () => 0 })).toBe(step / 2);
    expect(computeOutboxBackoffMs({ attempts: index + 1, random: () => 0.5 })).toBe(step * 0.75);
    expect(computeOutboxBackoffMs({ attempts: index + 1, random: () => 1 })).toBe(step);
  }
  expect(computeOutboxBackoffMs({ attempts: 20, random: () => 0 })).toBe(900_000);
  expect(computeOutboxBackoffMs({ attempts: 20, random: () => 1 })).toBe(1_800_000);
});

test('failure at the attempt cap is terminal; a claim past the cap seals without publishing', async () => {
  const capped = fixture([row('capped', 6)]);
  capped.bus.publish.mockRejectedValue(new Error('poison'));
  await processOutbox(capped.args);
  expect(capped.outbox.markFailed).toHaveBeenCalledWith(expect.objectContaining({ id: 'capped', nextStatus: 'failed' }));
  const expired = fixture([row('crasher', 7)]);
  await processOutbox(expired.args);
  expect(expired.bus.publish).not.toHaveBeenCalled();
  expect(expired.outbox.markFailed).toHaveBeenCalledWith({ id: 'crasher',
    error: 'claimed 7 times; the last claim expired with no recorded outcome (its claimer likely died mid-delivery)',
    nextAttemptAt: NOW, nextStatus: 'failed' });
});

test('retry anchors to the failure instant instead of the earlier claim time', async () => {
  const f = fixture();
  let now = NOW;
  f.args.clock = { nowMs: () => Date.parse(now) };
  f.bus.publish.mockImplementationOnce(async () => { now = '2026-02-21T13:00:00.000Z'; throw new Error('slow failure'); });
  await processOutbox(f.args);
  expect(f.outbox.markFailed).toHaveBeenCalledWith(expect.objectContaining({ nextAttemptAt: '2026-02-21T13:00:15.000Z' }));
});

test('markDelivered failure falls through to the ordinary retry policy', async () => {
  const f = fixture();
  f.outbox.markDelivered.mockRejectedValueOnce(new Error('storage error'));
  await processOutbox(f.args);
  expect(f.outbox.markFailed).toHaveBeenCalledWith(expect.objectContaining({ error: 'storage error', nextStatus: 'pending' }));
});

test('timeout records the lease horizon, does not block later rows, and late success writes delivered', async () => {
  vi.useFakeTimers();
  const f = fixture([row('held'), row('after')]);
  const held = deferred();
  f.bus.publish.mockImplementationOnce(() => held.promise);
  const processing = processOutbox(f.args, { deliveryTimeoutMs: 10 });
  await vi.advanceTimersByTimeAsync(10);
  expect(await processing).toBe(2);
  expect(f.outbox.markFailed).toHaveBeenCalledWith({ id: 'held',
    error: 'delivery of outbox event "demo.event" (held) timed out after 10ms',
    nextAttemptAt: '2026-02-21T12:30:00.000Z', nextStatus: 'pending' });
  expect(f.outbox.markDelivered).toHaveBeenCalledWith({ id: 'after' });
  held.resolve();
  await vi.advanceTimersByTimeAsync(0);
  expect(f.outbox.markDelivered).toHaveBeenCalledWith({ id: 'held' });
});

test('late rejection replaces a timeout with an ordinary backed-off failure', async () => {
  vi.useFakeTimers();
  const f = fixture();
  const held = deferred();
  f.bus.publish.mockImplementationOnce(() => held.promise);
  const processing = processOutbox(f.args, { deliveryTimeoutMs: 10 });
  await vi.advanceTimersByTimeAsync(10);
  await processing;
  held.reject(new Error('late handler failure'));
  await vi.advanceTimersByTimeAsync(0);
  expect(f.outbox.markFailed).toHaveBeenLastCalledWith({ id: 'evt-1', error: 'late handler failure',
    nextAttemptAt: '2026-02-21T12:00:15.000Z', nextStatus: 'pending' });
});

test('a publish settling during the timeout write must record its outcome after that write', async () => {
  vi.useFakeTimers();
  const f = fixture();
  const publishing = deferred();
  const writing = deferred();
  const order: string[] = [];
  f.bus.publish.mockImplementationOnce(() => publishing.promise);
  f.outbox.markFailed.mockImplementationOnce(async () => { order.push('timeout.start'); await writing.promise; order.push('timeout.done'); });
  f.outbox.markDelivered.mockImplementationOnce(async () => { order.push('delivered'); });
  const processing = processOutbox(f.args, { deliveryTimeoutMs: 10 });
  await vi.advanceTimersByTimeAsync(10);
  publishing.resolve();
  await vi.advanceTimersByTimeAsync(0);
  expect(order).toEqual(['timeout.start']);
  writing.resolve();
  await processing;
  await vi.advanceTimersByTimeAsync(0);
  expect(order).toEqual(['timeout.start', 'timeout.done', 'delivered']);
});

test('late storage failure reaches injected logger; a throwing logger causes no background rejection', async () => {
  vi.useFakeTimers();
  const f = fixture();
  const held = deferred();
  f.bus.publish.mockImplementationOnce(() => held.promise);
  f.outbox.markDelivered.mockRejectedValue(new Error('delivery write'));
  f.outbox.markFailed.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('retry write'));
  f.logger.error.mockImplementation(() => { throw new Error('logger broken'); });
  const processing = processOutbox(f.args, { deliveryTimeoutMs: 10 });
  await vi.advanceTimersByTimeAsync(10);
  await processing;
  held.resolve();
  await vi.advanceTimersByTimeAsync(0);
  expect(f.logger.error).toHaveBeenCalledWith({
    message: '[outbox-worker] could not record the late outcome of outbox event "demo.event" (evt-1)',
  }, { error: expect.objectContaining({ message: 'retry write' }) });
});

test('a timeout write failure is surfaced while its late handler remains observed', async () => {
  vi.useFakeTimers();
  const f = fixture();
  const held = deferred();
  f.bus.publish.mockImplementationOnce(() => held.promise);
  f.outbox.markFailed.mockRejectedValueOnce(new Error('timeout write failed'));
  const processing = processOutbox(f.args, { deliveryTimeoutMs: 10 });
  const rejected = expect(processing).rejects.toThrow('timeout write failed');
  await vi.advanceTimersByTimeAsync(10);
  await rejected;
  held.resolve();
  await vi.advanceTimersByTimeAsync(0);
  expect(f.outbox.markDelivered).toHaveBeenCalledWith({ id: 'evt-1' });
});

test('claim tokens accompany normal, timeout and late writes', async () => {
  vi.useFakeTimers();
  const f = fixture([{ ...row(), claimToken: 'lease-1' }]);
  const held = deferred();
  f.bus.publish.mockImplementationOnce(() => held.promise);
  const processing = processOutbox(f.args, { deliveryTimeoutMs: 10 });
  await vi.advanceTimersByTimeAsync(10);
  await processing;
  expect(f.outbox.markFailed).toHaveBeenCalledWith(expect.objectContaining({ claimToken: 'lease-1' }));
  held.resolve();
  await vi.advanceTimersByTimeAsync(0);
  expect(f.outbox.markDelivered).toHaveBeenCalledWith({ id: 'evt-1', claimToken: 'lease-1' });
});

test('invalid bounds reject before claiming; invalid randomness and attempts reject explicitly', async () => {
  const f = fixture();
  for (const options of [{ batchSize: 0 }, { deliveryTimeoutMs: -1 }, { batchSize: 40 }, { claimLeaseMs: 1 }]) {
    await expect(processOutbox(f.args, options)).rejects.toThrow(RangeError);
  }
  expect(f.outbox.claimPending).not.toHaveBeenCalled();
  expect(() => computeOutboxBackoffMs({ attempts: 0, random: () => 0 })).toThrow(RangeError);
  expect(() => computeOutboxBackoffMs({ attempts: 1, random: () => NaN })).toThrow(RangeError);
});
