import { ToolInputError } from "@jini-ai/core";
import { describe, expect, test } from "vitest";

import { authorizedScripted, LIPAY, paidLipay, SCRIPTED, USD } from "../../ops/__tests__/harness.js";
import { PAYMENTS_TOOL_IDS } from "../index.js";
import { toolWorld } from "./harness.js";

describe("approval cancellation at payment effect boundaries", () => {
  test("an abort during the second permission check mints no grant and makes no capture call", async () => {
    const t = await toolWorld();
    const payment = await authorizedScripted(t.w);
    t.host.scope = SCRIPTED;
    const controller = new AbortController();
    t.host.onAuthorize = () => { if (t.authorized.length === 2) controller.abort(); };
    expect(await t.call(PAYMENTS_TOOL_IDS.capture, { paymentId: payment.id, amount: USD(123) }, controller))
      .toEqual({ ok: false, reason: "abandoned", message: "the human did not confirm (abandoned); no money moved and no grant was issued" });
    expect(t.asked).toHaveLength(1);
    expect(t.authorized).toHaveLength(2);
    expect(t.mints).toEqual([]);
    expect(t.w.scripted.calls.map((c) => c.op)).toEqual(["createIntent"]);
    expect((await t.w.read(payment.id)).payment).toMatchObject({ intentStatus: "authorized", capturedMinor: 0, currency: "USD" });
  });

  test("an abort while minting leaves the grant unpresented and the authorization unchanged", async () => {
    const t = await toolWorld();
    const payment = await authorizedScripted(t.w);
    t.host.scope = SCRIPTED;
    const controller = new AbortController();
    t.host.afterMint = () => controller.abort();
    expect(await t.call(PAYMENTS_TOOL_IDS.void, { paymentId: payment.id }, controller)).toMatchObject({ ok: false, reason: "abandoned" });
    expect(t.mints).toHaveLength(1);
    const minted = t.mints[0]!;
    expect(minted.binding).toEqual({ op: "void", workspaceId: "ws", mode: "test", paymentId: payment.id, amount: null, idempotencyKey: "tool-key-1" });
    expect(minted.expiresAt).toBe(t.now() + 120_000);
    expect(t.w.scripted.calls.map((c) => c.op)).toEqual(["createIntent"]);
    expect((await t.w.read(payment.id)).attempts.map((a) => a.op)).toEqual(["intent"]);
    expect(await t.w.grants.redeem({ grant: minted.token, binding: minted.binding })).toBe(true);
  });

  test("abandoning a pending human card does not wait for or obey a later yes", async () => {
    const t = await toolWorld();
    const payment = await paidLipay(t.w);
    const controller = new AbortController();
    let entered!: () => void;
    const asking = new Promise<void>((resolve) => { entered = resolve; });
    let answer!: (value: { confirmed: true }) => void;
    t.host.answer = () => new Promise((resolve) => { answer = resolve; entered(); });
    const pending = t.call(PAYMENTS_TOOL_IDS.refund, { paymentId: payment.id, amount: USD(99) }, controller);
    await asking;
    controller.abort();
    expect(await pending).toMatchObject({ ok: false, reason: "abandoned" });
    answer({ confirmed: true });
    await Promise.resolve();
    expect(t.asked).toHaveLength(1);
    expect(t.mints).toEqual([]);
    expect((await t.w.read(payment.id)).refunds).toEqual([]);
    expect((await t.w.read(payment.id)).payment).toMatchObject({ capturedMinor: 10_000, refundHeldMinor: 0, refundedMinor: 0 });
  });

  test("a failed approval transport propagates without issuing a grant", async () => {
    const t = await toolWorld();
    const payment = await paidLipay(t.w);
    const transportFailure = new Error("approval transport unavailable");
    t.host.answer = async () => { throw transportFailure; };
    await expect(t.call(PAYMENTS_TOOL_IDS.refund, { paymentId: payment.id, amount: USD(1) })).rejects.toBe(transportFailure);
    expect(t.mints).toEqual([]);
    expect((await t.w.read(payment.id)).refunds).toEqual([]);
  });
});

