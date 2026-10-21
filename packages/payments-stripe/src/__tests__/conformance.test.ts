/**
 * The commerce provider conformance kit, run against the real Stripe provider. The fake transport
 * answers createIntent with Stripe's documented PaymentIntent object.
 */
import { describe, it } from "vitest";
import { providerConformanceCases } from "@jini-ai/commerce/payments/testkit";
import stripeProvider from "../index.js";
import { intentRequiresPaymentMethod } from "./fixtures/payment-intent.js";
import { fakeHttp, makeContext } from "./support.js";

describe("provider conformance (stripe)", () => {
  const cases = providerConformanceCases({
    provider: stripeProvider,
    makeContext: () => makeContext(fakeHttp({ status: 200, body: intentRequiresPaymentMethod })),
  });
  for (const testCase of cases) it(testCase.name, testCase.run);
});

describe("provider conformance with a failing transport", () => {
  const cases = providerConformanceCases({ provider: stripeProvider, makeContext: () => makeContext(fakeHttp({ throws: new Error("ETIMEDOUT") })) });
  for (const testCase of cases) it(testCase.name, testCase.run);
});
