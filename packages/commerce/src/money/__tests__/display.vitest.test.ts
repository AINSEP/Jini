import { expect, it } from "vitest";
import { formatMoney } from "../money.js";

it.each([
  ["USD", 3500, "$35.00"], ["EUR", 9900, "€99.00"], ["JPY", 2800, "¥2,800"],
  ["KWD", 1234, "KWD 1.234"], ["JPY", 0, "¥0"], ["USD", 1, "$0.01"],
] as const)("formats %s %i minor units with its own currency precision", (currency, minorUnits, expected) => {
  expect(formatMoney({ money: { currency, minorUnits } }, {})).toBe(expected);
});
