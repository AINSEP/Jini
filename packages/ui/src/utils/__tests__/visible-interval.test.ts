// @vitest-environment node
import assert from "node:assert/strict";
import { test, vi, afterEach } from "vitest";

import { startVisibleInterval } from "../visible-interval.js";
import type { IntervalTimers, VisibilitySource } from "../visible-interval.js";

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

function fakeDocument(initial: VisibilitySource["visibilityState"]): VisibilitySource & {
  set: (state: VisibilitySource["visibilityState"]) => void;
  listenerCount: () => number;
} {
  let state = initial;
  const listeners = new Set<() => void>();
  return {
    get visibilityState() {
      return state;
    },
    addEventListener: (_type, listener) => listeners.add(listener),
    removeEventListener: (_type, listener) => listeners.delete(listener),
    set(next) {
      state = next;
      for (const listener of [...listeners]) listener();
    },
    listenerCount: () => listeners.size,
  };
}

function fakeTimers(): IntervalTimers & { running: () => number; fire: () => void; periods: number[] } {
  const active = new Map<number, () => void>();
  let next = 1;
  const periods: number[] = [];
  return {
    periods,
    setInterval: ({ callback, ms }) => {
      periods.push(ms);
      active.set(next, callback);
      return next++;
    },
    clearInterval: ({ handle }) => {
      active.delete(handle as number);
    },
    running: () => active.size,
    fire: () => {
      for (const callback of [...active.values()]) callback();
    },
  };
}

test("ticks on its period while the window is visible", () => {
  const doc = fakeDocument("visible");
  const timers = fakeTimers();
  let ticks = 0;
  startVisibleInterval({ tick: () => ticks++, periodMs: 4000 }, { doc, timers });
  assert.equal(ticks, 0);
  assert.equal(timers.running(), 1);
  assert.deepEqual(timers.periods, [4000]);
  timers.fire();
  timers.fire();
  assert.equal(ticks, 2);
});

test("stops its timer when the window is hidden", () => {
  const doc = fakeDocument("visible");
  const timers = fakeTimers();
  let ticks = 0;
  startVisibleInterval({ tick: () => ticks++, periodMs: 4000 }, { doc, timers });
  doc.set("hidden");
  assert.equal(timers.running(), 0);
  timers.fire();
  assert.equal(ticks, 0);
});

test("starts with no timer when the window is already hidden", () => {
  const doc = fakeDocument("hidden");
  const timers = fakeTimers();
  startVisibleInterval({ tick: () => {}, periodMs: 4000 }, { doc, timers });
  assert.equal(timers.running(), 0);
});

test("ticks at once and resumes when the window is shown again", () => {
  const doc = fakeDocument("visible");
  const timers = fakeTimers();
  let ticks = 0;
  startVisibleInterval({ tick: () => ticks++, periodMs: 4000 }, { doc, timers });
  doc.set("hidden");
  doc.set("visible");
  assert.equal(ticks, 1, "a shown window catches up without waiting a whole period");
  assert.equal(timers.running(), 1);
  doc.set("visible");
  assert.equal(timers.running(), 1, "a repeated visible event does not stack a second timer");
});

test("the returned stop clears the timer and the listener", () => {
  const doc = fakeDocument("visible");
  const timers = fakeTimers();
  let ticks = 0;
  const stop = startVisibleInterval({ tick: () => ticks++, periodMs: 4000 }, { doc, timers });
  stop();
  assert.equal(timers.running(), 0);
  assert.equal(doc.listenerCount(), 0);
  doc.set("hidden");
  doc.set("visible");
  assert.equal(ticks, 0);
});

test("the default timers tick and stop clears them with an explicit source and no DOM", () => {
  vi.useFakeTimers();
  vi.stubGlobal("document", undefined);
  const doc = fakeDocument("visible");
  let ticks = 0;
  const stop = startVisibleInterval({ tick: () => { ticks += 1; }, periodMs: 5 }, { doc });
  vi.advanceTimersByTime(40);
  assert.equal(ticks, 8);
  stop();
  vi.advanceTimersByTime(30);
  assert.equal(ticks, 8);
  assert.equal(vi.getTimerCount(), 0);
});

test("defaults to the page document and the interval timer", () => {
  vi.useFakeTimers();
  vi.stubGlobal("document", fakeDocument("visible"));
  let ticks = 0;
  const stop = startVisibleInterval({ tick: () => { ticks++; }, periodMs: 1_000 });
  vi.advanceTimersByTime(2_500);
  assert.equal(ticks, 2);
  stop();
  vi.advanceTimersByTime(5_000);
  assert.equal(ticks, 2);
  assert.equal(vi.getTimerCount(), 0);
});
