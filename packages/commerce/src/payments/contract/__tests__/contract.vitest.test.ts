import { describe, expect, test } from "vitest";
import { paymentError, supportsCurrency, type ProviderCapabilities } from "../provider.js";
import { sameScope, scopeProblem, type PaymentScope } from "../scope.js";
import { PaymentProviderToken, PaymentsPortToken, PreChargeRiskPortToken } from "../tokens.js";

const scope: PaymentScope = { workspaceId: "ws", siteId: "site", providerId: "stripe", providerAccountId: "acct_1", mode: "live" };

describe("PaymentScope", () => {
  test("a complete scope has no problem", () => expect(scopeProblem({ scope })).toBeNull());
  test.each(["workspaceId", "siteId", "providerId", "providerAccountId"] as const)("empty %s is refused", (field) => {
    expect(scopeProblem({ scope: { ...scope, [field]: "  " } })).toBe(`scope.${field} must be a non-empty string`);
  });
  test("an unknown mode is refused", () => {
    expect(scopeProblem({ scope: { ...scope, mode: "sandbox" as never } })).toBe('scope.mode must be "test" or "live"');
  });
  test("sameScope compares every field including mode", () => {
    expect(sameScope({ a: scope, b: { ...scope } })).toBe(true);
    expect(sameScope({ a: scope, b: { ...scope, mode: "test" } })).toBe(false);
    expect(sameScope({ a: scope, b: { ...scope, siteId: "other" } })).toBe(false);
  });
});

describe("provider helpers", () => {
  test("paymentError defaults retryable=false and omits an absent providerStatus", () => {
    expect(paymentError({ code: "DECLINED", message: "no" })).toEqual({ code: "DECLINED", message: "no", retryable: false });
    expect(paymentError({ code: "TRANSPORT_ERROR", message: "t" }, { retryable: true, providerStatus: 503 })).toEqual({
      code: "TRANSPORT_ERROR", message: "t", retryable: true, providerStatus: 503,
    });
  });
  test("supportsCurrency accepts 'any' or a listed code", () => {
    const caps = { currencies: ["USD"] } as unknown as ProviderCapabilities;
    expect(supportsCurrency({ capabilities: caps, currency: "USD" })).toBe(true);
    expect(supportsCurrency({ capabilities: caps, currency: "EUR" })).toBe(false);
    expect(supportsCurrency({ capabilities: { ...caps, currencies: "any" }, currency: "EUR" })).toBe(true);
  });
  test("DI tokens carry their ids and cardinality", () => {
    expect(PaymentProviderToken).toEqual({ id: "commerce.payments.provider", version: 1, cardinality: "many" });
    expect(PaymentsPortToken.cardinality).toBe("one");
    expect(PreChargeRiskPortToken.id).toBe("commerce.payments.preChargeRisk");
  });
});
