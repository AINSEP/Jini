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
  test.each(["workspaceId", "siteId", "providerId", "providerAccountId"] as const)("a different %s never names the same payment scope", (field) => {
    const other = { ...scope, [field]: "other" };
    expect(sameScope({ a: scope, b: other })).toBe(false);
    expect(sameScope({ a: other, b: scope })).toBe(false);
  });
  test("test mode is a valid scope independent of live mode", () => {
    const testScope = { ...scope, mode: "test" as const };
    expect(scopeProblem({ scope: testScope })).toBeNull();
    expect(sameScope({ a: testScope, b: { ...testScope } })).toBe(true);
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
  test("an empty provider currency allowlist accepts no currency", () => {
    const capabilities = { currencies: [] } as unknown as ProviderCapabilities;
    expect(supportsCurrency({ capabilities, currency: "USD" })).toBe(false);
  });
  test("explicit false retryability and a zero provider status are preserved", () => {
    expect(paymentError({ code: "PROVIDER_ERROR", message: "unavailable" }, { retryable: false, providerStatus: 0 }))
      .toEqual({ code: "PROVIDER_ERROR", message: "unavailable", retryable: false, providerStatus: 0 });
  });
  test("DI tokens carry their ids and cardinality", () => {
    expect(PaymentProviderToken).toEqual({ id: "commerce.payments.provider", version: 1, cardinality: "many" });
    expect(PaymentsPortToken.cardinality).toBe("one");
    expect(PreChargeRiskPortToken.id).toBe("commerce.payments.preChargeRisk");
  });
});
