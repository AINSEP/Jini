import { describe, expect, test } from "vitest";
import { addMoney, exponentOf, isCurrencyCode, money, moneyProblem, normalizeCurrency, toMajorString } from "../money.js";

describe("Money boundaries", () => {
  test.each(["", " ", "US", "USDD", "usd", "Usd", "1SD", "US$", "!USD", "USD!", " USD", "USD ", "USD\n", "U SD", "ÜSD"])(
    "currency shape rejects %j without silently trimming or folding case", currency => {
      expect(isCurrencyCode({ currency })).toBe(false);
    });

  test.each(["USD", "KES", "KWD", "AAA", "ZZZ"])("currency shape accepts the alpha-3 code %s", currency => {
    expect(isCurrencyCode({ currency })).toBe(true);
  });

  test.each([[" usd ", "USD"], ["\tKeS\n", "KES"], ["", null], ["  ", null], ["US", null], ["USDD", null], ["US$", null]] as const)(
    "normalizing %j produces %j", (raw, expected) => { expect(normalizeCurrency({ raw })).toBe(expected); });

  test.each([NaN, Infinity, -Infinity, 0.01, Number.MAX_SAFE_INTEGER + 1, Number.MIN_SAFE_INTEGER - 1])(
    "unsafe amount %s is rejected rather than rounded", minorUnits => {
      const value = { minorUnits, currency: "USD" };
      expect(moneyProblem({ money: value })).toBe("minorUnits must be a safe integer number of minor units");
      expect(() => money(value)).toThrow(new RangeError("minorUnits must be a safe integer number of minor units"));
    });

  test("zero requires the explicit catalog allowance and negative amounts are rejected with either policy", () => {
    expect(moneyProblem({ money: { minorUnits: 0, currency: "USD" } }, { allowZero: false })).toBe("minorUnits must be greater than zero");
    expect(money({ minorUnits: 0, currency: "jpy" }, { allowZero: true })).toEqual({ minorUnits: 0, currency: "JPY" });
    expect(() => money({ minorUnits: -1, currency: "USD" })).toThrow(new RangeError("minorUnits must be greater than zero"));
    expect(() => money({ minorUnits: -1, currency: "USD" }, { allowZero: true })).toThrow(new RangeError("minorUnits must not be negative"));
    expect(() => money({ minorUnits: 1, currency: "US$" })).toThrow(new RangeError("currency must be an uppercase ISO-4217 alpha-3 code, got 'US$'"));
    expect(money({ minorUnits: Number.MAX_SAFE_INTEGER, currency: " usd " })).toEqual({ minorUnits: Number.MAX_SAFE_INTEGER, currency: "USD" });
  });

  test("addition accepts the exact safe-integer boundary and refuses one unit beyond it", () => {
    expect(addMoney({ a: { minorUnits: Number.MAX_SAFE_INTEGER - 1, currency: "KWD" }, b: { minorUnits: 1, currency: "KWD" } }))
      .toEqual({ minorUnits: Number.MAX_SAFE_INTEGER, currency: "KWD" });
    expect(() => addMoney({ a: { minorUnits: Number.MAX_SAFE_INTEGER, currency: "KWD" }, b: { minorUnits: 1, currency: "KWD" } }))
      .toThrow(new RangeError("sum exceeds the safe integer range"));
    expect(() => addMoney({ a: { minorUnits: 1, currency: "JPY" }, b: { minorUnits: 1, currency: "USD" } }))
      .toThrow(new RangeError("cannot add JPY to USD"));
  });

  test.each([
    [0, "USD", "0.00"], [1, "USD", "0.01"], [99, "USD", "0.99"], [100, "USD", "1.00"], [101, "USD", "1.01"],
    [-101, "USD", "-1.01"], [0, "JPY", "0"], [1, "JPY", "1"], [-1, "JPY", "-1"],
    [0, "KWD", "0.000"], [1, "KWD", "0.001"], [999, "KWD", "0.999"], [1000, "KWD", "1.000"], [-1001, "KWD", "-1.001"],
    [Number.MAX_SAFE_INTEGER, "KWD", "9007199254740.991"], [Number.MIN_SAFE_INTEGER, "USD", "-90071992547409.91"],
  ] as const)("%s minor units of %s format exactly as %s", (minorUnits, currency, expected) => {
    expect(toMajorString({ money: { minorUnits, currency } })).toBe(expected);
  });

  test.each(["BIF", "CLP", "DJF", "GNF", "ISK", "JPY", "KMF", "KRW", "PYG", "RWF", "UGX", "UYI", "VND", "VUV", "XAF", "XOF", "XPF"])(
    "%s uses zero fractional digits", currency => { expect(exponentOf({ currency })).toBe(0); });
  test.each(["BHD", "IQD", "JOD", "KWD", "LYD", "OMR", "TND"])(
    "%s uses three fractional digits", currency => { expect(exponentOf({ currency })).toBe(3); });
  test("other currency codes use two fractional digits", () => { expect(exponentOf({ currency: "EUR" })).toBe(2); });
});
