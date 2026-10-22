import { ToolInputError, ToolPermissionDeniedError, type ApprovalAnswer } from "@jini-ai/core";
import { describe, expect, it } from "vitest";

import type { PaymentsPort } from "../../contract/payments-port.js";
import { authorizedScripted, LIPAY, paidLipay, rejected, SCRIPTED, USD } from "../../ops/__tests__/harness.js";
import { PAYMENTS_TOOL_IDS } from "../index.js";
import { toolWorld, type ToolWorld } from "./harness.js";

const REFUND = PAYMENTS_TOOL_IDS.refund;
const CAPTURE = PAYMENTS_TOOL_IDS.capture;
const VOID = PAYMENTS_TOOL_IDS.void;

/** What the ledger and the fake provider hold for a payment: proof of whether money moved. */
async function moneyState(t: ToolWorld, paymentId: string) {
  const read = await t.w.read(paymentId);
  return { refunds: read.refunds.length, attempts: read.attempts.map((a) => a.op), refundedMinor: read.payment!.refundedMinor, heldMinor: read.payment!.refundHeldMinor };
}

describe("commerce_payments_refund", () => {
  it("asks once with the exact request, then mints a grant bound to it and refunds through the real service", async () => {
    const t = await toolWorld();
    const payment = await paidLipay(t.w);
    const result = await t.call(REFUND, { paymentId: payment.id, amount: USD(2_500), reason: "damaged" });

    expect(t.asked).toEqual([{
      toolId: REFUND, operation: "refund", mode: "test", live: false, paymentId: payment.id, reference: "order-1", providerId: "lipay",
      amount: USD(2_500), amountDisplay: "USD 25.00", paymentAmount: USD(10_000), paymentAmountDisplay: "USD 100.00",
      idempotencyKey: "tool-key-1", reason: "damaged", irreversible: true,
      summary: `Test mode: refund USD 25.00 of payment ${payment.id} (reference order-1, provider lipay). Idempotency key tool-key-1. Reason: damaged. This cannot be undone.`,
    }]);
    expect(t.mints).toEqual([{
      binding: { op: "refund", workspaceId: "ws", mode: "test", paymentId: payment.id, amount: USD(2_500), idempotencyKey: "tool-key-1" },
      expiresAt: t.now() + 120_000, token: expect.any(String),
    }]);
    expect(result).toMatchObject({
      ok: true, operation: "refund", replayed: false, idempotencyKey: "tool-key-1",
      refund: { paymentId: payment.id, amount: USD(2_500) }, payment: { id: payment.id, refundHeld: USD(2_500) },
    });
    expect(await moneyState(t, payment.id)).toMatchObject({ refunds: 1, heldMinor: 2_500 });
    const refundRow = (await t.w.read(payment.id)).refunds[0]!;
    expect(refundRow.reason).toBe("damaged");
    // Permission: once in prepare, once again after the human answered.
    expect(t.authorized.map((a) => [a.permission, a.entityId])).toEqual([["commerce.payments.manage", payment.id], ["commerce.payments.manage", payment.id]]);
  });

  it("the service consumed the grant: the same grant cannot be redeemed or used again", async () => {
    const t = await toolWorld();
    const payment = await paidLipay(t.w);
    await t.call(REFUND, { paymentId: payment.id, amount: USD(1_000) });
    const { binding, token } = t.mints[0]!;
    expect(await t.w.grants.redeem({ grant: token, binding })).toBe(false);
    const again = await t.w.service.refund({ scope: LIPAY, paymentId: payment.id, amount: USD(1_000), idempotencyKey: "fresh-key", grant: token });
    expect(again).toMatchObject({ ok: false, error: { code: "GRANT_INVALID" } });
    expect(await moneyState(t, payment.id)).toMatchObject({ refunds: 1, heldMinor: 1_000 });
  });

  it("double enforcement: a grant minted for amount A is refused by the service for amount B, and stays usable for A", async () => {
    // A tool bug (or a hostile port in between) that changes the amount after the human approved.
    const t = await toolWorld({
      wrapPayments: (service): PaymentsPort => ({ ...service, refund: (required, optional) => service.refund({ ...required, amount: USD(9_000) }, optional) }),
    });
    const payment = await paidLipay(t.w);
    const result = await t.call(REFUND, { paymentId: payment.id, amount: USD(1_000) });
    expect(result).toMatchObject({ ok: false, reason: "payment-error", error: { code: "GRANT_INVALID" }, idempotencyKey: "tool-key-1" });
    expect(result).not.toHaveProperty("payment");
    expect(await moneyState(t, payment.id)).toEqual({ refunds: 0, attempts: ["intent"], refundedMinor: 0, heldMinor: 0 });

    // A mismatching redeem does not burn the approval: the approved request itself still goes through once.
    const { token } = t.mints[0]!;
    const approved = await t.w.service.refund({ scope: LIPAY, paymentId: payment.id, amount: USD(1_000), idempotencyKey: "tool-key-1", grant: token });
    expect(approved).toMatchObject({ ok: true, refund: { amount: USD(1_000) } });
  });

  it("double enforcement: a grant for one idempotency key or payment is refused for another", async () => {
    const t = await toolWorld({
      wrapPayments: (service): PaymentsPort => ({ ...service, refund: (required, optional) => service.refund({ ...required, idempotencyKey: "swapped" }, optional) }),
    });
    const payment = await paidLipay(t.w);
    expect(await t.call(REFUND, { paymentId: payment.id, amount: USD(1_000) })).toMatchObject({ ok: false, error: { code: "GRANT_INVALID" } });
    const other = await paidLipay(t.w, "ik-2");
    const { token } = t.mints[0]!;
    expect(await t.w.service.refund({ scope: LIPAY, paymentId: other.id, amount: USD(1_000), idempotencyKey: "tool-key-1", grant: token }))
      .toMatchObject({ ok: false, error: { code: "GRANT_INVALID" } });
    expect((await moneyState(t, payment.id)).refunds + (await moneyState(t, other.id)).refunds).toBe(0);
  });

  it("a grant that expires before the service redeems it moves no money", async () => {
    const t = await toolWorld();
    const payment = await paidLipay(t.w);
    t.host.afterMint = () => t.tick(120_000);
    expect(await t.call(REFUND, { paymentId: payment.id, amount: USD(1_000) })).toMatchObject({ ok: false, reason: "payment-error", error: { code: "GRANT_INVALID" } });
    expect(await moneyState(t, payment.id)).toMatchObject({ refunds: 0, heldMinor: 0 });
  });

  it.each(["declined", "expired", "abandoned"] as const)("a %s approval mints nothing and moves nothing", async (reason) => {
    const t = await toolWorld();
    const payment = await paidLipay(t.w);
    t.host.answer = async (): Promise<ApprovalAnswer> => ({ confirmed: false, reason });
    const result = await t.call(REFUND, { paymentId: payment.id, amount: USD(1_000) });
    expect(result).toEqual({ ok: false, reason, message: `the human did not confirm (${reason}); no money moved and no grant was issued` });
    expect(t.asked).toHaveLength(1);
    expect(t.mints).toEqual([]);
    expect(t.authorized).toHaveLength(1);
    expect(await moneyState(t, payment.id)).toMatchObject({ refunds: 0, heldMinor: 0 });
  });

  it("an abort while the human is deciding mints nothing, even if they then say yes", async () => {
    const t = await toolWorld();
    const payment = await paidLipay(t.w);
    const controller = new AbortController();
    t.host.answer = async () => { controller.abort(); return { confirmed: true }; };
    expect(await t.call(REFUND, { paymentId: payment.id, amount: USD(1_000) }, controller)).toMatchObject({ ok: false, reason: "abandoned" });
    expect(t.mints).toEqual([]);
    expect(await moneyState(t, payment.id)).toMatchObject({ refunds: 0 });
  });

  it("an abort during the post-approval permission check mints nothing", async () => {
    const t = await toolWorld();
    const payment = await paidLipay(t.w);
    const controller = new AbortController();
    t.host.onAuthorize = () => { if (t.authorized.length === 2) controller.abort(); };
    expect(await t.call(REFUND, { paymentId: payment.id, amount: USD(1_000) }, controller)).toMatchObject({ ok: false, reason: "abandoned" });
    expect(t.authorized).toHaveLength(2);
    expect(t.mints).toEqual([]);
    expect(await moneyState(t, payment.id)).toMatchObject({ refunds: 0 });
  });

  it("an abort while the grant is minted never presents it, so no money moves", async () => {
    const t = await toolWorld();
    const payment = await paidLipay(t.w);
    const controller = new AbortController();
    t.host.afterMint = () => controller.abort();
    expect(await t.call(REFUND, { paymentId: payment.id, amount: USD(1_000) }, controller)).toMatchObject({ ok: false, reason: "abandoned" });
    expect(t.mints).toHaveLength(1);
    expect(await moneyState(t, payment.id)).toMatchObject({ refunds: 0, heldMinor: 0 });
  });

  it("an already-aborted call asks nobody", async () => {
    const t = await toolWorld();
    const controller = new AbortController();
    controller.abort();
    expect(await t.call(REFUND, { paymentId: "p", amount: USD(1) }, controller)).toMatchObject({ ok: false, reason: "abandoned" });
    expect(t.asked).toEqual([]);
    expect(t.authorized).toEqual([]);
  });

  it("a permission revoked while the card was open stops the effect", async () => {
    const t = await toolWorld();
    const payment = await paidLipay(t.w);
    t.host.allowChecks = 1;
    await expect(t.call(REFUND, { paymentId: payment.id, amount: USD(1_000) })).rejects.toBeInstanceOf(ToolPermissionDeniedError);
    expect(t.asked).toHaveLength(1);
    expect(t.mints).toEqual([]);
  });

  it("a denied permission asks nobody", async () => {
    const t = await toolWorld();
    const payment = await paidLipay(t.w);
    t.host.allowChecks = 0;
    await expect(t.call(REFUND, { paymentId: payment.id, amount: USD(1_000) })).rejects.toBeInstanceOf(ToolPermissionDeniedError);
    expect(t.asked).toEqual([]);
  });

  it("refuses, without asking, when the run has no scope, the payment is not in it, or the currency differs", async () => {
    const t = await toolWorld();
    const payment = await paidLipay(t.w);
    t.host.scope = null;
    expect(await t.call(REFUND, { paymentId: payment.id, amount: USD(1) })).toMatchObject({ ok: false, reason: "no-payment-scope" });
    t.host.scope = { ...LIPAY, providerAccountId: "someone-else" };
    expect(await t.call(REFUND, { paymentId: payment.id, amount: USD(1) })).toMatchObject({ ok: false, reason: "payment-not-found" });
    t.host.scope = LIPAY;
    expect(await t.call(REFUND, { paymentId: payment.id, amount: { minorUnits: 1, currency: "EUR" } })).toEqual({
      ok: false, reason: "currency-mismatch", message: `the refund is in EUR but payment '${payment.id}' is in USD; nothing was changed`,
    });
    expect(t.asked).toEqual([]);
    expect(t.mints).toEqual([]);
  });

  it("uses a supplied idempotency key, and a retry with it replays instead of refunding twice", async () => {
    const t = await toolWorld();
    const payment = await paidLipay(t.w);
    const first = await t.call(REFUND, { paymentId: payment.id, amount: USD(1_000), idempotencyKey: "model-key" });
    const retry = await t.call(REFUND, { paymentId: payment.id, amount: USD(1_000), idempotencyKey: "model-key" });
    expect(first).toMatchObject({ ok: true, replayed: false, idempotencyKey: "model-key" });
    expect(retry).toMatchObject({ ok: true, replayed: true, idempotencyKey: "model-key" });
    expect(t.asked.map((d) => [d.idempotencyKey, d.reason])).toEqual([["model-key", null], ["model-key", null]]);
    expect(t.asked[0]!.summary).not.toContain("Reason:");
    expect(await moneyState(t, payment.id)).toMatchObject({ refunds: 1, heldMinor: 1_000 });
  });

  it("returns the service's typed refusal when the refund is not possible", async () => {
    const t = await toolWorld();
    const payment = await paidLipay(t.w);
    const result = await t.call(REFUND, { paymentId: payment.id, amount: USD(50_000) });
    expect(result).toMatchObject({ ok: false, reason: "payment-error", error: { code: "INVALID_REQUEST" }, message: expect.stringContaining("the refund did not complete (INVALID_REQUEST)") });
  });

  it("shows live mode prominently", async () => {
    const t = await toolWorld();
    const payment = await paidLipay(t.w);
    const live = { ...LIPAY, mode: "live" as const };
    t.host.scope = live;
    // The view as a live-mode service would return it; the human declines, so nothing else is consulted.
    t.w.service.getPayment = async () => ({ ...payment, scope: live });
    t.host.answer = async () => ({ confirmed: false, reason: "declined" });
    await t.call(REFUND, { paymentId: payment.id, amount: USD(100) });
    expect(t.asked[0]).toMatchObject({ mode: "live", live: true, summary: expect.stringMatching(/^LIVE MODE \(real money\): refund USD 1\.00 /) });
  });

  it("refuses malformed input before resolving anything", async () => {
    const t = await toolWorld();
    const bad: unknown[] = [
      undefined, [], {}, { paymentId: "p" }, { paymentId: "p", amount: 100 }, { paymentId: "p", amount: { minorUnits: 100 } },
      { paymentId: "p", amount: { minorUnits: "100", currency: "USD" } }, { paymentId: "p", amount: { minorUnits: 1.5, currency: "USD" } },
      { paymentId: "p", amount: { minorUnits: 0, currency: "USD" } }, { paymentId: "p", amount: { minorUnits: 100, currency: "usd" } },
      { paymentId: "p", amount: { minorUnits: 100, currency: "USD", scale: 2 } }, { paymentId: "p", amount: USD(1), idempotencyKey: "" },
      { paymentId: "p", amount: USD(1), idempotencyKey: 5 }, { paymentId: "p", amount: USD(1), reason: "x".repeat(501) },
      { paymentId: "p", amount: USD(1), grant: "forged" }, { paymentId: "p", amount: USD(1), mode: "test" },
    ];
    for (const input of bad) await expect(t.call(REFUND, input)).rejects.toBeInstanceOf(ToolInputError);
    await expect(t.call(REFUND, { paymentId: "p", amount: USD(1), confirmed: true })).rejects.toThrow(/unknown field 'confirmed'/);
    await expect(t.call(REFUND, { paymentId: "p", amount: { minorUnits: 0, currency: "USD" } })).rejects.toThrow(/amount: minorUnits must be greater than zero/);
    expect(t.authorized).toEqual([]);
    expect(t.asked).toEqual([]);
  });
});

