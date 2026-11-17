import { describe, expect, it } from "vitest";
import { captureBudget } from "../capture-budget.js";

const LIMITS = { baseMs: 20_000, fullPageMs: 15_000, capMs: 60_000, reserveMs: 4_000 };

describe("captureBudget", () => {
  it("gives a plain first-screen capture the base time, with the reserve held back for the fallback", () => {
    expect(captureBudget({ settleMs: 0, fullPage: false }, LIMITS)).toEqual({ totalMs: 20_000, softDeadlineMs: 16_000, reserveMs: 4_000 });
  });

  it("grows with a longer settle, a requested wait in seconds, and a full-page scroll", () => {
    expect(captureBudget({ settleMs: 3_000, fullPage: false }, LIMITS).totalMs).toBe(23_000);
    expect(captureBudget({ fullPage: false, waitForSeconds: 8 }, LIMITS).totalMs).toBe(28_000);
    expect(captureBudget({ settleMs: 0, fullPage: true }, LIMITS)).toEqual({ totalMs: 35_000, softDeadlineMs: 31_000, reserveMs: 4_000 });
  });

  it("lets a requested wait in seconds replace the settle instead of adding to it", () => {
    expect(captureBudget({ settleMs: 5_000, fullPage: false, waitForSeconds: 2 }, LIMITS).totalMs).toBe(22_000);
  });

  it("never exceeds the host cap, and keeps the soft deadline reserve below the capped total", () => {
    expect(captureBudget({ settleMs: 10_000, fullPage: true, waitForSeconds: 100 }, LIMITS)).toEqual({ totalMs: 60_000, softDeadlineMs: 56_000, reserveMs: 4_000 });
    expect(captureBudget({ settleMs: 5_000, fullPage: true }, { ...LIMITS, capMs: 20_000 })).toEqual({ totalMs: 20_000, softDeadlineMs: 16_000, reserveMs: 4_000 });
  });

  it.each([
    ["negative settle", { settleMs: -5_000, fullPage: false }],
    ["NaN settle", { settleMs: Number.NaN, fullPage: false }],
    ["negative wait", { fullPage: false, waitForSeconds: -3 }],
    ["NaN wait", { fullPage: false, waitForSeconds: Number.NaN }],
    ["infinite settle", { settleMs: Number.POSITIVE_INFINITY, fullPage: false }],
  ])("treats a %s as no extra time: the base", (_name, request) => {
    expect(captureBudget(request, LIMITS)).toEqual({ totalMs: 20_000, softDeadlineMs: 16_000, reserveMs: 4_000 });
  });

  it.each([
    ["equal to the total", 20_000],
    ["above the total", 25_000],
    ["zero", 0],
    ["negative", -1],
    ["NaN", Number.NaN],
  ])("refuses a reserve %s, which would leave no work time or no fallback", (_name, reserveMs) => {
    const call = () => captureBudget({ settleMs: 0, fullPage: false }, { ...LIMITS, reserveMs });
    expect(call).toThrow(RangeError);
    expect(call).toThrow(`capture reserve ${reserveMs}ms must be above 0 and below the capture total 20000ms`);
  });

  it("refuses a reserve that the cap makes as long as the whole capture", () => {
    expect(() => captureBudget({ settleMs: 0, fullPage: false }, { ...LIMITS, capMs: 4_000 }))
      .toThrow("capture reserve 4000ms must be above 0 and below the capture total 4000ms");
  });
});
