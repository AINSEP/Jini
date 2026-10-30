import { describe, expect, it } from "vitest";
import { fromStripeAmount, STRIPE_CURRENCIES, toStripeAmount } from "../amount.js";

const currencies = ["AUD", "BRL", "CAD", "CHF", "CZK", "DKK", "EUR", "GBP", "HKD", "JPY", "KRW", "MXN", "NOK", "NZD", "PLN", "SEK", "SGD", "USD"];

describe("Stripe minor-unit amounts", () => {
  it("declares exactly the approved currency list", () => {
    expect(STRIPE_CURRENCIES).toEqual(currencies);
  });

  it.each(currencies)("preserves minor units for %s, including zero-decimal currencies", currency => {
    for (const minorUnits of [0, 1, 1234, Number.MAX_SAFE_INTEGER]) {
      const money = { minorUnits, currency };
      const encoded = { amount: minorUnits, currency: currency.toLowerCase() };
      expect(toStripeAmount({ money })).toEqual(encoded);
      expect(fromStripeAmount(encoded)).toEqual(money);
    }
  });

  it.each(["ISK", "UGX", "HUF", "TWD", "KWD", "MGA", "ZZZ"])("refuses excluded currency %s in both directions", currency => {
    expect(toStripeAmount({ money: { minorUnits: 100, currency } })).toBeNull();
    expect(fromStripeAmount({ amount: 100, currency: currency.toLowerCase() })).toBeNull();
  });

  it.each([-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])("refuses invalid amount %s in both directions", amount => {
    expect(toStripeAmount({ money: { minorUnits: amount, currency: "USD" } })).toBeNull();
    expect(fromStripeAmount({ amount, currency: "usd" })).toBeNull();
  });

  it.each(["100", null, undefined, {}, true])("does not coerce provider amount %j", amount => {
    expect(fromStripeAmount({ amount, currency: "usd" })).toBeNull();
  });

  it.each([null, undefined, 123, {}, "", " usd "])("refuses invalid provider currency %j", currency => {
    expect(fromStripeAmount({ amount: 100, currency })).toBeNull();
  });

  it("keeps Money uppercase while accepting uppercase provider currency", () => {
    expect(toStripeAmount({ money: { minorUnits: 100, currency: "usd" } }, {})).toBeNull();
    expect(fromStripeAmount({ amount: 100, currency: "USD" }, {})).toEqual({ minorUnits: 100, currency: "USD" });
    expect(toStripeAmount({ money: { minorUnits: 100, currency: "USD" } }, {})).toEqual({ amount: 100, currency: "usd" });
  });
});
