import { describe, expect, it, vi } from "vitest";
import type { ProviderContext } from "@jini-ai/commerce/payments/kernel";
import { stripeOutcome, stripeRequest } from "../http.js";

const context = (send: ProviderContext["httpClient"]["send"]): ProviderContext => ({
  credentials: { secretKey: "test-secret" }, account: { providerAccountId: "acct_1", mode: "test" },
  httpClient: { send }, now: () => 0, webhookUrl: "https://shop.test/hook",
  returnUrl: "https://shop.test/return", cancelUrl: "https://shop.test/cancel",
});
const unknown = (code: string) => ({ kind: "unknown", error: { code, message: expect.any(String), retryable: true } });

describe("Stripe HTTP outcomes", () => {
  it.each([200, 201, 299])("accepts a JSON object on %i", status => {
    expect(stripeOutcome({ status, json: { id: "cs_1" } }, {})).toEqual({ kind: "ok", value: { id: "cs_1" } });
  });
  it.each([null, [], "ok", 1, true, undefined])("keeps a non-object success unresolved: %j", json => {
    expect(stripeOutcome({ status: 200, json })).toEqual({ ...unknown("PROVIDER_ERROR"), error: { ...unknown("PROVIDER_ERROR").error, providerStatus: 200 } });
  });
  it.each([
    [500, "card_error", undefined, "unknown", "PROVIDER_ERROR", true],
    [503, undefined, undefined, "unknown", "PROVIDER_ERROR", true],
    [409, undefined, "idempotency_key_in_use", "unknown", "PROVIDER_ERROR", true],
    [400, "idempotency_error", undefined, "rejected", "IDEMPOTENCY_CONFLICT", false],
    [402, undefined, undefined, "rejected", "DECLINED", false],
    [400, "card_error", undefined, "rejected", "DECLINED", false],
    [422, "card_error", undefined, "rejected", "DECLINED", false],
    [400, "invalid_request_error", undefined, "rejected", "INVALID_REQUEST", false],
    [404, undefined, undefined, "rejected", "INVALID_REQUEST", false],
    [401, "card_error", undefined, "rejected", "NO_CREDENTIALS_CONFIGURED", false],
    [403, undefined, undefined, "rejected", "NO_CREDENTIALS_CONFIGURED", false],
    [429, undefined, undefined, "rejected", "PROVIDER_ERROR", true],
    [302, undefined, undefined, "unknown", "PROVIDER_ERROR", true],
    [418, undefined, undefined, "unknown", "PROVIDER_ERROR", true],
    [199, undefined, undefined, "unknown", "PROVIDER_ERROR", true],
  ] as const)("classifies %i / %s / %s", (status, type, code, kind, expectedCode, retryable) => {
    const result = stripeOutcome({ status, json: { error: { type, code, message: "sensitive provider text" } } });
    expect(result).toEqual({ kind, error: { code: expectedCode, retryable, providerStatus: status, message: expect.any(String) } });
    expect(JSON.stringify(result)).not.toContain("sensitive provider text");
  });
  it.each([null, [], { error: null }, { error: [] }, { error: "invalid" }])("classifies status despite malformed error %j", json => {
    expect(stripeOutcome({ status: 400, json })).toMatchObject({ kind: "rejected", error: { code: "INVALID_REQUEST", retryable: false, providerStatus: 400 } });
  });
});

describe("Stripe HTTP requests", () => {
  it("uses the injected transport, Bearer auth and lossless nested form encoding exactly once", async () => {
    const send = vi.fn(async () => ({ status: 200, headers: {}, bodyText: '{"id":"cs_1"}' }));
    const form = [["line_items[0][price_data][product_data][name]", "Tea & cake"], ["expand[]", "a"], ["expand[]", "b"]] as const;
    expect(await stripeRequest({ ctx: context(send), method: "POST", path: "/v1/checkout/sessions" }, { form, idempotencyKey: "order:1" })).toEqual({ kind: "ok", value: { id: "cs_1" } });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith({ request: {
      method: "POST", url: "https://api.stripe.com/v1/checkout/sessions",
      headers: { Authorization: "Bearer test-secret", "Content-Type": "application/x-www-form-urlencoded", "Idempotency-Key": "order:1" },
      body: "line_items%5B0%5D%5Bprice_data%5D%5Bproduct_data%5D%5Bname%5D=Tea+%26+cake&expand%5B%5D=a&expand%5B%5D=b",
      timeoutMs: 30_000, totalDeadlineMs: 30_000,
    } });
  });
  it("omits body, content type and idempotency header when absent", async () => {
    const send = vi.fn(async () => ({ status: 404, headers: {}, bodyText: "not JSON" }));
    expect(await stripeRequest({ ctx: context(send), method: "GET", path: "/v1/checkout/sessions/cs_1?expand[]=payment_intent" })).toMatchObject({ kind: "rejected", error: { code: "INVALID_REQUEST" } });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith({ request: {
      method: "GET", url: "https://api.stripe.com/v1/checkout/sessions/cs_1?expand[]=payment_intent",
      headers: { Authorization: "Bearer test-secret" }, timeoutMs: 30_000, totalDeadlineMs: 30_000,
    } });
  });
  it("keeps an unparseable success unresolved", async () => {
    const send = vi.fn(async () => ({ status: 200, headers: {}, bodyText: "{" }));
    expect(await stripeRequest({ ctx: context(send), method: "POST", path: "/v1/checkout/sessions" }, { form: [], idempotencyKey: "" })).toMatchObject({ kind: "unknown", error: { code: "PROVIDER_ERROR", retryable: true } });
    expect(send).toHaveBeenCalledWith({ request: {
      method: "POST", url: "https://api.stripe.com/v1/checkout/sessions", body: "",
      headers: { Authorization: "Bearer test-secret", "Content-Type": "application/x-www-form-urlencoded", "Idempotency-Key": "" },
      timeoutMs: 30_000, totalDeadlineMs: 30_000,
    } });
  });
  it("keeps a transport throw unresolved without retrying or exposing credentials", async () => {
    const send = vi.fn(async () => { throw new Error("test-secret"); });
    const result = await stripeRequest({ ctx: context(send), method: "POST", path: "/v1/checkout/sessions" });
    expect(result).toEqual(unknown("TRANSPORT_ERROR"));
    expect(JSON.stringify(result)).not.toContain("test-secret");
    expect(send).toHaveBeenCalledTimes(1);
  });
});
