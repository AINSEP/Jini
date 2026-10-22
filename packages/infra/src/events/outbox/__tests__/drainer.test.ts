import { afterEach, expect, test, vi } from 'vitest';
import { startOutboxDrainer } from '../index.js';
import { deferred, fixture, row } from './fixtures.js';

// Generalized source drainer scheduling, error recovery, and stop characterization.
afterEach(() => { vi.useRealTimers(); });

test('first drain is deferred; a full batch drains again immediately then waits when idle', async () => {
  vi.useFakeTimers();
  const f = fixture([]);
  f.outbox.claimPending.mockResolvedValueOnce([row('first')]).mockResolvedValueOnce([row('second')]);
  const drainer = startOutboxDrainer(f.args, { batchSize: 1, intervalMs: 60_000 });
  expect(f.outbox.claimPending).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(3);
  expect(f.bus.publish.mock.calls.map(call => call[0].event.id)).toEqual(['first', 'second']);
  const idleClaims = f.outbox.claimPending.mock.calls.length;
  await vi.advanceTimersByTimeAsync(10);
  expect(f.outbox.claimPending).toHaveBeenCalledTimes(idleClaims);
  await drainer.stop();
});

test('idle loop discovers work queued later', async () => {
  vi.useFakeTimers();
  const f = fixture([]);
  const drainer = startOutboxDrainer(f.args, { intervalMs: 10 });
  await vi.advanceTimersByTimeAsync(1);
  expect(f.bus.publish).not.toHaveBeenCalled();
  f.outbox.claimPending.mockResolvedValueOnce([row('late')]);
  await vi.advanceTimersByTimeAsync(10);
  expect(f.bus.publish).toHaveBeenCalledWith({ event: row('late').event });
  await drainer.stop();
});

test('new work cannot start another drain while the first delivery is held; stop waits for it', async () => {
  vi.useFakeTimers();
  const f = fixture([]);
  f.outbox.claimPending.mockResolvedValueOnce([row('first')]).mockResolvedValueOnce([row('second')]);
  const held = deferred();
  f.bus.publish.mockImplementationOnce(() => held.promise);
  const drainer = startOutboxDrainer(f.args, { batchSize: 1, intervalMs: 10 });
  await vi.advanceTimersByTimeAsync(100);
  expect(f.bus.publish.mock.calls.map(call => call[0].event.id)).toEqual(['first']);
  expect(f.outbox.claimPending).toHaveBeenCalledTimes(1);
  let stopped = false;
  const stopping = drainer.stop().then(() => { stopped = true; });
  await vi.advanceTimersByTimeAsync(0);
  expect(stopped).toBe(false);
  held.resolve();
  await stopping;
  await drainer.stop();
  await vi.advanceTimersByTimeAsync(100);
  expect(f.bus.publish.mock.calls.map(call => call[0].event.id)).toEqual(['first']);
});

test.each([false, true])('a failed drain reports and survives a throwing reporter=%s', async throws => {
  vi.useFakeTimers();
  const f = fixture([]);
  f.outbox.claimPending.mockRejectedValueOnce(new Error('database is locked')).mockResolvedValueOnce([row('after-error')]);
  const onError = vi.fn(() => { if (throws) throw new Error('reporter'); });
  const drainer = startOutboxDrainer(f.args, { intervalMs: 5, onError });
  await vi.advanceTimersByTimeAsync(6);
  expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'database is locked' }));
  expect(f.bus.publish).toHaveBeenCalledWith({ event: row('after-error').event });
  await drainer.stop();
});

test('default error reporting uses the logger; stop cancels even an already queued callback', async () => {
  vi.useFakeTimers();
  const f = fixture([]);
  f.outbox.claimPending.mockRejectedValueOnce(new Error('claim failed'));
  const drainer = startOutboxDrainer(f.args);
  await vi.advanceTimersByTimeAsync(0);
  expect(f.logger.error).toHaveBeenCalledWith(expect.objectContaining({ message: expect.any(String) }), { error: expect.objectContaining({ message: 'claim failed' }) });
  await drainer.stop();
  await vi.advanceTimersByTimeAsync(2_000);
  expect(f.outbox.claimPending).toHaveBeenCalledTimes(1);
  let callback!: () => void;
  f.args.scheduler = { schedule(args) { callback = args.callback; return { cancel() {} }; } };
  const queued = startOutboxDrainer(f.args);
  await queued.stop();
  callback();
  expect(f.outbox.claimPending).toHaveBeenCalledTimes(1);
});

test('invalid intervals reject before scheduling', () => {
  const f = fixture();
  expect(() => startOutboxDrainer(f.args, { intervalMs: -1 })).toThrow(RangeError);
});
