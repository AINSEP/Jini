/**
 * @file Phase-A proof of the per-event retry-policy resolver: a resolved policy changes the
 * schedule, cap and retryability of its own events only, and a broken resolver or policy can never
 * wedge a row (it falls back to the default policy and is reported).
 */
import { afterEach, expect, test, vi } from 'vitest';
import { processOutbox, startOutboxDrainer, type OutboxRetryPolicyResolver } from '../index.js';
import { deferred, fixture, NOW, row } from './fixtures.js';

afterEach(() => { vi.useRealTimers(); });

const at = (offsetMs: number): string => new Date(Date.parse(NOW) + offsetMs).toISOString();

test('a resolved policy sets the delay, cap and terminal errors of its event only', async () => {
  const resolver: OutboxRetryPolicyResolver = ({ event }) => event.name === 'demo.event'
    ? { maxAttempts: 12, backoffMs: ({ attempts }) => attempts * 1_000, retryable: ({ error }) => !(error instanceof TypeError) }
    : undefined;
  const f = fixture([row('retry', 6), row('fatal', 1), { ...row('other', 6), event: { ...row().event, name: 'other.event' } }]);
  f.bus.publish.mockRejectedValueOnce(new Error('offline')).mockRejectedValueOnce(new TypeError('bad config'))
    .mockRejectedValueOnce(new Error('offline'));
  await processOutbox(f.args, { retryPolicyForEvent: resolver });
  expect(f.outbox.markFailed.mock.calls.map(([call]) => [call.id, call.nextAttemptAt, call.nextStatus])).toEqual([
    ['retry', at(6_000), 'pending'], ['fatal', at(1_000), 'failed'], ['other', at(480_000), 'failed'],
  ]);
});

test('a throwing resolver or an invalid policy falls back to the default policy and is reported', async () => {
  const broken: OutboxRetryPolicyResolver[] = [
    () => { throw new Error('resolver bug'); },
    () => ({ maxAttempts: 0, backoffMs: () => 1_000 }),
    () => ({ maxAttempts: 12, backoffMs: () => Number.NaN }),
  ];
  for (const resolver of broken) {
    const f = fixture([row('evt', 6)]);
    f.bus.publish.mockRejectedValueOnce(new Error('offline'));
    await processOutbox(f.args, { retryPolicyForEvent: resolver });
    expect(f.outbox.markFailed).toHaveBeenCalledWith({ id: 'evt', error: 'offline', nextAttemptAt: at(480_000), nextStatus: 'failed' });
    expect(f.logger.error).toHaveBeenCalledWith({
      message: '[outbox-worker] the retry policy for outbox event "demo.event" (evt) failed; using the default policy for this row',
    }, { error: expect.any(Error) });
  }
});

test('a custom policy governs the over-cap seal, the timeout status and the late outcome', async () => {
  vi.useFakeTimers();
  const f = fixture([row('held', 7)]);
  const held = deferred();
  f.bus.publish.mockImplementationOnce(() => held.promise);
  const processing = processOutbox(f.args, { deliveryTimeoutMs: 10, retryPolicyForEvent: () => ({ maxAttempts: 12, backoffMs: () => 1_000 }) });
  await vi.advanceTimersByTimeAsync(10);
  await processing;
  expect(f.outbox.markFailed).toHaveBeenCalledWith({ id: 'held', error: 'delivery of outbox event "demo.event" (held) timed out after 10ms',
    nextAttemptAt: at(30 * 60 * 1000), nextStatus: 'pending' });
  held.reject(new Error('late failure'));
  await vi.advanceTimersByTimeAsync(0);
  expect(f.outbox.markFailed).toHaveBeenLastCalledWith({ id: 'held', error: 'late failure', nextAttemptAt: at(1_000), nextStatus: 'pending' });
});

test('the drainer keeps the resolver through its resolved options', async () => {
  vi.useFakeTimers();
  const f = fixture([]);
  f.outbox.claimPending.mockResolvedValueOnce([row('evt', 6)]);
  f.bus.publish.mockRejectedValueOnce(new Error('offline'));
  const drainer = startOutboxDrainer(f.args, { retryPolicyForEvent: () => ({ maxAttempts: 12, backoffMs: () => 1_000 }) });
  await vi.advanceTimersByTimeAsync(0);
  expect(f.outbox.markFailed).toHaveBeenCalledWith({ id: 'evt', error: 'offline', nextAttemptAt: at(1_000), nextStatus: 'pending' });
  await drainer.stop();
});
