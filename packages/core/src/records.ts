/** @file Pure object-shape predicates shared by tool input readers and render-time decoders. */
/** Accept any non-null object, including arrays; never sanitizes or reads properties.
 * @complexity O(1) time and space.
 * @example isRecord({ value: [] }); // true
 */
export function isRecord(required: { value: unknown }, _optional: Record<string, never> = {}): required is { value: Record<string, unknown> } {
  const { value } = required;
  return typeof value === "object" && value !== null;
}

/**
 * Accepts non-null, non-array objects, including class instances and null-prototype records.
 * This is a shape check, not plain-object validation or sanitization. Keep `isRecord`'s
 * broader contract: existing tool readers deliberately continue to accept arrays.
 * @param required.value - The untrusted value whose object shape is checked.
 * @complexity O(1) time and space.
 * @example isNonArrayRecord({ value: [] }); // false
 */
export function isNonArrayRecord(required: { value: unknown }, _optional: Record<string, never> = {}): required is { value: Record<string, unknown> } {
  return isRecord(required) && !Array.isArray(required.value);
}

