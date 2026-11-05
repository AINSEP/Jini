import { describe, expect, test, vi } from "vitest";
import { createPaymentsOperator } from "../service.js";
import { SCRIPTED, USD, timedOut, world } from "./harness.js";

const AGE = 60_000;
const request = { scope: SCRIPTED, amount: USD(10_000), idempotencyKey: "recover-order", reference: "order-1" };
const line = { description: "One item", quantity: 2, unitAmount: USD(5_000) };

async function unknown(ledgerKind: "memory" | "sqlite") {
  const w = await world({ ledgerKind });
  Object.assign(w.scripted.provider, { intentReplayWindowMs: 23 * 60 * 60 * 1_000 });
  w.scripted.queue("createIntent", timedOut());
  const first = await w.service.createIntent(request, { line });
  if (first.ok || !first.payment) throw new Error("expected unknown payment");
  w.tick(AGE * 2);
  return { w, payment: first.payment };
}

for (const ledgerKind of ["memory", "sqlite"] as const) describe(`intent recovery ${ledgerKind}`, () => {
  test("restart recovers the durable original request with the same charge key", async () => {
    const { w, payment } = await unknown(ledgerKind);
    const before = await w.read(payment.id);
    expect(before.attempts[0]).toMatchObject({ recoveryAttempts: 0 });
    const snapshot = JSON.parse(before.attempts[0]!.dispatchJson!);
    expect(snapshot.req).toMatchObject({ line, correlationId: payment.id, idempotencyKey: before.attempts[0]!.id });
    expect(JSON.stringify(snapshot)).not.toContain("credentials");
    const restarted = createPaymentsOperator(w.deps);
    expect((await restarted.reconcileUnknown({ olderThanMs: AGE, limit: 10 })).payments)
      .toEqual({ scanned: 1, settled: 1, failed: 0, left: 0, errors: 0 });
    const calls = w.scripted.calls.filter(call => call.op === "createIntent");
    expect(calls).toHaveLength(2);
    expect(calls[1]!.req).toEqual(calls[0]!.req);
    const after = await w.read(payment.id);
    expect(after.payment).toMatchObject({ status: "succeeded" });
    expect(after.attempts[0]).toMatchObject({ recoveryAttempts: 1, outcome: "ok" });
    expect(after.outbox).toEqual(["payment.succeeded"]);
  });

  test("concurrent reconcilers claim a single replay while the provider is in flight", async () => {
    const { w } = await unknown(ledgerKind);
    const original = w.scripted.provider.createIntent;
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    let started!: () => void;
    const began = new Promise<void>(resolve => { started = resolve; });
    const replay = vi.spyOn(w.scripted.provider, "createIntent").mockImplementation(async args => {
      started(); await gate; return original(args);
    });
    const first = w.operator.reconcileUnknown({ olderThanMs: AGE, limit: 10 });
    await began;
    const second = await createPaymentsOperator(w.deps).reconcileUnknown({ olderThanMs: AGE, limit: 10 });
    expect(second.payments.settled).toBe(0);
    release(); await first;
    expect(replay).toHaveBeenCalledTimes(1);
  });

  test("stops after three recovery attempts and keeps unknown money unresolved", async () => {
    const { w, payment } = await unknown(ledgerKind);
    w.scripted.queue("createIntent", timedOut(), timedOut(), timedOut(), timedOut());
    for (let i = 0; i < 5; i++) {
      await w.operator.reconcileUnknown({ olderThanMs: AGE, limit: 10 });
      w.tick(AGE * 2);
    }
    expect(w.scripted.calls.filter(call => call.op === "createIntent")).toHaveLength(4);
    expect((await w.read(payment.id)).attempts[0]).toMatchObject({ recoveryAttempts: 3, outcome: "unknown" });
    expect((await w.read(payment.id)).payment).toMatchObject({ status: "unknown", providerRef: null });
  });

  test("changed amount conflicts before recovery and expired provider keys are never replayed", async () => {
    const { w } = await unknown(ledgerKind);
    expect(await w.service.createIntent({ ...request, amount: USD(20_000) }, { line: { ...line, quantity: 4 } }))
      .toMatchObject({ ok: false, error: { code: "IDEMPOTENCY_CONFLICT" } });
    w.tick(24 * 60 * 60 * 1_000);
    const report = await w.operator.reconcileUnknown({ olderThanMs: AGE, limit: 10 });
    expect(report.payments.left).toBe(1);
    expect(w.scripted.calls.filter(call => call.op === "createIntent")).toHaveLength(1);
  });

  test("legacy unknown rows without a dispatch snapshot remain unresolved", async () => {
    const { w, payment } = await unknown(ledgerKind);
    const attempt = (await w.read(payment.id)).attempts[0]!;
    await w.ledger.transaction({ fn: tx => tx.updateAttempt({ id: attempt.id, patch: { dispatchJson: null, updatedAt: attempt.updatedAt } }) });
    expect((await w.operator.reconcileUnknown({ olderThanMs: AGE, limit: 10 })).payments.left).toBe(1);
    expect(w.scripted.calls.filter(call => call.op === "createIntent")).toHaveLength(1);
  });
});
