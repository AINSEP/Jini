import { describe, expect, it, vi } from "vitest";
import { createStripeProvider } from "../index.js";
import { StripeProviderConfigError } from "../configuration.js";
import type { ProviderContext } from "../contract.js";
import { fromStripeAmount, toStripeAmount } from "../amount.js";
import { stripeOutcome } from "../http.js";
import { createStripePaymentProvider } from "../provider.js";
import { recordingHelpers } from "./fakes/domain-helpers.js";

const ctx: ProviderContext = { credentials: { secretKey: "sk_test_only", webhookSecret: "whsec_test_only" },
  account: { providerAccountId: "acct_1", mode: "test" }, httpClient: { send: vi.fn() }, now: () => 1730000123000,
  returnUrl: "https://shop.test/return", cancelUrl: "https://shop.test/cancel", webhookUrl: "https://shop.test/hook" };

describe("Stripe provider takes the domain's helpers instead of importing them", () => {
  it("webhook authenticity: a bad signature is rejected with the helper's SIGNATURE_INVALID error, built once with these exact arguments", async () => {
    const { helpers, calls } = recordingHelpers();
    const provider = createStripePaymentProvider({ errors: helpers });
    const result = await provider.verifyWebhook({ rawBody: new TextEncoder().encode("{}"), headers: { "stripe-signature": "t=1,v1=00" }, ctx });
    expect(result).toEqual({ kind: "rejected", error: { code: "SIGNATURE_INVALID", message: "fake:invalid webhook signature", retryable: false } });
    expect(calls.paymentError).toEqual([[{ code: "SIGNATURE_INVALID", message: "invalid webhook signature" }]]);
    expect(ctx.httpClient.send).not.toHaveBeenCalled();
  });

  it("amount integrity: moneyProblem decides, with allowZero, and its verdict refuses the amount", () => {
    const money = { minorUnits: 100, currency: "USD" };
    const accepting = recordingHelpers({ problem: null });
    expect(toStripeAmount({ money, errors: accepting.helpers })).toEqual({ amount: 100, currency: "usd" });
    expect(accepting.calls.moneyProblem).toEqual([[{ money }, { allowZero: true }]]);
    const refusing = recordingHelpers({ problem: "minorUnits must be a safe integer number of minor units" });
    expect(toStripeAmount({ money, errors: refusing.helpers })).toBeNull();
    expect(fromStripeAmount({ amount: 100, currency: "usd", errors: refusing.helpers })).toBeNull();
    expect(refusing.calls.moneyProblem).toHaveLength(2);
  });

  it("a rejected card carries the helper's DECLINED error with the provider status and no retry", () => {
    const { helpers, calls } = recordingHelpers();
    const outcome = stripeOutcome({ status: 402, json: { error: { type: "card_error" } }, errors: helpers });
    expect(outcome).toEqual({ kind: "rejected", error: { code: "DECLINED", message: "fake:payment provider request did not confirm success", retryable: false, providerStatus: 402 } });
    expect(calls.paymentError).toEqual([[{ code: "DECLINED", message: "payment provider request did not confirm success" }, { retryable: false, providerStatus: 402 }]]);
  });
});

describe("createStripeProvider reads optional.context at initialize", () => {
  it("builds its port from the helpers the host's contract registered", async () => {
    const { helpers, calls } = recordingHelpers();
    const resource = createStripeProvider({}, { context: helpers });
    const result = await resource.port.verifyWebhook({ rawBody: new TextEncoder().encode("{}"), headers: {}, ctx });
    expect(result).toMatchObject({ kind: "rejected", error: { message: "fake:invalid webhook signature" } });
    expect(calls.paymentError).toHaveLength(1);
  });

  it.each([
    ["no context at all", {}, "paymentError, moneyProblem"],
    ["a context without moneyProblem", { context: { paymentError: () => ({}) } }, "moneyProblem"],
    ["a paymentError that is not a function", { context: { paymentError: "x", moneyProblem: () => null } }, "paymentError"],
    ["a context that is not an object", { context: 7 }, "paymentError, moneyProblem"],
  ])("fails at initialize, in plain words, with %s", (_name, optional, missing) => {
    let thrown: unknown;
    try { createStripeProvider({}, optional); } catch (error) { thrown = error; }
    expect(thrown).toBeInstanceOf(StripeProviderConfigError);
    const error = thrown as StripeProviderConfigError;
    expect(error.code).toBe("payments_stripe_context_missing");
    expect(error.message).toBe("The Stripe payment provider was started without the payment helpers it needs, so it cannot take payments. Restart the app; if this keeps happening, copy the details into a bug report.");
    expect(error.details).toContain(missing);
  });
});