describe("commerce_payments_capture", () => {
  it("captures an authorized manual payment after approval", async () => {
    const t = await toolWorld();
    const payment = await authorizedScripted(t.w);
    t.host.scope = SCRIPTED;
    const result = await t.call(CAPTURE, { paymentId: payment.id, amount: USD(6_000) });
    expect(t.asked[0]).toMatchObject({ operation: "capture", amountDisplay: "USD 60.00", summary: expect.stringContaining(`capture USD 60.00 of payment ${payment.id}`) });
    expect(t.mints[0]!.binding).toEqual({ op: "capture", workspaceId: "ws", mode: "test", paymentId: payment.id, amount: USD(6_000), idempotencyKey: "tool-key-1" });
    expect(result).toMatchObject({ ok: true, operation: "capture", replayed: false, idempotencyKey: "tool-key-1", payment: { id: payment.id } });
    expect(result).not.toHaveProperty("refund");
    expect(t.w.scripted.calls.filter((c) => c.op === "capture")).toHaveLength(1);
  });

  it("refuses a capture for a different amount than the grant binds", async () => {
    const t = await toolWorld({
      wrapPayments: (service): PaymentsPort => ({ ...service, capture: (required) => service.capture({ ...required, amount: USD(10_000) }) }),
    });
    const payment = await authorizedScripted(t.w);
    t.host.scope = SCRIPTED;
    expect(await t.call(CAPTURE, { paymentId: payment.id, amount: USD(6_000) })).toMatchObject({ ok: false, error: { code: "GRANT_INVALID" } });
    expect(t.w.scripted.calls.filter((c) => c.op === "capture")).toHaveLength(0);
  });

  it("reports a provider rejection with the payment as it stands", async () => {
    const t = await toolWorld();
    const payment = await authorizedScripted(t.w);
    t.host.scope = SCRIPTED;
    t.w.scripted.queue("capture", rejected());
    const result = await t.call(CAPTURE, { paymentId: payment.id, amount: USD(6_000) });
    expect(result).toMatchObject({ ok: false, reason: "payment-error", error: { code: "DECLINED" }, payment: { id: payment.id } });
  });

  it("refuses a reason field (capture records none)", async () => {
    const t = await toolWorld();
    await expect(t.call(CAPTURE, { paymentId: "p", amount: USD(1), reason: "x" })).rejects.toThrow(/unknown field 'reason'/);
  });
});

