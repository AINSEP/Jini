import { describe, expect, it } from "vitest";

import { UnsupportedCapabilityError, type MigrationStep, type StorageKernel } from "../../storage.js";

type Tables = { t: { id: string } };

/** An in-memory kernel over a plain Map: the contract needs no query library. */
function memoryKernel(): StorageKernel<Map<string, unknown>, Tables> {
  const handle = new Map<string, unknown>();
  let depth = 0;
  return {
    dialect: "sqlite",
    transport: "memory",
    capabilities: { interactiveTransactions: true, atomicBatch: false, transactionalDdl: false, backup: false },
    ready: Promise.resolve(),
    run: async (fn) => fn(handle),
    transaction: async (fn) => {
      depth += 1;
      try {
        return await fn();
      } finally {
        depth -= 1;
      }
    },
    lockKey: async () => {},
    inTransaction: () => depth > 0,
    require(capability) {
      if (!this.capabilities[capability]) throw new UnsupportedCapabilityError(capability, this.transport);
    },
    backupTo: async () => {
      throw new UnsupportedCapabilityError("backup", "memory");
    },
    close: async () => {},
  };
}

describe("StorageKernel contract", () => {
  it("is implementable over a non-SQL handle and reports its transport as an open string", async () => {
    const kernel = memoryKernel();
    await kernel.run((handle) => handle.set("a", 1));
    expect(await kernel.run((handle) => handle.get("a"))).toBe(1);
    expect(kernel.transport).toBe("memory");
    expect(await kernel.transaction(async () => kernel.inTransaction())).toBe(true);
    expect(kernel.inTransaction()).toBe(false);
  });

  it("names the missing capability and transport when one is required", () => {
    const kernel = memoryKernel();
    expect(() => kernel.require("backup")).toThrow("the memory storage driver does not support backup");
    expect(() => kernel.require("interactiveTransactions")).not.toThrow();
  });

  it("types a migration step against any kernel", async () => {
    const calls: string[] = [];
    const step: MigrationStep<StorageKernel<Map<string, unknown>>> = {
      id: "0001_probe",
      checksum: "c",
      up: async (_kernel, context) => context.note("ran"),
    };
    await step.up(memoryKernel(), { note: (message) => calls.push(message) });
    expect(calls).toEqual(["ran"]);
  });
});
