import { describe, expect, test } from "vitest";
import { addMoney, exponentOf, isCurrencyCode, money, moneyProblem, normalizeCurrency, toMajorString } from "../money.js";

describe("Money", () => {
  test("currency shape is UPPERCASE alpha-3 only", () => {
    expect(isCurrencyCode({ currency: "USD" })).toBe(true);
    expect(isCurrencyCode({ currency: "usd" })).toBe(false);
    expect(isCurrencyCode({ currency: "US" })).toBe(false);
  });

  test("exponent table: default 2, zero- and three-decimal currencies", () => {
    expect(exponentOf({ currency: "USD" })).toBe(2);
    expect(exponentOf({ currency: "JPY" })).toBe(0);
    expect(exponentOf({ currency: "KWD" })).toBe(3);
  });

  test("normalizeCurrency upper-cases legacy lowercase input and refuses non-codes", () => {
    expect(normalizeCurrency({ raw: " usd " })).toBe("USD");
    expect(normalizeCurrency({ raw: "dollars" })).toBeNull();
  });

  test("moneyProblem names each defect", () => {
    expect(moneyProblem({ money: { minorUnits: 100, currency: "USD" } })).toBeNull();
    expect(moneyProblem({ money: { minorUnits: 100, currency: "usd" } })).toMatch(/uppercase ISO-4217/);
    expect(moneyProblem({ money: { minorUnits: 1.5, currency: "USD" } })).toMatch(/safe integer/);
    expect(moneyProblem({ money: { minorUnits: Number.MAX_SAFE_INTEGER + 1, currency: "USD" } })).toMatch(/safe integer/);
    expect(moneyProblem({ money: { minorUnits: 0, currency: "USD" } })).toBe("minorUnits must be greater than zero");
    expect(moneyProblem({ money: { minorUnits: -1, currency: "USD" } })).toBe("minorUnits must be greater than zero");
    expect(moneyProblem({ money: { minorUnits: 0, currency: "USD" } }, { allowZero: true })).toBeNull();
    expect(moneyProblem({ money: { minorUnits: -1, currency: "USD" } }, { allowZero: true })).toBe("minorUnits must not be negative");
  });

  test("money() normalizes the currency and throws on invalid input", () => {
    expect(money({ minorUnits: 5, currency: "eur" })).toEqual({ minorUnits: 5, currency: "EUR" });
    expect(money({ minorUnits: 0, currency: "EUR" }, { allowZero: true })).toEqual({ minorUnits: 0, currency: "EUR" });
    expect(() => money({ minorUnits: 0, currency: "EUR" })).toThrow(RangeError);
    expect(() => money({ minorUnits: 5, currency: "euro" })).toThrow(/got 'euro'/);
  });

  test("addMoney refuses mixed currencies and unsafe sums", () => {
    expect(addMoney({ a: { minorUnits: 1, currency: "USD" }, b: { minorUnits: 2, currency: "USD" } })).toEqual({ minorUnits: 3, currency: "USD" });
    expect(() => addMoney({ a: { minorUnits: 1, currency: "USD" }, b: { minorUnits: 2, currency: "EUR" } })).toThrow(/cannot add USD to EUR/);
    expect(() => addMoney({ a: { minorUnits: Number.MAX_SAFE_INTEGER, currency: "USD" }, b: { minorUnits: 1, currency: "USD" } })).toThrow(/safe integer/);
  });

  test("toMajorString honours the exponent and sign", () => {
    expect(toMajorString({ money: { minorUnits: 1234, currency: "USD" } })).toBe("12.34");
    expect(toMajorString({ money: { minorUnits: 5, currency: "USD" } })).toBe("0.05");
    expect(toMajorString({ money: { minorUnits: -5, currency: "USD" } })).toBe("-0.05");
    expect(toMajorString({ money: { minorUnits: 500, currency: "JPY" } })).toBe("500");
    expect(toMajorString({ money: { minorUnits: 1234, currency: "KWD" } })).toBe("1.234");
    expect(toMajorString({ money: { minorUnits: Number.MAX_SAFE_INTEGER, currency: "USD" } })).toBe("90071992547409.91");
  });
});
