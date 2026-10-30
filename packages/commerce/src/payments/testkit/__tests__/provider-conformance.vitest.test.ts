import { describe, expect, it, vi } from "vitest";
import type { PaymentProvider, ProviderContext } from "../../contract/provider.js";
import { providerConformanceCases, type ProviderConformanceCase } from "../index.js";
import { lipayFakeContext } from "../lipay-fake.js";

const declined = { kind: "rejected", error: { code: "SIGNATURE_INVALID", message: "bad signature", retryable: false } } as const;

function conforming(overrides: Record<string, unknown> = {}): PaymentProvider {
  const settled = async () => ({ kind: "ok", value: { providerRef: "pi_1", status: "succeeded" } });
  return {
    id: "fake",
    displayName: "Fake Pay",
    capabilities: { refunds: "partial", capture: "manual", void: true, disputes: true, retrieve: "payment+refunds", echoesCorrelation: true, confirmation: ["none", "redirect"], currencies: ["USD"] },
    credentialKeys: ["secretKey", "webhookSecret"],
    createIntent: vi.fn(async () => ({ kind: "ok", value: { evidence: { providerRef: "pi_1", status: "pending" }, next: { kind: "none" } } })),
    refund: settled,
    capture: settled,
    void: settled,
    retrieve: settled,
    verifyWebhook: vi.fn(async () => declined),
    ...overrides,
  } as unknown as PaymentProvider;
}

const context = { credentials: { secretKey: "sk_test" }, account: { providerAccountId: "acct_1", mode: "test" }, httpClient: { send: vi.fn() }, now: () => 0, webhookUrl: "https://shop.example/hooks", returnUrl: "https://shop.example/return", cancelUrl: "https://shop.example/cancel" } as unknown as ProviderContext;

function cases(provider: PaymentProvider, optional = {}) {
  const makeContext = vi.fn(() => context);
  const list = providerConformanceCases({ provider, makeContext }, optional);
  const byName = (prefix: string): ProviderConformanceCase => list.find((entry) => entry.name.startsWith(prefix))!;
  return { list, makeContext, byName };
}

describe("providerConformanceCases", () => {
  it("provides the cancellation URL to both provider calls", async () => {
    const provider = conforming();
    for (const entry of providerConformanceCases({ provider, makeContext: () => lipayFakeContext({ now: () => 0 }) })) await entry.run();
    expect(vi.mocked(provider.createIntent).mock.calls[0]![0].ctx.cancelUrl).toBe("https://example.test/cancel");
    expect(vi.mocked(provider.verifyWebhook).mock.calls[0]![0].ctx.cancelUrl).toBe("https://example.test/cancel");
  });

  it("returns the four skeleton cases in a stable order", () => {
    expect(cases(conforming()).list.map((entry) => entry.name)).toEqual([
      "identity and shape: passes isPaymentProviderModule",
      "capabilities consistency: every promised operation has its method",
      "verifyWebhook: a garbage body is rejected and never throws",
      "createIntent: returns an Outcome and never throws",
    ]);
  });

  it("a conforming provider passes every case, with a fresh context per provider call", async () => {
    const provider = conforming();
    const { list, makeContext } = cases(provider);
    for (const entry of list) await expect(entry.run()).resolves.toBeUndefined();
    expect(makeContext).toHaveBeenCalledTimes(2);
    expect(provider.createIntent).toHaveBeenCalledWith({
      req: { amount: { minorUnits: 1000, currency: "USD" }, idempotencyKey: "conformance-intent-1", correlationId: "pay_conformance_1", captureMode: "manual" },
      ctx: context,
    });
    const webhookCall = vi.mocked(provider.verifyWebhook).mock.calls[0]![0];
    expect(webhookCall.headers).toEqual({});
    expect(new TextDecoder().decode(webhookCall.rawBody)).toBe("not a webhook \u0000ÿ{");
  });

  it("a minimal auto-capture provider with no optional methods also conforms", async () => {
    const minimal = conforming({ capabilities: { refunds: "none", capture: "auto", void: false, disputes: false, retrieve: "none", echoesCorrelation: false, confirmation: ["none"], currencies: "any" }, refund: undefined, capture: undefined, void: undefined, retrieve: undefined, createIntent: vi.fn(async () => declined) });
    for (const entry of cases(minimal).list) await expect(entry.run()).resolves.toBeUndefined();
    expect(vi.mocked(minimal.createIntent).mock.calls[0]![0].req.captureMode).toBe("auto");
  });

  it("passes the caller's intent request and garbage webhook through instead of the defaults", async () => {
    const provider = conforming();
    const intentRequest = { amount: { minorUnits: 5, currency: "KES" }, idempotencyKey: "k", correlationId: "c", captureMode: "auto" as const };
    const garbageWebhook = { rawBody: new Uint8Array([1, 2]), headers: { "x-signature": "forged" } };
    for (const entry of cases(provider, { intentRequest, garbageWebhook }).list) await entry.run();
    expect(provider.createIntent).toHaveBeenCalledWith({ req: intentRequest, ctx: context });
    expect(provider.verifyWebhook).toHaveBeenCalledWith({ ...garbageWebhook, ctx: context });
  });
});

