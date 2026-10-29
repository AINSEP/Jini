import { describe, expect, test } from "vitest";

import { createPaymentsService } from "../../kernel.js";
import type { LedgerTx, PaymentsLedger } from "../../ledger/repo.js";
import { authorizedScripted, LIPAY, NOW, paidLipay, SCRIPTED, timedOut, USD, world } from "./harness.js";

describe("money operations preserve approval until admission", () => {
  test.each([
    ["another workspace", { workspaceId: "other" }],
    ["another site", { siteId: "other" }],
    ["another provider account", { providerAccountId: "other" }],
    ["live mode", { mode: "live" as const }],
  ])("a capture in %s neither spends its grant nor dispatches", async (_name, change) => {
    const w = await world();
    const held = await authorizedScripted(w);
    const binding = { op: "capture" as const, workspaceId: "ws", mode: "test" as const, paymentId: held.id, amount: USD(499), idempotencyKey: "capture-fenced" };
    const grant = await w.grants.mint({ binding, expiresAt: NOW + 1_000 });
    expect(await w.service.capture({ scope: { ...SCRIPTED, ...change }, paymentId: held.id, amount: USD(499), idempotencyKey: binding.idempotencyKey, grant }))
      .toMatchObject({ ok: false, error: { code: "INVALID_REQUEST", message: `payment '${held.id}' not found in this scope`, retryable: false } });
    expect(await w.grants.redeem({ grant, binding })).toBe(true);
    expect((await w.read(held.id)).attempts.map((a) => a.op)).toEqual(["intent"]);
    expect(w.scripted.calls.map((c) => c.op)).toEqual(["createIntent"]);
  });

  test("a void replay in a different account conflicts without spending a fresh approval", async () => {
    const w = await world();
    const held = await authorizedScripted(w);
    const binding = { op: "void" as const, workspaceId: "ws", mode: "test" as const, paymentId: held.id, amount: null, idempotencyKey: "void-key" };
    const grant = await w.grants.mint({ binding, expiresAt: NOW + 1_000 });
    expect(await w.service.void({ scope: SCRIPTED, paymentId: held.id, idempotencyKey: binding.idempotencyKey, grant })).toMatchObject({ ok: true });
    const fresh = await w.grants.mint({ binding, expiresAt: NOW + 1_000 });
    expect(await w.service.void({ scope: { ...SCRIPTED, providerAccountId: "another-account" }, paymentId: held.id, idempotencyKey: binding.idempotencyKey, grant: fresh }))
      .toEqual({ ok: false, error: { code: "IDEMPOTENCY_CONFLICT", message: "idempotency key already used for a different void request", retryable: false } });
    expect(await w.grants.redeem({ grant: fresh, binding })).toBe(true);
    expect(w.scripted.calls.map((c) => c.op)).toEqual(["createIntent", "void"]);
  });

  test("a failed reservation spends its single-use grant but creates no refund or attempt", async () => {
    const w = await world();
    const paid = await paidLipay(w);
    const binding = { op: "refund" as const, workspaceId: "ws", mode: "test" as const, paymentId: paid.id, amount: USD(10_001), idempotencyKey: "too-large" };
    const grant = await w.grants.mint({ binding, expiresAt: NOW + 1_000 });
    const request = { scope: LIPAY, paymentId: paid.id, amount: binding.amount, idempotencyKey: binding.idempotencyKey, grant };
    expect(await w.service.refund(request)).toEqual({ ok: false, error: { code: "INVALID_REQUEST", message: "the refund exceeds the refundable amount (10000 minor units left)", retryable: false } });
    expect(await w.service.refund(request)).toMatchObject({ ok: false, error: { code: "GRANT_INVALID" } });
    expect(await w.grants.redeem({ grant, binding })).toBe(false);
    const after = await w.read(paid.id);
    expect(after.refunds).toEqual([]);
    expect(after.attempts.map((a) => a.op)).toEqual(["intent"]);
    expect(after.payment).toMatchObject({ currency: "USD", capturedMinor: 10_000, refundedMinor: 0, refundHeldMinor: 0 });
  });

  test("a refund attempt write failure rolls back the reservation and never reaches the provider", async () => {
    const storageFailure = new Error("attempt storage unavailable");
    let failWrites = false;
    const w = await world({ wrapLedger: (ledger): PaymentsLedger => ({
      transaction: ({ fn }) => ledger.transaction({ fn: (tx) => fn(new Proxy(tx, {
        get(target, name) {
          if (failWrites && name === "insertAttempt") return async () => { throw storageFailure; };
          return Reflect.get(target, name).bind(target);
        },
      }) as LedgerTx) }),
    }) });
    const paid = await w.service.createIntent({ scope: SCRIPTED, amount: USD(10_000), idempotencyKey: "paid", reference: "order" });
    expect(paid.ok).toBe(true);
    if (!paid.ok) throw new Error("fixture payment failed");
    const binding = { op: "refund" as const, workspaceId: "ws", mode: "test" as const, paymentId: paid.payment.id, amount: USD(999), idempotencyKey: "refund-storage" };
    const grant = await w.grants.mint({ binding, expiresAt: NOW + 1_000 });
    failWrites = true;
    await expect(w.service.refund({ scope: SCRIPTED, paymentId: paid.payment.id, amount: binding.amount, idempotencyKey: binding.idempotencyKey, grant })).rejects.toBe(storageFailure);
    const after = await w.read(paid.payment.id);
    expect(after.refunds).toEqual([]);
    expect(after.attempts.map((a) => a.op)).toEqual(["intent"]);
    expect(after.payment).toMatchObject({ capturedMinor: 10_000, refundedMinor: 0, refundHeldMinor: 0 });
    expect(w.scripted.calls.map((c) => c.op)).toEqual(["createIntent"]);
    expect(await w.grants.redeem({ grant, binding })).toBe(false);
  });
});

