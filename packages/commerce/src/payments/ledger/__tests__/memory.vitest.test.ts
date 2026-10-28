import { describe, expect, test } from "vitest";
import { memoryPaymentsLedger } from "../repo.memory.js";
import { LedgerConstraintError } from "../repo.js";
import { ledgerContract, payment } from "./ledger-contract.js";

ledgerContract("memory", async () => ({ ledger: memoryPaymentsLedger(), close: async () => {} }));

describe("ledger error contract", () => {
  test.each(["unique", "foreign-key", "check"] as const)("a %s error preserves its table, identity and original cause", (kind) => {
    const cause = new Error("driver refusal");
    const error = new LedgerConstraintError({ kind, table: "commerce_payments" }, { cause });
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("LedgerConstraintError");
    expect(error.message).toBe(`ledger: ${kind} constraint violated on commerce_payments`);
    expect(error.kind).toBe(kind);
    expect(error.table).toBe("commerce_payments");
    expect(error.cause).toBe(cause);
    expect(new LedgerConstraintError({ kind, table: "commerce_refunds" }).cause).toBeUndefined();
  });
});

test("queued memory transactions observe prior commits in FIFO order without interleaving", async () => {
  const ledger = memoryPaymentsLedger({}, {});
  const events: string[] = [];
  let started!: () => void;
  let release!: () => void;
  const firstStarted = new Promise<void>((resolve) => { started = resolve; });
  const holdFirst = new Promise<void>((resolve) => { release = resolve; });
  const first = ledger.transaction({ fn: async (tx) => {
    events.push("first entered");
    await tx.insertPayment({ payment: payment() });
    started();
    await holdFirst;
    events.push("first committed");
    return 1;
  } }, {});
  await firstStarted;
  const second = ledger.transaction({ fn: async (tx) => {
    events.push("second entered");
    const current = await tx.lockPayment({ workspaceId: "ws-1", mode: "live", id: "pay-1" });
    expect(current).toEqual({ ...payment(), version: 1 });
    expect(await tx.updatePayment({ id: "pay-1", expectedVersion: 1, patch: { refundHeldMinor: 101, updatedAt: 2_000 } })).toBe(true);
    events.push("second committed");
    return 2;
  } });
  const third = ledger.transaction({ fn: async (tx) => {
    events.push("third entered");
    expect(await tx.lockPayment({ workspaceId: "ws-1", mode: "live", id: "pay-1" })).toEqual({
      ...payment(), version: 2, refundHeldMinor: 101, updatedAt: 2_000,
    });
    return 3;
  } });
  release();
  expect(await Promise.all([first, second, third])).toEqual([1, 2, 3]);
  expect(events).toEqual(["first entered", "first committed", "second entered", "second committed", "third entered"]);
});
