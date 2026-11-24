/**
 * @file Pure rules for a small whole-number stepper (− / field / +) over host-injected bounds.
 * The typed-field rule reads one digit, so it is meant for ranges whose upper limit is a single digit.
 */

/** The inclusive range a stepper allows. The host owns the numbers (they are product policy). */
export interface StepperBounds {
  readonly min: number;
  readonly max: number;
}

/** `value` pulled into `bounds`. O(1). */
export function clampToBounds({ value, bounds }: { value: number; bounds: StepperBounds }, _options = {}): number {
  return Math.min(bounds.max, Math.max(bounds.min, value));
}

/** The spinbutton keys and where each one goes from `value`; `null` for any other key. O(1). */
export function stepperKeyTarget({ key, value, bounds }: { key: string; value: number; bounds: StepperBounds }, _options = {}): number | null {
  if (key === "ArrowUp") return Math.min(bounds.max, value + 1);
  if (key === "ArrowDown") return Math.max(bounds.min, value - 1);
  if (key === "Home") return bounds.min;
  if (key === "End") return bounds.max;
  return null;
}

/** A typed field's number: its last digit, clamped (the range is single digits, so typing after the
 * digit already there means the new one). `null` while the field holds no digit. O(text). */
export function numberFromTypedDigit({ text, bounds }: { text: string; bounds: StepperBounds }, _options = {}): number | null {
  const digit = text.replace(/\D/g, "").slice(-1);
  return digit === "" ? null : clampToBounds({ value: Number(digit), bounds });
}

/** The store's answer to a save as a whole number at or above the lower limit, clamped to the upper
 * one; anything else keeps what is shown (`current`). O(1). */
export function acceptedSavedValue({ value, current, bounds }: { value: unknown; current: number; bounds: StepperBounds }, _options = {}): number {
  return typeof value === "number" && Number.isInteger(value) && value >= bounds.min ? clampToBounds({ value, bounds }) : current;
}
