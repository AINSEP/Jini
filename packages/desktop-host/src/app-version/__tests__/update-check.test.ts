/** Update-check controller: one check at a time, `onDone` always runs, failures reported without text from the caller. */
import { describe, expect, test, vi } from "vitest";
import { createUpdateCheck } from "../update-check.js";

const deferred = () => {
  let resolve!: () => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<void>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};
const noReport = () => undefined;

describe("createUpdateCheck", () => {
  test("is unavailable without the bridge method and a check is then a no-op", async () => {
    const onDone = vi.fn();
    for (const bridge of [{}, undefined]) {
      const check = createUpdateCheck({ bridge, onDone, report: noReport });
      expect(check.getSnapshot()).toEqual({ available: false, checking: false });
      await check.checkForUpdates();
    }
    expect(onDone).not.toHaveBeenCalled();
  });

  test("runs one check at a time: a second call while checking is ignored", async () => {
    const pending = deferred();
    let calls = 0;
    const onDone = vi.fn();
    const check = createUpdateCheck({ bridge: { checkForUpdates: () => { calls += 1; return pending.promise; } }, onDone, report: noReport });
    expect(check.getSnapshot()).toEqual({ available: true, checking: false });
    const first = check.checkForUpdates();
    expect(check.getSnapshot()).toEqual({ available: true, checking: true });
    await check.checkForUpdates();
    expect(calls).toBe(1);
    pending.resolve();
    await first;
    expect(check.getSnapshot()).toEqual({ available: true, checking: false });
    expect(onDone).toHaveBeenCalledOnce();
  });

  test("onDone runs after a rejection too, and the rejection is reported once by message", async () => {
    const onDone = vi.fn();
    const report = vi.fn();
    const check = createUpdateCheck({ bridge: { checkForUpdates: async () => { throw new Error("channel closed"); } }, onDone, report });
    await check.checkForUpdates();
    expect(report).toHaveBeenCalledTimes(1);
    expect(report).toHaveBeenCalledWith({ message: "channel closed" });
    expect(onDone).toHaveBeenCalledOnce();
    expect(check.getSnapshot().checking).toBe(false);
  });

  test("a non-Error rejection is reported as its string form", async () => {
    const report = vi.fn();
    const check = createUpdateCheck({ bridge: { checkForUpdates: () => Promise.reject("boom") }, onDone: noReport, report });
    await check.checkForUpdates();
    expect(report).toHaveBeenCalledTimes(1);
    expect(report).toHaveBeenCalledWith({ message: "boom" });
  });

  test("a success reports nothing and notifies subscribers of both state changes", async () => {
    const report = vi.fn();
    const check = createUpdateCheck({ bridge: { checkForUpdates: async () => undefined }, onDone: noReport, report });
    let notified = 0;
    const unsubscribe = check.subscribe(() => { notified += 1; });
    await check.checkForUpdates();
    expect(report).not.toHaveBeenCalled();
    expect(notified).toBe(2);
    unsubscribe();
    await check.checkForUpdates();
    expect(notified).toBe(2);
  });
});
