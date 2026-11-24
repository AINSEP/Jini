import { describe, expect, test } from "vitest";
import { createMcpRosterChangeBus } from "../roster-change.js";

/**
 * @file Coverage for the roster-change bus's load-bearing properties: last-wins registration, the
 * `waitMs` cap, tolerance for a throwing listener, lowering's injected error, per-instance isolation
 * and reset. Moved from the host's notifier unit test; the host error class is replaced by a fake.
 */

class FakeLoweringError extends Error {
  constructor() { super("Tool access could not be confirmed stopped."); this.name = "FakeLoweringError"; }
}

const newBus = () => createMcpRosterChangeBus({ createLoweringError: () => new FakeLoweringError() });

describe("createMcpRosterChangeBus", () => {
  test("registering the same key twice keeps only the last listener, so one call", async () => {
    const bus = newBus();
    let firstCalls = 0;
    let secondCalls = 0;
    bus.on({ key: "agent-daemon", listener: () => { firstCalls += 1; } });
    bus.on({ key: "agent-daemon", listener: () => { secondCalls += 1; } });
    await bus.notify();
    expect(firstCalls).toBe(0);
    expect(secondCalls).toBe(1);
  });

  test("a listener that never resolves makes notify({waitMs: 20}) resolve within 200ms", async () => {
    const bus = newBus();
    let stuckCalls = 0;
    let healthyCalls = 0;
    let release!: () => void;
    bus.on({ key: "stuck", listener: () => { stuckCalls++; return new Promise<void>(resolve => { release = resolve; }); } });
    bus.on({ key: "healthy", listener: () => { healthyCalls++; } });
    const startedAt = Date.now();
    await bus.notify({ waitMs: 20 });
    const elapsedMs = Date.now() - startedAt;
    release();
    expect(stuckCalls).toBe(1);
    expect(healthyCalls).toBe(1);
    expect(elapsedMs).toBeLessThan(200);
  });

  test("a throwing listener does not reject notify", async () => {
    const bus = newBus();
    bus.on({ key: "throws-sync", listener: () => { throw new Error("boom"); } });
    bus.on({ key: "rejects-async", listener: async () => { throw new Error("also boom"); } });
    let healthyCalls = 0;
    bus.on({ key: "healthy", listener: () => { healthyCalls++; } });
    await expect(bus.notify()).resolves.toBeUndefined();
    expect(healthyCalls).toBe(1);
  });

  test("lowering carries source IDs, waits for cleanup, and reports a failed stop as the injected error", async () => {
    const bus = newBus();
    let release!: () => void;
    const cleanup = new Promise<void>(resolve => { release = resolve; });
    let seen: unknown;
    bus.on({ key: "serving-app", listener: async change => { seen = change; await cleanup; } });
    let settled = false;
    const pending = bus.notify({ lowered: { serverIds: ["source"] } }).then(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(seen).toEqual({ serverIds: ["source"] });
    release();
    await pending;
    bus.on({ key: "serving-app", listener: async () => { throw new Error("cleanup failed"); } });
    const error = await bus.notify({ lowered: { pluginIds: ["mail"] } }).then(() => undefined, (err: unknown) => err);
    expect(error).toBeInstanceOf(FakeLoweringError);
    expect((error as Error).message).not.toContain("cleanup failed");
  });

  test("a synchronously throwing lowering listener also rejects as the injected error", async () => {
    const bus = newBus();
    bus.on({ key: "serving-app", listener: () => { throw new Error("sentinel"); } });
    await expect(bus.notify({ lowered: { agentIds: ["claude"] } })).rejects.toBeInstanceOf(FakeLoweringError);
  });

  test("a stuck lowering rejects instead of claiming the answer stopped", async () => {
    const bus = newBus();
    let release!: () => void;
    bus.on({ key: "serving-app", listener: () => new Promise<void>(resolve => { release = resolve; }) });
    await expect(bus.notify({ lowered: { agentIds: ["claude"] }, waitMs: 10 })).rejects.toBeInstanceOf(FakeLoweringError);
    release();
  });

  test("listeners are isolated per bus instance", async () => {
    const a = newBus();
    const b = newBus();
    let aCalls = 0;
    let bCalls = 0;
    a.on({ key: "same-key", listener: () => { aCalls++; } });
    b.on({ key: "same-key", listener: () => { bCalls++; } });
    await a.notify();
    expect(aCalls).toBe(1);
    expect(bCalls).toBe(0);
    await b.notify();
    expect(aCalls).toBe(1);
    expect(bCalls).toBe(1);
  });

  test("reset clears every listener", async () => {
    const bus = newBus();
    let calls = 0;
    bus.on({ key: "k", listener: () => { calls++; } });
    bus.reset();
    await bus.notify({ lowered: { agentIds: ["claude"] } });
    expect(calls).toBe(0);
  });

  test("defaultWaitMs bounds a notify call that passes no waitMs", async () => {
    const bus = createMcpRosterChangeBus({ createLoweringError: () => new FakeLoweringError(), defaultWaitMs: 10 });
    bus.on({ key: "stuck", listener: () => new Promise<void>(() => undefined) });
    await expect(bus.notify({ lowered: { agentIds: ["claude"] } })).rejects.toBeInstanceOf(FakeLoweringError);
  });
});
