import { afterEach, expect, test, vi } from 'vitest';
import { startOutboxDrainer } from '../index.js';
import { fixture, row } from './fixtures.js';

afterEach(() => { vi.useRealTimers(); });

test('samples the durable depth after each drain without changing settlement', async () => {
  vi.useFakeTimers();
  for (const rejectFirst of [false, true]) {
    const pending = [row('first'), row('second')];
    const f = fixture([]);
    f.outbox.claimPending.mockImplementation(async () => pending.splice(0, 1));
    let drain!: () => void;
    // Delivery also schedules its own timeout timer; only zero-delay loop ticks are drains here.
    const schedule = vi.fn(({ delayMs, callback }: { delayMs: number; callback: () => void }) => {
      if (delayMs === 0) drain = callback;
      return { cancel: vi.fn() };
    });
    const drainTicks = () => schedule.mock.calls.filter(([call]) => call.delayMs === 0).length;
    f.args.scheduler = { schedule };
    const readDepth = vi.fn(async () => pending.length);
    if (rejectFirst) readDepth.mockRejectedValueOnce(new Error('sample unavailable'));
    const metric = vi.fn();
    const onError = vi.fn();
    const drainer = startOutboxDrainer(f.args, { batchSize: 1, onError, queueMetrics: { readDepth, metric } });
    for (let i = 0; i < 2; i += 1) {
      drain();
      await vi.advanceTimersByTimeAsync(0);
      expect(f.outbox.markDelivered).toHaveBeenCalledTimes(i + 1);
      expect(drainTicks()).toBe(i + 2);
    }
    expect(metric.mock.calls).toEqual((rejectFirst ? [0] : [1, 0]).map(value => [
      { name: 'outbox.queue_depth', value }, { kind: 'gauge' },
    ]));
    expect(readDepth.mock.calls).toEqual([[{}], [{}]]);
    expect(f.bus.publish.mock.calls.map(call => call[0].event.id)).toEqual(['first', 'second']);
    expect(f.outbox.markDelivered.mock.calls.map(call => call[0].id)).toEqual(['first', 'second']);
    expect(f.outbox.markFailed).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
    expect(f.logger.error).not.toHaveBeenCalled();
    await drainer.stop();
  }
});
