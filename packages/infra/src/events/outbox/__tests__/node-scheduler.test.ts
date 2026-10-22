import { afterEach, expect, test, vi } from 'vitest';
import { createNodeOutboxScheduler } from '../index.js';

afterEach(() => vi.useRealTimers());

test('zero-delay work is deferred and cancellation is idempotent', () => {
  vi.useFakeTimers();
  const scheduler = createNodeOutboxScheduler({}, {});
  const received: string[] = [];
  const cancelled = scheduler.schedule({ delayMs: 0, callback: () => { received.push('cancelled'); } });
  scheduler.schedule({ delayMs: 0, callback: () => { received.push('delivered'); } });
  expect(received).toEqual([]);
  cancelled.cancel();
  cancelled.cancel();
  vi.runAllTimers();
  expect(received).toEqual(['delivered']);
});

test('the default factory starts no work and honors the requested delay', () => {
  vi.useFakeTimers();
  const scheduler = createNodeOutboxScheduler({});
  expect(vi.getTimerCount()).toBe(0);
  let delivered = false;
  scheduler.schedule({ delayMs: 10, callback: () => { delivered = true; } });
  vi.advanceTimersByTime(9);
  expect(delivered).toBe(false);
  vi.advanceTimersByTime(1);
  expect(delivered).toBe(true);
});
