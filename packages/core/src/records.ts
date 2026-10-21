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

/** Strict equality over the supplied own, enumerable string fields; omitted fields are unconstrained.
 * Memory adapters keep their scope and identity fields in this selector, including on deletes.
 * @complexity O(k) time and space for k selector fields.
 */
export function matchesRecordFields<Row extends object>({ record, fields }: { record: Row; fields: Partial<Row> }, _optional: Record<string, never> = {}): boolean {
  return (Object.keys(fields) as Array<keyof Row>).every(key => record[key] === fields[key]);
}

/** Replace the first matching record in place, or append; preserves order and reference semantics.
 * @complexity O(nk) time and O(k) space for n records and k identity fields.
 */
export function upsertRecord<Row extends object>({ records, record, identity }: { records: Row[]; record: Row; identity: Partial<Row> }, _optional: Record<string, never> = {}): void {
  const index = records.findIndex(candidate => matchesRecordFields({ record: candidate, fields: identity }));
  if (index === -1) records.push(record);
  else records[index] = record;
}

/** Remove a keyed record only when its additional scope fields match.
 * @complexity O(k) time and space for k selector fields, plus the map lookup.
 */
export function deleteMapRecord<Key, Row extends object>({ records, key, fields }: { records: Map<Key, Row>; key: Key; fields: Partial<Row> }, _optional: Record<string, never> = {}): void {
  const record = records.get(key);
  if (record && matchesRecordFields({ record, fields })) records.delete(key);
}
