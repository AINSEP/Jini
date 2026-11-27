import { expect, it, vi } from "vitest";

import { createTrashScheduler } from "../scheduler.node.js";

it("cancels only the selected purge deadline, including repeated and unknown cancellations", () => {
  vi.useFakeTimers();
  try {
    const scheduler = createTrashScheduler({});
    const runs: string[] = [];
    const discarded = scheduler.schedule({ delayMs: 30, run: () => runs.push("discarded") });
    const retained = scheduler.schedule({ delayMs: 50, run: () => runs.push("retained") });
    scheduler.cancel({ handle: discarded });
    scheduler.cancel({ handle: discarded });
    vi.advanceTimersByTime(49);
    expect(runs).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(runs).toEqual(["retained"]);
    scheduler.cancel({ handle: retained });
    const next = scheduler.schedule({ delayMs: 9, run: () => runs.push("next") });
    expect(next).not.toBe(retained);
    vi.advanceTimersByTime(9);
    expect(runs).toEqual(["retained", "next"]);
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    vi.useRealTimers();
  }
});

it("a native sweeper timer does not keep the host process alive", () => {
  const scheduler = createTrashScheduler({});
  const handle = scheduler.schedule({ delayMs: 60_000, run: () => { throw new Error("Expected cancellation before deadline"); } });
  try {
    expect((handle as NodeJS.Timeout).hasRef()).toBe(false);
  } finally {
    scheduler.cancel({ handle });
  }
});
