import { describe, expect, test } from "vitest";

import { LIPAY, USD, paidLipay, world, type World } from "./harness.js";

/**
 * @file Operator resolution of `unknown` outcomes: the state change and its append-only audit row
 * in one transaction, only from `unknown`, every refusal typed and unaudited.
 */

async function lostCharge(w: World) {
  w.lipay.server.script({ op: "createIntent", behaviours: ["timeout"] });
  const result = await w.service.createIntent({ scope: LIPAY, amount: USD(10_000), idempotencyKey: "ik-lost", reference: "o" });
  return (result as { payment: { id: string } }).payment.id;
}

async function lostRefund(w: World) {
  const paid = await paidLipay(w);
  w.lipay.server.script({ op: "refund", behaviours: ["timeout"] });
  const grant = await w.grant({ op: "refund", paymentId: paid.id, amount: USD(3_000), idempotencyKey: "rk" });
  await w.service.refund({ scope: LIPAY, paymentId: paid.id, amount: USD(3_000), idempotencyKey: "rk", grant });
  return { paymentId: paid.id, refundId: (await w.read(paid.id)).refunds[0]!.id };
}

const who = { actor: "op-7", reason: "provider support ticket 1234" };

for (const ledgerKind of ["memory", "sqlite"] as const) {
  describe(`resolveUnknown on ${ledgerKind}`, () => {
    test("an unknown charge resolved succeeded: captured, announced, evidence source operator, audited", async () => {
      const w = await world({ ledgerKind });
      const id = await lostCharge(w);
      const result = await w.operator.resolveUnknown({ scope: LIPAY, paymentId: id, outcome: "succeeded", ...who });
      expect(result).toMatchObject({ ok: true, refund: null, payment: { id, status: "succeeded", captured: USD(10_000) } });
      const after = await w.read(id);
      expect(after.evidence.at(-1)).toMatchObject({ source: "operator", subject: "payment", observedStatus: "succeeded" });
      expect(after.outbox).toEqual(["payment.succeeded"]);
      expect(after.actions).toEqual([expect.objectContaining({
        paymentId: id, refundId: null, action: "resolve-unknown", outcome: "succeeded", actor: "op-7", reason: who.reason, siteId: "site", providerId: "lipay",
      })]);
    });

    test("an unknown refund resolved failed releases the hold and returns the refund view", async () => {
      const w = await world({ ledgerKind });
      const { paymentId, refundId } = await lostRefund(w);
      const result = await w.operator.resolveUnknown({ scope: LIPAY, paymentId, refundId, outcome: "failed", ...who });
      expect(result).toMatchObject({ ok: true, refund: { id: refundId, status: "failed" }, payment: { refundHeld: USD(0) } });
      expect((await w.read(paymentId)).actions).toEqual([expect.objectContaining({ refundId, outcome: "failed" })]);
    });
  });
}

describe("resolveUnknown refusals (nothing is written or audited)", () => {
  test("only an unknown outcome can be resolved", async () => {
    const w = await world();
    const paid = await paidLipay(w);
    expect(await w.operator.resolveUnknown({ scope: LIPAY, paymentId: paid.id, outcome: "failed", ...who })).toEqual({
      ok: false, error: { code: "INVALID_REQUEST", message: `payment ${paid.id} is succeeded; only an unknown outcome can be resolved`, retryable: false },
    });
    expect((await w.read(paid.id)).actions).toEqual([]);
    const w2 = await world();
    const { paymentId, refundId } = await lostRefund(w2);
    await w2.operator.resolveUnknown({ scope: LIPAY, paymentId, refundId, outcome: "succeeded", ...who });
    expect(await w2.operator.resolveUnknown({ scope: LIPAY, paymentId, refundId, outcome: "failed", ...who }))
      .toMatchObject({ ok: false, error: { message: `refund ${refundId} is succeeded; only an unknown outcome can be resolved` } });
    expect((await w2.read(paymentId)).actions).toHaveLength(1);
  });

  test.each([
    ["an unknown refund id", { refundId: "rf_nope" }, "refund rf_nope not found"],
    ["an unknown payment", { paymentId: "pay_nope" }, "payment pay_nope not found in this scope"],
    ["another site's payment", { scope: { ...LIPAY, siteId: "elsewhere" } }, "payment PAY not found in this scope"],
    ["an unusable scope", { scope: { ...LIPAY, siteId: "" } }, "scope.siteId must be a non-empty string"],
    ["a blank actor", { actor: "" }, "actor must be a non-empty string"],
    ["a blank reason", { reason: " " }, "reason must be a non-empty string"],
    ["a blank refund id", { refundId: "" }, "refundId must be a non-empty string"],
    ["an outcome that is not succeeded/failed", { outcome: "refunded" as never }, 'outcome must be "succeeded" or "failed"'],
  ])("%s", async (_name, change, message) => {
    const w = await world();
    const id = await lostCharge(w);
    const result = await w.operator.resolveUnknown({ scope: LIPAY, paymentId: id, outcome: "failed", ...who, ...change });
    expect(result).toEqual({ ok: false, error: { code: "INVALID_REQUEST", message: message.replace("PAY", id), retryable: false } });
    expect((await w.read(id)).payment?.intentStatus).toBe("unknown");
    expect((await w.read(id)).actions).toEqual([]);
  });

  test("an unregistered provider", async () => {
    const w = await world();
    expect(await w.operator.resolveUnknown({ scope: { ...LIPAY, providerId: "gone" }, paymentId: "p", outcome: "failed", ...who }))
      .toMatchObject({ ok: false, error: { code: "PROVIDER_NOT_REGISTERED" } });
  });
});
