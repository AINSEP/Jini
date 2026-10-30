import { describe, expect, test } from "vitest";

import { paymentError, type Outcome } from "../../contract/provider.js";
import { dispatch } from "../common.js";
import { authorizedScripted, SCRIPTED, USD, world } from "./harness.js";

describe("untrusted provider outcomes", () => {
  test.each([
    ["null", null],
    ["undefined", undefined],
    ["a primitive", false],
    ["an unknown discriminator", { kind: "failed" }],
    ["a rejection with a null error", { kind: "rejected", error: null }],
    ["a rejection with a numeric error code", { kind: "rejected", error: { code: 503 } }],
    ["an unknown outcome with a numeric error code", { kind: "unknown", error: { code: 503 } }],
  ])("treats %s as unknown because money may have moved", async (_name, answer) => {
    expect(await dispatch({ call: async () => answer as unknown as Outcome<unknown> })).toEqual({
      kind: "unknown",
      error: { code: "PROVIDER_ERROR", message: "provider returned no readable Outcome", retryable: true },
    });
  });

  test.each(["rejected", "unknown"] as const)("preserves a readable %s and its provider diagnostics", async (kind) => {
    const outcome = { kind, error: paymentError({ code: "TRANSPORT_ERROR", message: "gateway unavailable" }, { retryable: true, providerStatus: 503 }) };
    expect(await dispatch({ call: async () => outcome })).toEqual(outcome);
  });

  test.each([
    ["an absent payload", { kind: "ok" }],
    ["a null payload", { kind: "ok", value: null }],
  ])("an intent success with %s returns a typed unknown instead of crashing", async (_name, answer) => {
    const w = await world();
    w.scripted.queue("createIntent", answer as never);
    // Regression: dispatch currently accepts kind=ok without checking the result, then withNext
    // dereferences the absent value inside Tx2. The caller gets a TypeError and no typed outcome.
    const result = await w.service.createIntent({ scope: SCRIPTED, amount: USD(123), idempotencyKey: "malformed-ok", reference: "order-malformed" });
    expect(result).toMatchObject({ ok: false, error: { code: "PROVIDER_ERROR", retryable: true }, payment: { status: "unknown", amount: USD(123), captured: USD(0) } });
    if (result.ok || !result.payment) throw new Error("expected an unknown payment view");
    const after = await w.read(result.payment.id);
    expect(after.attempts).toEqual([expect.objectContaining({ op: "intent", outcome: "unknown", errorCode: "PROVIDER_ERROR" })]);
    expect(after.evidence).toEqual([]);
    expect(after.outbox).toEqual([]);
    expect(w.scripted.calls.map((call) => call.op)).toEqual(["createIntent"]);
  });

  test.each([
    ["a missing message", { code: "DECLINED", retryable: false }],
    ["a non-string message", { code: "DECLINED", message: 42, retryable: false }],
    ["a missing retry flag", { code: "DECLINED", message: "unreadable rejection" }],
  ])("keeps a capture unresolved when the provider rejection has %s", async (_name, error) => {
    const w = await world();
    const payment = await authorizedScripted(w);
    // Regression: readable() currently trusts only error.code. An incomplete PaymentError must
    // not close the attempt as a definitive rejection and permit a contradictory operation.
    w.scripted.queue("capture", { kind: "rejected", error } as never);
    const grant = await w.grant({ op: "capture", scope: SCRIPTED, paymentId: payment.id, amount: USD(321), idempotencyKey: "capture-malformed" });
    expect(await w.service.capture({ scope: SCRIPTED, paymentId: payment.id, amount: USD(321), idempotencyKey: "capture-malformed", grant }))
      .toMatchObject({ ok: false, error: { code: "PROVIDER_ERROR", message: "provider returned no readable Outcome", retryable: true }, payment: { status: "authorized", captured: USD(0) } });
    const after = await w.read(payment.id);
    expect(after.attempts.at(-1)).toMatchObject({ op: "capture", outcome: "unknown", errorCode: "PROVIDER_ERROR", amountMinor: 321, currency: "USD" });
    expect(after.payment).toMatchObject({ capturedMinor: 0, refundedMinor: 0, refundHeldMinor: 0 });
    expect(await w.service.void({ scope: SCRIPTED, paymentId: payment.id, idempotencyKey: "void-after-malformed", grant: "unused" }))
      .toMatchObject({ ok: false, error: { code: "INVALID_REQUEST", retryable: true, message: "a capture of this payment is still unresolved; retry once it is reconciled" } });
    expect(w.scripted.calls.map((call) => call.op)).toEqual(["createIntent", "capture"]);
  });
});
