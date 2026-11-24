// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useRevealedKeyCopy, type RevealedKeyScheduler } from "../SiteKeyTab.hooks.js";

const HEX = "ab".repeat(32);

/** A scheduler that fires only when the test says so, recording every requested delay. */
function fakeScheduler() {
  const pending = new Map<number, () => void>();
  const delays: number[] = [];
  let next = 0;
  const scheduler: RevealedKeyScheduler = {
    setTimeout: (callback, ms) => { next += 1; delays.push(ms); pending.set(next, callback); return next; },
    clearTimeout: (handle) => { pending.delete(handle as number); },
  };
  return { scheduler, delays, pending, fireAll: () => { for (const [id, run] of [...pending]) { pending.delete(id); run(); } } };
}

describe("useRevealedKeyCopy", () => {
  it("writes the exact revealed hex through the injected clipboard and resets Copied after 1500 ms", async () => {
    const writeText = vi.fn(async () => {});
    const timers = fakeScheduler();
    const { result } = renderHook(() => useRevealedKeyCopy({ hex: HEX, clipboard: { writeText }, scheduler: timers.scheduler }));
    expect(result.current.copied).toBe(false);
    await act(async () => result.current.copy());
    expect(writeText).toHaveBeenCalledWith(HEX);
    expect(result.current.copied).toBe(true);
    expect(timers.delays).toEqual([1500]);
    act(() => timers.fireAll());
    expect(result.current.copied).toBe(false);
  });

  it("swallows a denied clipboard: nothing marked copied and no reset scheduled", async () => {
    const writeText = vi.fn(async () => { throw new DOMException("denied", "NotAllowedError"); });
    const timers = fakeScheduler();
    const { result } = renderHook(() => useRevealedKeyCopy({ hex: HEX, clipboard: { writeText }, scheduler: timers.scheduler }));
    await act(async () => result.current.copy());
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(result.current.copied).toBe(false);
    expect(timers.delays).toEqual([]);
  });

  it("restarts the window on a second copy and cancels a pending reset on unmount", async () => {
    const timers = fakeScheduler();
    const { result, unmount } = renderHook(() => useRevealedKeyCopy({ hex: HEX, clipboard: { writeText: async () => {} }, scheduler: timers.scheduler }));
    await act(async () => result.current.copy());
    await act(async () => result.current.copy());
    expect(timers.delays).toEqual([1500, 1500]);
    expect(timers.pending.size).toBe(1);
    unmount();
    expect(timers.pending.size).toBe(0);
  });
});
