import { describe, expect, it } from "vitest";
import { buildKernel, type KernelDriver } from "../kernel/kernel-core.js";

/** L2 §4 kernel-core: the own-transaction counter that decides whether a call may JOIN a foreign
 *  (legacy) transaction is incremented for the body and restored after success AND failure, and
 *  `close()` delegates to the driver. DI fake driver; no database. */
function fakeDriver() {
  const calls: string[] = [];
  let foreign = false;
  const driver = {
    dialect: "sqlite", transport: "fake", ready: Promise.resolve(), base: {} as never, oneConnection: false,
    capabilities: { interactiveTransactions: true, atomicBatch: true, transactionalDdl: true, backup: false } as never,
    begin: async <T>(body: (tx: never) => Promise<T>) => { calls.push("begin"); return body({} as never); },
    lockKey: async () => undefined,
    foreignTransactionOpen: () => foreign,
    close: async () => { calls.push("close"); },
  } as unknown as KernelDriver<unknown>;
  return { driver, calls, setForeign: (value: boolean) => { foreign = value; } };
}

describe("buildKernel foreign-transaction join", () => {
  it("joins an open foreign transaction instead of BEGINning", async () => {
    const f = fakeDriver(); const kernel = buildKernel(f.driver);
    f.setForeign(true);
    await expect(kernel.transaction(async () => 1)).resolves.toBe(1);
    expect(f.calls).toEqual([]);
  });
  it("inside its own transaction a nested call never treats it as foreign; after success the counter is restored", async () => {
    const f = fakeDriver(); const kernel = buildKernel(f.driver);
    await kernel.transaction(async () => { f.setForeign(true); return 0; });
    expect(f.calls).toEqual(["begin"]);
    await kernel.transaction(async () => 2);
    expect(f.calls).toEqual(["begin"]); // counter back to 0: the foreign transaction is joined
  });
  it("the counter is also restored after the body throws", async () => {
    const f = fakeDriver(); const kernel = buildKernel(f.driver);
    await expect(kernel.transaction(async () => { throw new Error("boom"); })).rejects.toThrow("boom");
    f.setForeign(true);
    await kernel.transaction(async () => 3);
    expect(f.calls).toEqual(["begin"]);
  });
  it("a concurrent call while our own transaction is open does not join the foreign one", async () => {
    const f = fakeDriver(); const kernel = buildKernel(f.driver);
    let release!: () => void;
    const held = kernel.transaction(() => new Promise<void>((resolve) => { release = resolve; }));
    await new Promise((r) => setImmediate(r));
    f.setForeign(true);
    const other = kernel.transaction(async () => "second");
    release();
    await held;
    await expect(other).resolves.toBe("second");
    expect(f.calls).toEqual(["begin", "begin"]);
  });
  it("close delegates to the driver", async () => {
    const f = fakeDriver(); await buildKernel(f.driver).close();
    expect(f.calls).toEqual(["close"]);
  });
});