describe("operator resolution is atomic with its audit", () => {
  test.each(["succeeded", "failed"] as const)("an audit write failure rolls back a payment resolution to %s", async (outcome) => {
    const storageFailure = new Error("audit append failed");
    const w = await world({ wrapLedger: (ledger): PaymentsLedger => ({
      transaction: ({ fn }) => ledger.transaction({ fn: (tx) => fn(new Proxy(tx, {
        get(target, name) {
          if (name === "appendOperatorAction") return async () => { throw storageFailure; };
          return Reflect.get(target, name).bind(target);
        },
      }) as LedgerTx) }),
    }) });
    w.scripted.queue("createIntent", timedOut());
    const lost = await w.service.createIntent({ scope: SCRIPTED, amount: USD(1_001), idempotencyKey: "lost", reference: "order-lost" });
    expect(lost).toMatchObject({ ok: false, payment: { status: "unknown" } });
    if (lost.ok || !lost.payment) throw new Error("fixture did not create an unknown payment");
    const before = await w.read(lost.payment.id);
    await expect(w.operator.resolveUnknown({ scope: SCRIPTED, paymentId: lost.payment.id, outcome, actor: "operator", reason: "checked provider" })).rejects.toBe(storageFailure);
    expect(await w.read(lost.payment.id)).toEqual(before);
  });

  test("the public kernel service applies the injected risk gate before any writes", async () => {
    const w = await world();
    const alerts = { raise: async () => undefined };
    const risk = { port: { assess: async () => ({ verdict: "deny" as const, reasons: ["manual.block"] }) }, deadlineMs: 5, failPolicy: "closed" as const, setTimer: () => ({ cancel: () => undefined }) };
    const service = createPaymentsService(w.deps, { alerts, risk });
    expect(await service.createIntent({ scope: SCRIPTED, amount: USD(101), idempotencyKey: "denied", reference: "order" }))
      .toEqual({ ok: false, error: { code: "RISK_DENIED", message: "the pre-charge risk gate denied this payment (manual.block)", retryable: false } });
    expect(w.scripted.calls).toEqual([]);
    expect(await w.ledger.transaction({ fn: (tx) => tx.findPaymentByIdempotencyKey({ workspaceId: "ws", mode: "test", key: "denied" }) })).toBeNull();
  });
});
