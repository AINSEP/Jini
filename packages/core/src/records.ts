/** @file Object-shape predicates and canonical JSON shared by tool readers and request digests. */
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

/** A shallow copy of `source` minus `keys`: what `const { a: _a, ...rest } = source` does,
 * without binding a throwaway name for every dropped key. */
export function omitKeys<T extends object, K extends keyof T>({ source, keys }: { source: T; keys: readonly K[] }, _optional: Record<string, never> = {}): Omit<T, K> {
  const copy: Partial<Record<PropertyKey, unknown>> = { ...source };
  for (const key of keys) delete copy[key];
  return copy as Omit<T, K>;
}

/** Parse a plugin contribution file and require `schemaVersion: 1`; callers validate their own list key. */
export function parseSchemaV1Document({ raw }: { raw: string }, _optional: Record<string, never> = {}): { ok: true; document: Readonly<Record<string, unknown>> } | { ok: false; reason: string } {
  let value: unknown;
  try { value = JSON.parse(raw); } catch { return { ok: false, reason: "not valid JSON" }; }
  const holder = { value };
  if (!isNonArrayRecord(holder) || holder.value.schemaVersion !== 1) return { ok: false, reason: "schemaVersion must be 1" };
  return { ok: true, document: holder.value };
}

/** Defined-only view of `T`: every key optional, and present only when its value is not `undefined`. */
export type DefinedFields<T> = { [K in keyof T]?: Exclude<T[K], undefined> };

/**
 * Copies the own enumerable string fields of `source` without their `undefined` values,
 * keeping key order — the
 * `...(x === undefined ? {} : { x })` spread pattern for many fields at once, so an absent
 * optional field is omitted from the result rather than carried as `undefined`.
 * Under `exactOptionalPropertyTypes`, omission is required when an optional field does not
 * accept `undefined`; it also keeps built option objects byte-identical to the
 * pre-injection shape when nothing is overridden.
 */
export function withoutUndefined<T extends object>({ source }: { source: T }, _optional: Record<string, never> = {}): DefinedFields<T> {
  return Object.fromEntries(Object.entries(source).filter(([, value]) => value !== undefined)) as DefinedFields<T>;
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

/** Invalid canonical JSON input. Messages never include argument contents. */
export class CanonicalJsonError extends TypeError {
  constructor(required: { readonly message: string }) {
    super(required.message);
    this.name = 'CanonicalJsonError';
  }
}

/** Compare Unicode code points, including astral characters; UTF-16 sort differs above U+FFFF.
 * @complexity O(l) time and space for the combined key length l.
 */
function compareJsonKeys(left: string, right: string): number {
  const a = Array.from(left);
  const b = Array.from(right);
  for (let index = 0; index < Math.min(a.length, b.length); index++) {
    const difference = a[index]!.codePointAt(0)! - b[index]!.codePointAt(0)!;
    if (difference !== 0) return difference;
  }
  return a.length - b.length;
}

/** Serialize JSON scalars without JSON.stringify's lossy non-JSON fallbacks.
 * @throws CanonicalJsonError for unsupported types or non-finite numbers.
 * @complexity O(s) time and space for s serialized characters.
 */
function canonicalScalar(value: unknown): string {
  switch (typeof value) {
    case 'string':
    case 'boolean':
      return JSON.stringify(value);
    case 'number':
      if (Number.isFinite(value)) return JSON.stringify(value);
      throw new CanonicalJsonError({ message: 'Canonical JSON requires finite numbers.' });
    default:
      throw new CanonicalJsonError({ message: 'Canonical JSON requires JSON values.' });
  }
}

/** Serialize own enumerable JSON fields; class instances must not silently collapse to {}.
 * @throws CanonicalJsonError for non-JSON objects or enumerable symbol keys.
 * @complexity O(k log k * l + s) time and O(s + k * l) space, plus recursive children.
 */
function canonicalObject(value: object, ancestors: Set<object>): string {
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new CanonicalJsonError({ message: 'Canonical JSON requires plain objects or arrays.' });
  }
  if (Object.getOwnPropertySymbols(value).some(key => Object.prototype.propertyIsEnumerable.call(value, key))) {
    throw new CanonicalJsonError({ message: 'Canonical JSON requires string object keys.' });
  }
  const record = value as Record<string, unknown>;
  // Object keys are unique, so comparing their code points gives a total order here.
  const members = Object.keys(record).sort(compareJsonKeys).flatMap(key => {
    const child = record[key];
    if (child === undefined) return [];
    return [`${JSON.stringify(key)}:${canonicalValue(child, ancestors)}`];
  });
  return `{${members.join(',')}}`;
}

/** Track only active ancestors: repeated references are JSON, back-edges are cycles.
 * @throws CanonicalJsonError for cycles or non-JSON children.
 * @complexity O(s + sum(k log k * l)) time; O(s * d) worst-case space for depth d.
 */
function canonicalValue(value: unknown, ancestors: Set<object>): string {
  if (value === null) return 'null';
  if (typeof value !== 'object') return canonicalScalar(value);
  if (ancestors.has(value)) throw new CanonicalJsonError({ message: 'Canonical JSON does not support cycles.' });
  ancestors.add(value);
  try {
    if (!Array.isArray(value)) return canonicalObject(value, ancestors);
    // Read every index: holes must fail, and a custom iterator must not change the argument order.
    const children: string[] = [];
    for (let index = 0; index < value.length; index++) children.push(canonicalValue(value[index], ancestors));
    return `[${children.join(',')}]`;
  } finally {
    ancestors.delete(value);
  }
}

/**
 * Canonical JSON: recursively sort object keys by Unicode code point, omit undefined object
 * properties, and preserve array order. Uses JSON scalar escaping without invoking toJSON hooks.
 * @param required.value JSON input; shared references are allowed. Does not mutate input.
 * @throws CanonicalJsonError for non-JSON values (including array holes) and cycles.
 * @complexity O(s + sum(k log k * l)) time for s output bytes, k keys per object and key length l;
 * O(s * d) worst-case space for nesting depth d, including intermediate strings and recursion.
 * @example canonicalJson({ value: { b: 1, a: 2 } }); // '{"a":2,"b":1}'
 */
export function canonicalJson(required: { readonly value: unknown }, _optional: Record<string, never> = {}): string {
  return canonicalValue(required.value, new Set());
}

/** The slice of WebCrypto the argument digest needs. */
export type DigestCryptoPort = { readonly subtle: Pick<typeof globalThis.crypto.subtle, 'digest'> };

/**
 * SHA-256 lowercase hex over canonical UTF-8 tool arguments, shared by plugins and host gates.
 * @param required.args JSON arguments; validation completes before hashing starts.
 * @param required.crypto Host WebCrypto port; the caller supplies it, core never reads a global.
 * @returns An asynchronous digest, usable in browsers and Node without Node imports.
 * @throws CanonicalJsonError for invalid arguments; WebCrypto failures propagate.
 * @complexity Canonical serialization cost plus O(s) hashing time and space for s UTF-8 bytes.
 */
export async function canonicalArgumentDigest(
  { args, crypto }: { readonly args: unknown; readonly crypto: DigestCryptoPort },
  _optional: Record<string, never> = {},
): Promise<string> {
  const json = canonicalJson({ value: args });
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(json));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}
