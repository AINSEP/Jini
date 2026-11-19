import { afterEach, expect, it, vi } from "vitest";
import { createFindQueryScheduler, FIND_QUERY_SETTLE_MS } from "../../../core.js";

afterEach(() => vi.useRealTimers());

it("settles the newest query after 200ms and cancels replaced work", () => {
  vi.useFakeTimers();
  const first = vi.fn();
  const second = vi.fn();
  const scheduler = createFindQueryScheduler({});
  expect(FIND_QUERY_SETTLE_MS).toBe(200);
  scheduler.schedule({ run: first });
  vi.advanceTimersByTime(100);
  scheduler.schedule({ run: second });
  vi.advanceTimersByTime(199);
  expect(first).not.toHaveBeenCalled();
  expect(second).not.toHaveBeenCalled();
  vi.advanceTimersByTime(1);
  expect(second).toHaveBeenCalledTimes(1);
});

it("flush cancels its timer, reports pending work and permits reentrant scheduling", () => {
  vi.useFakeTimers();
  const next = vi.fn();
  const scheduler = createFindQueryScheduler({});
  expect(scheduler.flush()).toBe(false);
  scheduler.schedule({ run: () => scheduler.schedule({ run: next }) });
  expect(scheduler.flush()).toBe(true);
  expect(vi.getTimerCount()).toBe(1);
  vi.advanceTimersByTime(200);
  expect(next).toHaveBeenCalledTimes(1);
  expect(scheduler.flush()).toBe(false);
  scheduler.schedule({ run: next });
  scheduler.cancel();
  vi.advanceTimersByTime(200);
  expect(next).toHaveBeenCalledTimes(1);
});
