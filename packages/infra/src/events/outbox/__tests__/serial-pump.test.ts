import { expect, test, vi } from 'vitest';
import { createSerialPump } from '../index.js';
import { deferredValue, manualScheduler } from './fenced-fixtures.js';

/** Flush promise-only loop bookkeeping without timers, servers or elapsed-time assertions. */
async function settle(): Promise<void> { for (let i = 0; i < 12; ++i) await Promise.resolve(); }

test('construction is inert, start is idempotent and every result waits the full interval', async () => {
  const manual = manualScheduler();
  const callback = vi.fn(async () => 1_000_000);
  const pump = createSerialPump({ scheduler: manual.scheduler, intervalMs: 25, callback });
  expect(manual.tasks).toEqual([]);
  pump.start({}); pump.start({}, {});
  expect(manual.tasks.map(task => task.delayMs)).toEqual([25]);
  expect(callback).not.toHaveBeenCalled();
  manual.tasks[0]!.callback();
  await settle();
  expect(callback).toHaveBeenCalledWith({}, {});
  expect(manual.tasks.map(task => task.delayMs)).toEqual([25, 25]);
  manual.tasks[1]!.callback();
  await settle();
  expect(callback).toHaveBeenCalledTimes(2);
  expect(manual.tasks.map(task => task.delayMs)).toEqual([25, 25, 25]);
  await pump.stop({});
});

test.each([false, true])('stop awaits the complete active callback (rejected=%s), then cannot restart', async rejected => {
  const manual = manualScheduler();
  const held = deferredValue<unknown>();
  const callback = vi.fn(() => held.promise);
  const onError = vi.fn();
  const pump = createSerialPump({ scheduler: manual.scheduler, intervalMs: 5, callback }, { onError });
  pump.start({});
  manual.tasks[0]!.callback();
  await settle();
  // Re-delivery of a consumed scheduler callback cannot overlap the complete host callback.
  manual.tasks[0]!.callback();
  await settle();
  expect(callback).toHaveBeenCalledTimes(1);
  expect(manual.tasks).toHaveLength(1);
  let stopped = false;
  const stopping = pump.stop({}).then(() => { stopped = true; });
  const repeatedStop = pump.stop({});
  await settle();
  expect(stopped).toBe(false);
  const error = new Error('callback rejected');
  if (rejected) held.reject(error); else held.resolve('settled');
  await Promise.all([stopping, repeatedStop]);
  expect(stopped).toBe(true);
  expect(onError.mock.calls).toEqual(rejected ? [[{ error }, {}]] : []);
  pump.start({});
  manual.tasks[0]!.callback();
  await settle();
  expect(callback).toHaveBeenCalledTimes(1);
  expect(manual.tasks).toHaveLength(1);
});

test.each(['throw', 'reject'] as const)('callback %s and a throwing reporter cannot stop the next interval', async failure => {
  const manual = manualScheduler();
  const error = new Error('callback failed');
  const callback = vi.fn((): Promise<unknown> => {
    if (failure === 'throw') throw error;
    return Promise.reject(error);
  });
  const onError = vi.fn(() => { throw new Error('reporter failed'); });
  const pump = createSerialPump({ scheduler: manual.scheduler, intervalMs: 7, callback }, { onError });
  pump.start({});
  manual.tasks[0]!.callback();
  await settle();
  expect(onError).toHaveBeenCalledWith({ error }, {});
  expect(manual.tasks.map(task => task.delayMs)).toEqual([7, 7]);
  callback.mockResolvedValueOnce(undefined);
  manual.tasks[1]!.callback();
  await settle();
  expect(callback).toHaveBeenCalledTimes(2);
  expect(manual.tasks[2]!.delayMs).toBe(7);
  await pump.stop({});
});

test('stop cancels queued work despite cancellation races and isolates sibling instances', async () => {
  const manual = manualScheduler();
  const first = vi.fn(async () => {});
  const second = vi.fn(async () => {});
  const a = createSerialPump({ scheduler: manual.scheduler, intervalMs: 1, callback: first });
  const b = createSerialPump({ scheduler: manual.scheduler, intervalMs: 2, callback: second });
  a.start({}); b.start({});
  await a.stop({});
  expect(manual.tasks[0]!.cancelled).toBe(true);
  expect(manual.tasks[1]!.cancelled).toBe(false);
  manual.tasks[0]!.callback(); manual.tasks[1]!.callback();
  await settle();
  expect(first).not.toHaveBeenCalled();
  expect(second).toHaveBeenCalledTimes(1);
  expect(manual.tasks[2]!.delayMs).toBe(2);
  await b.stop({});
  const neverStarted = createSerialPump({ scheduler: manual.scheduler, intervalMs: 1, callback: first });
  await neverStarted.stop({});
  neverStarted.start({});
  expect(manual.tasks).toHaveLength(3);
});

test('stop after a queued callback begins still awaits its complete promise', async () => {
  const manual = manualScheduler();
  const held = deferredValue<unknown>();
  const callback = vi.fn(() => held.promise);
  const pump = createSerialPump({ scheduler: manual.scheduler, intervalMs: 1, callback });
  pump.start({});
  manual.tasks[0]!.callback();
  // Stop before the host callback's first microtask: the already-published flight is still awaited.
  let stopped = false;
  const stopping = pump.stop({}).then(() => { stopped = true; });
  await settle();
  expect(callback).toHaveBeenCalledTimes(1);
  expect(stopped).toBe(false);
  held.resolve(undefined);
  await stopping;
  expect(manual.tasks).toHaveLength(1);
});

test('invalid intervals fail before scheduling, and omitted reporters tolerate rejection', async () => {
  const manual = manualScheduler();
  const callback = vi.fn(async () => { throw new Error('unreported'); });
  for (const intervalMs of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    expect(() => createSerialPump({ scheduler: manual.scheduler, intervalMs, callback })).toThrow(RangeError);
  }
  expect(manual.tasks).toEqual([]);
  const pump = createSerialPump({ scheduler: manual.scheduler, intervalMs: 3, callback });
  pump.start({});
  manual.tasks[0]!.callback();
  await settle();
  expect(manual.tasks.map(task => task.delayMs)).toEqual([3, 3]);
  await pump.stop({});
});