describe("commerce_payments_void", () => {
  it("voids an authorization after approval, with a grant bound to no amount", async () => {
    const t = await toolWorld();
    const payment = await authorizedScripted(t.w);
    t.host.scope = SCRIPTED;
    const result = await t.call(VOID, { paymentId: payment.id });
    expect(t.asked[0]).toMatchObject({
      operation: "void", amount: null, amountDisplay: null, paymentAmountDisplay: "USD 100.00",
      summary: `Test mode: void the uncaptured authorization (USD 100.00) of payment ${payment.id} (reference order-s, provider scripted). Idempotency key tool-key-1. This cannot be undone.`,
    });
    expect(t.mints[0]!.binding).toEqual({ op: "void", workspaceId: "ws", mode: "test", paymentId: payment.id, amount: null, idempotencyKey: "tool-key-1" });
    expect(result).toMatchObject({ ok: true, operation: "void", payment: { id: payment.id } });
    expect(t.w.scripted.calls.filter((c) => c.op === "void")).toHaveLength(1);
  });

  it("refuses an amount field", async () => {
    const t = await toolWorld();
    await expect(t.call(VOID, { paymentId: "p", amount: USD(1) })).rejects.toThrow(/unknown field 'amount'/);
  });

  it("a grant minted for a void cannot be spent on a capture", async () => {
    // The port in between turns the approved void into a capture of the whole authorization.
    const t = await toolWorld({
      wrapPayments: (service): PaymentsPort => ({ ...service, void: (required) => service.capture({ ...required, amount: USD(10_000) }) }),
    });
    const held = await authorizedScripted(t.w);
    t.host.scope = SCRIPTED;
    expect(await t.call(VOID, { paymentId: held.id })).toMatchObject({ ok: false, error: { code: "GRANT_INVALID" } });
    expect(t.w.scripted.calls.filter((c) => c.op === "capture" || c.op === "void")).toHaveLength(0);
  });
});
