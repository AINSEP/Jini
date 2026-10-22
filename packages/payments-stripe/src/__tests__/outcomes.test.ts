/**
 * Outcome mapping (bug B4): only a response that proves Stripe did not act is `rejected`; anything
 * that may have moved money is `unknown`. Each row drives a real `createIntent` through the fake
 * transport, so the mapping is tested where the kernel meets it.
 */
import { describe, expect, it } from "vitest";
import { classifyStripeFailure, createStripeProvider } from "../index.js";
import { fakeHttp, makeContext, type Scripted } from "./support.js";

const req = { amount: { minorUnits: 2000, currency: "USD" }, idempotencyKey: "k", correlationId: "pay_1", captureMode: "auto" as const };
const envelope = (status: number, type: string, code?: string) => ({ status, body: { error: { type, ...(code ? { code } : {}), message: `${type} happened` } } });

describe("createIntent outcome mapping", () => {
  it.each<[string, Scripted, string, string, boolean]>([
    ["a network error", { throws: new Error("ECONNRESET") }, "unknown", "TRANSPORT_ERROR", true],
    ["a timeout / abort", { throws: new DOMException("The operation timed out", "TimeoutError") }, "unknown", "TRANSPORT_ERROR", true],
    ["500 api_error", envelope(500, "api_error"), "unknown", "PROVIDER_ERROR", true],
    ["502 with an HTML body", { status: 502, text: "<html>Bad gateway</html>" }, "unknown", "PROVIDER_ERROR", true],
    ["409 idempotency_key_in_use", envelope(409, "invalid_request_error", "idempotency_key_in_use"), "unknown", "PROVIDER_ERROR", true],
    ["409 idempotency_key_in_use typed idempotency_error", envelope(409, "idempotency_error", "idempotency_key_in_use"), "unknown", "PROVIDER_ERROR", true],
    ["409 other concurrency conflict", envelope(409, "invalid_request_error", "lock_timeout"), "unknown", "PROVIDER_ERROR", true],
    ["409 idempotency mismatch", envelope(409, "idempotency_error"), "rejected", "IDEMPOTENCY_CONFLICT", false],
    ["400 idempotency mismatch", envelope(400, "idempotency_error"), "rejected", "IDEMPOTENCY_CONFLICT", false],
    ["402 card_error", envelope(402, "card_error", "card_declined"), "rejected", "DECLINED", false],
    ["400 invalid_request_error", envelope(400, "invalid_request_error", "parameter_invalid_integer"), "rejected", "INVALID_REQUEST", false],
    ["404 resource_missing", envelope(404, "invalid_request_error", "resource_missing"), "rejected", "INVALID_REQUEST", false],
    ["401 bad key", envelope(401, "invalid_request_error"), "rejected", "PROVIDER_ERROR", false],
    ["403 permission", envelope(403, "invalid_request_error", "secret_key_required"), "rejected", "PROVIDER_ERROR", false],
    ["429 rate limit", envelope(429, "invalid_request_error", "rate_limit"), "rejected", "PROVIDER_ERROR", true],
    ["an unexpected 418", { status: 418, body: {} }, "unknown", "PROVIDER_ERROR", true],
    ["a 302 redirect", { status: 302, text: "" }, "unknown", "PROVIDER_ERROR", true],
  ])("%s → %s %s", async (_label, answer, kind, code, retryable) => {
    const outcome = await createStripeProvider().createIntent({ req, ctx: makeContext(fakeHttp(answer)) });
    expect(outcome).toMatchObject({ kind, error: { code, retryable } });
  });
});

describe("classifyStripeFailure", () => {
  it("names status, type/code and Stripe's message, and records providerStatus", () => {
    expect(classifyStripeFailure({ status: 402, error: { type: "card_error", code: "card_declined", message: "Your card was declined." } })).toEqual({
      kind: "rejected",
      error: { code: "DECLINED", message: "stripe: HTTP 402 card_error/card_declined: Your card was declined.", retryable: false, providerStatus: 402 },
    });
  });

  it("falls back to a generic message when the envelope is empty", () => {
    expect(classifyStripeFailure({ status: 503, error: {} })).toEqual({
      kind: "unknown", error: { code: "PROVIDER_ERROR", message: "stripe: HTTP 503: request failed", retryable: true, providerStatus: 503 },
    });
  });

  it("ignores a malformed envelope (non-string fields, error not an object)", async () => {
    const odd = await createStripeProvider().createIntent({ req, ctx: makeContext(fakeHttp({ status: 402, body: { error: { type: 7, code: null, message: "" } } })) });
    expect(odd).toMatchObject({ kind: "rejected", error: { code: "DECLINED", message: "stripe: HTTP 402: request failed" } });
    const flat = await createStripeProvider().createIntent({ req, ctx: makeContext(fakeHttp({ status: 400, body: { error: "nope" } })) });
    expect(flat).toMatchObject({ kind: "rejected", error: { code: "INVALID_REQUEST" } });
  });
});
