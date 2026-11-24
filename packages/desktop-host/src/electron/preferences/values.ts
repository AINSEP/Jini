/** Pure checks for numeric and enumerated preference values; the host owns the bounds and choices. */

/** Inclusive whole-number bounds a host chooses for a stepper or radio group. */
export interface WholeNumberBounds { min: number; max: number }

/** The value when it is a safe whole number above zero, else undefined. O(1). */
export function positiveWholeNumber({ value }: { value: unknown }, _optional = {}): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

/** Clamp into the inclusive bounds; callers validate that `value` is a whole number first. O(1). */
export function clampWholeNumber({ value, bounds }: { value: number; bounds: WholeNumberBounds }, _optional = {}): number {
  return Math.min(bounds.max, Math.max(bounds.min, value));
}

/** Every whole number from min to max, in order. O(max - min). */
export function wholeNumberSteps({ bounds }: { bounds: WholeNumberBounds }, _optional = {}): number[] {
  return Array.from({ length: bounds.max - bounds.min + 1 }, (_, index) => bounds.min + index);
}

/** The shipped choice equal to `value`, or undefined. O(choices). */
export function choiceOf<T>({ value, choices }: { value: unknown; choices: readonly T[] }, _optional = {}): T | undefined {
  return choices.find(choice => choice === value);
}
