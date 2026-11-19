import { afterEach, expect, test, vi } from "vitest";
import { createFindQueryScheduler, FIND_QUERY_SETTLE_MS } from "../../../core.js";

afterEach(() => { vi.useRealTimers(); });

test("fast typing runs only the newest query after settling; cancel and flush clear pending timers", () => {
  const timers = new Map<number, () => void>();
  let next = 0;
  const scheduler = createFindQueryScheduler({}, { clock: {
    schedule: ({ callback, delay }) => { expect(delay).toBe(200); timers.set(++next, callback); return next; },
    cancel: ({ timer }) => { timers.delete(timer as number); },
  } });
  const runs: string[] = [];
  expect(FIND_QUERY_SETTLE_MS).toBe(200);
  for (let length = 1; length <= "Plugin API".length; length++) {
    const text = "Plugin API".slice(0, length);
    scheduler.schedule({ run: () => { runs.push(text); } });
    expect(runs).toEqual([]);
    expect(timers.size).toBe(1);
  }
  for (const callback of [...timers.values()]) callback();
  expect(runs).toEqual(["Plugin API"]);
  scheduler.schedule({ run: () => { runs.push("cancelled"); } });
  scheduler.cancel();
  expect(timers.size).toBe(0);
  expect(scheduler.flush()).toBe(false);
  scheduler.schedule({ run: () => { runs.push("Enter"); } });
  expect(scheduler.flush()).toBe(true);
  expect(runs).toEqual(["Plugin API", "Enter"]);
  expect(timers.size).toBe(0);
});

test("the global clock cancels work and waits the full 200 ms before settling", () => {
  vi.useFakeTimers();
  const runs: string[] = [];
  const scheduler = createFindQueryScheduler({});
  scheduler.schedule({ run: () => { runs.push("cancelled"); } });
  scheduler.cancel();
  vi.advanceTimersByTime(200);
  expect(runs).toEqual([]);
  scheduler.schedule({ run: () => { runs.push("settled"); } });
  vi.advanceTimersByTime(199);
  expect(runs).toEqual([]);
  vi.advanceTimersByTime(1);
  expect(runs).toEqual(["settled"]);
  expect(scheduler.flush()).toBe(false);
});

test("a callback can schedule a new query because cancellation precedes invocation", () => {
  vi.useFakeTimers();
  const scheduler = createFindQueryScheduler({});
  const runs: string[] = [];
  scheduler.schedule({ run: () => {
    runs.push("first");
    scheduler.schedule({ run: () => { runs.push("second"); } });
  } });
  expect(scheduler.flush()).toBe(true);
  expect(runs).toEqual(["first"]);
  expect(vi.getTimerCount()).toBe(1);
  vi.advanceTimersByTime(200);
  expect(runs).toEqual(["first", "second"]);
  expect(scheduler.flush()).toBe(false);
});
