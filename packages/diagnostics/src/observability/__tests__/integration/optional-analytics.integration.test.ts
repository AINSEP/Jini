import { describe, expect, it, vi } from "vitest";
import { createNoopTracker } from "../../tracker-noop.js";
import { createNoopObservabilityPort } from "../../noop.js";
import type { ErrorReport } from "../../ports.js";

const analytics = vi.hoisted(() => ({
  load: vi.fn(() => {
    throw Object.assign(new Error("@jini-ai/analytics is not installed"), { code: "ERR_MODULE_NOT_FOUND" });
  }),
}));
vi.mock("@jini-ai/analytics/product", () => analytics.load());

describe("optional analytics at the observability/node boundary", () => {
  // Guards tracker.ts's import boundary: restoring its analytics value import must reject here.
  it("imports the node entry without loading the unavailable analytics peer", async () => {
    const node = await import("../../node.js");
    expect(node.createTracker).toBeTypeOf("function");
    expect(analytics.load).not.toHaveBeenCalled();
  });

  // Guards createTracker's missing-provider branch and the existing shared no-op contract.
  it("returns the shared no-op without capabilities and runs work exactly once", async () => {
    const { createTracker } = await import("../../node.js");
    const tracker = createTracker({}, {});
    expect(tracker).toBe(createNoopTracker({}));
    expect(createTracker({ observability: createNoopObservabilityPort({}) })).toBe(tracker);
    expect(tracker.capture({ name: "app_started", userId: "principal-1" })).toBeUndefined();
    expect(tracker.error({ error: new Error("application error") })).toBeUndefined();
    expect(tracker.metric({ name: "queue.size", value: 2 })).toBeUndefined();
    expect(tracker.activeTraceIds?.()).toBeUndefined();
    const result = { id: "result-1" };
    const run = vi.fn(() => result);
    expect(await tracker.trace({ name: "deploy", run })).toBe(result);
    expect(run).toHaveBeenCalledTimes(1);
    const failure = new Error("application failed");
    await expect(tracker.trace({ name: "deploy", run: () => { throw failure; } })).rejects.toBe(failure);
  });

  it("records errors and spans with only an observability capability", async () => {
    const { createTracker } = await import("../../node.js");
    const reports: ErrorReport[] = [];
    const operations: string[] = [];
    const end = vi.fn();
    const tracker = createTracker({ observability: {
      ...createNoopObservabilityPort({}),
      reportError(report) { reports.push(report); },
      trackOperation({ name }) { operations.push(name); return { end, run: fn => fn() }; },
    } });
    await tracker.capture({ name: "app_started", userId: "principal-1" });
    const failure = new Error("application failed");
    tracker.error({ error: failure }, { context: { operation: "deploy" } });
    expect(await tracker.trace({ name: "deploy", run: () => 42 })).toBe(42);
    expect(reports).toEqual([{ error: failure, context: { operation: "deploy" } }]);
    expect(operations).toEqual(["deploy"]);
    expect(end.mock.calls).toEqual([[{ outcome: "completed", failed: false }]]);
    expect(analytics.load).not.toHaveBeenCalled();
  });

  // Guards createTracker's injected capture dispatch; no analytics implementation is loaded.
  it("delivers events and properties through the supplied analytics capability", async () => {
    const { createTracker } = await import("../../node.js");
    const capture = vi.fn();
    const tracker = createTracker({ productAnalytics: { capture, identify() {} } }, {});
    await tracker.capture({ name: "app_started", userId: "principal-1" });
    await tracker.capture({ name: "post_created", userId: "principal-2" }, { properties: { surface: "admin", count: 2 } });
    expect(capture.mock.calls).toEqual([
      [{ name: "app_started", userId: "principal-1" }],
      [{ name: "post_created", userId: "principal-2", properties: { surface: "admin", count: 2 } }],
    ]);
    expect(await tracker.trace({ name: "deploy", run: () => 42 })).toBe(42);
    expect(analytics.load).not.toHaveBeenCalled();
  });
});
