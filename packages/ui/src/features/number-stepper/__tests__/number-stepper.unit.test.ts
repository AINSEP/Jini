import { describe, expect, it } from "vitest";
import { acceptedSavedValue, clampToBounds, numberFromTypedDigit, stepperKeyTarget } from "../number-stepper.js";

const bounds = { min: 1, max: 5 };

describe("number-stepper rules", () => {
  it("clamps into the injected bounds at both ends", () => {
    expect([-3, 0, 1, 3, 5, 6, 99].map((value) => clampToBounds({ value, bounds }))).toEqual([1, 1, 1, 3, 5, 5, 5]);
    expect(clampToBounds({ value: 7, bounds: { min: 2, max: 8 } })).toBe(7);
  });

  it("maps the spinbutton keys and stops at the upper and lower limits", () => {
    expect(stepperKeyTarget({ key: "ArrowUp", value: 2, bounds })).toBe(3);
    expect(stepperKeyTarget({ key: "ArrowUp", value: 5, bounds })).toBe(5);
    expect(stepperKeyTarget({ key: "ArrowDown", value: 2, bounds })).toBe(1);
    expect(stepperKeyTarget({ key: "ArrowDown", value: 1, bounds })).toBe(1);
    expect(stepperKeyTarget({ key: "Home", value: 4, bounds })).toBe(1);
    expect(stepperKeyTarget({ key: "End", value: 2, bounds })).toBe(5);
    expect(stepperKeyTarget({ key: "Enter", value: 2, bounds })).toBeNull();
  });

  it("reads a typed field as its last digit, clamped; no digit is null", () => {
    expect(numberFromTypedDigit({ text: "4", bounds })).toBe(4);
    expect(numberFromTypedDigit({ text: "9", bounds })).toBe(5);
    expect(numberFromTypedDigit({ text: "0", bounds })).toBe(1);
    expect(numberFromTypedDigit({ text: "13", bounds })).toBe(3);
    expect(numberFromTypedDigit({ text: "a2b", bounds })).toBe(2);
    expect(numberFromTypedDigit({ text: "", bounds })).toBeNull();
    expect(numberFromTypedDigit({ text: "x", bounds })).toBeNull();
  });

  it("accepts a persisted whole number at or above the lower limit, clamping anything above the upper limit", () => {
    expect(acceptedSavedValue({ value: 3, current: 2, bounds })).toBe(3);
    expect(acceptedSavedValue({ value: 9, current: 2, bounds })).toBe(5);
    for (const value of [0, -1, 2.5, "3", null, undefined, Number.NaN]) expect(acceptedSavedValue({ value, current: 2, bounds })).toBe(2);
  });
});