describe("a broken provider fails the case that names its fault", () => {
  it("a shape fault fails every behaviour case with the guard's reason, before any provider call", async () => {
    const provider = conforming({ displayName: undefined });
    for (const entry of cases(provider).list.filter((c) => !c.name.startsWith("capabilities"))) {
      await expect(entry.run()).rejects.toThrow("provider shape is invalid: displayName must be a string");
    }
    // The capabilities case checks only capability↔method consistency, which this provider satisfies.
    await expect(cases(provider).byName("capabilities").run()).resolves.toBeUndefined();
    expect(provider.createIntent).not.toHaveBeenCalled();
    expect(provider.verifyWebhook).not.toHaveBeenCalled();
  });

  it("capabilities that promise missing methods are each named", async () => {
    const provider = conforming({ refund: undefined, capture: undefined, void: undefined, retrieve: undefined });
    await expect(cases(provider).byName("capabilities").run()).rejects.toThrow(
      'capabilities promise operations the provider does not implement: capabilities.refunds !== "none" but refund() is missing; capabilities.capture === "manual" but capture() is missing; capabilities.void === true but void() is missing; capabilities.retrieve !== "none" but retrieve() is missing'
    );
  });

  it.each([
    ["accepts a garbage body", async () => ({ kind: "ok", value: [] }), "verifyWebhook must reject a garbage body"],
    ["answers unknown for a garbage body", async () => ({ kind: "unknown", error: { code: "TRANSPORT_ERROR", message: "x", retryable: true } }), "verifyWebhook must reject a garbage body"],
    ["rejects with an error", async () => { throw new Error("hmac blew up"); }, "verifyWebhook threw instead of returning an Outcome: Error: hmac blew up"],
    ["throws synchronously", () => { throw new TypeError("sync"); }, "verifyWebhook threw instead of returning an Outcome: TypeError: sync"],
    ["resolves to nothing", async () => undefined, "verifyWebhook must resolve to an Outcome"],
    ["resolves to null", async () => null, "verifyWebhook must resolve to an Outcome"],
    ["resolves to an unknown kind", async () => ({ kind: "maybe" }), "verifyWebhook must resolve to an Outcome"],
    ["omits the PaymentError", async () => ({ kind: "unknown" }), 'verifyWebhook: an Outcome of kind "unknown" must carry a PaymentError'],
  ])("verifyWebhook that %s fails", async (_label, verifyWebhook, message) => {
    await expect(cases(conforming({ verifyWebhook })).byName("verifyWebhook").run()).rejects.toThrow(message);
  });

  it.each([
    ["rejects with an error", async () => { throw new Error("network down"); }, "createIntent threw instead of returning an Outcome: Error: network down"],
    ["throws synchronously", () => { throw new Error("sync"); }, "createIntent threw instead of returning an Outcome: Error: sync"],
    ["resolves to a bare value", async () => ({ providerRef: "pi_1" }), "createIntent must resolve to an Outcome"],
    ["omits the PaymentError code", async () => ({ kind: "rejected", error: {} }), 'createIntent: an Outcome of kind "rejected" must carry a PaymentError'],
  ])("createIntent that %s fails", async (_label, createIntent, message) => {
    await expect(cases(conforming({ createIntent })).byName("createIntent").run()).rejects.toThrow(message);
  });
});