describe("payment tool amounts and bounded text", () => {
  test.each([
    ["JPY", "JPY 7", "JPY 1001"],
    ["KWD", "KWD 0.007", "KWD 1.001"],
  ])("approves and refunds exact %s minor units using that currency's display exponent", async (currency, amountDisplay, paymentAmountDisplay) => {
    const t = await toolWorld();
    const amount = { minorUnits: 7, currency };
    const created = await t.w.service.createIntent({ scope: LIPAY, amount: { minorUnits: 1_001, currency }, idempotencyKey: "currency-payment", reference: "order-currency" });
    expect(created.ok).toBe(true);
    if (!created.ok) throw new Error("fixture currency payment failed");
    expect(await t.call(PAYMENTS_TOOL_IDS.refund, { paymentId: created.payment.id, amount }))
      .toMatchObject({ ok: true, refund: { amount, status: "pending" }, payment: { refundHeld: amount } });
    expect(t.asked[0]).toMatchObject({ amount, amountDisplay, paymentAmount: { minorUnits: 1_001, currency }, paymentAmountDisplay });
    expect(t.mints[0]!.binding.amount).toEqual(amount);
    expect((await t.w.read(created.payment.id)).refunds[0]).toMatchObject({ amountMinor: 7, currency, status: "pending" });
  });

  test("accepts the exact maximum key and reason lengths without truncating the approved refund", async () => {
    const t = await toolWorld();
    const paid = await paidLipay(t.w);
    const idempotencyKey = "k".repeat(200);
    const reason = "r".repeat(500);
    expect(await t.call(PAYMENTS_TOOL_IDS.refund, { paymentId: paid.id, amount: USD(1), idempotencyKey, reason }))
      .toMatchObject({ ok: true, idempotencyKey, refund: { amount: USD(1) }, payment: { refundHeld: USD(1) } });
    expect(t.asked[0]).toMatchObject({ idempotencyKey, reason, amount: USD(1), amountDisplay: "USD 0.01" });
    expect(t.mints[0]!.binding).toMatchObject({ amount: USD(1), idempotencyKey });
    expect((await t.w.read(paid.id)).refunds[0]).toMatchObject({ reason, idempotencyKey, currency: "USD", amountMinor: 1 });
  });

  test.each([
    ["a whitespace reason", { reason: " \t " }],
    ["an overlong key", { idempotencyKey: "k".repeat(201) }],
    ["a whitespace key", { idempotencyKey: "\t" }],
    ["a negative amount", { amount: USD(-1) }],
    ["an unsafe integer", { amount: USD(Number.MAX_SAFE_INTEGER + 1) }],
    ["an infinite amount", { amount: USD(Number.POSITIVE_INFINITY) }],
    ["NaN", { amount: USD(Number.NaN) }],
    ["a missing currency", { amount: { minorUnits: 1 } }],
  ])("refuses %s before asking for approval or minting a grant", async (_name, change) => {
    const t = await toolWorld();
    await expect(t.call(PAYMENTS_TOOL_IDS.refund, { paymentId: "p", amount: USD(1), ...change })).rejects.toBeInstanceOf(ToolInputError);
    expect(t.authorized).toEqual([]);
    expect(t.asked).toEqual([]);
    expect(t.mints).toEqual([]);
  });

  test("reports a capture grant that expires before redemption without inventing a payment view", async () => {
    const t = await toolWorld({ tools: { grantTtlMs: 1 } });
    const payment = await authorizedScripted(t.w);
    t.host.scope = SCRIPTED;
    t.host.afterMint = () => t.tick(1);
    expect(await t.call(PAYMENTS_TOOL_IDS.capture, { paymentId: payment.id, amount: USD(123) })).toEqual({
      ok: false, reason: "payment-error", idempotencyKey: "tool-key-1",
      error: { code: "GRANT_INVALID", message: "the capture grant is missing, expired, used or bound to another request", retryable: false },
      message: "the capture did not complete (GRANT_INVALID): the capture grant is missing, expired, used or bound to another request. Retrying with the same idempotencyKey returns this same result.",
    });
    expect(t.w.scripted.calls.map((c) => c.op)).toEqual(["createIntent"]);
    expect((await t.w.read(payment.id)).payment?.capturedMinor).toBe(0);
  });

  test.each([Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])("refuses an unsafe grant lifetime (%s) at registration", async (grantTtlMs) => {
    await expect(toolWorld({ tools: { grantTtlMs } })).rejects.toThrow("commerce payments tools: grantTtlMs must be a positive whole number of milliseconds");
  });
});
