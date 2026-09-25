import type { ContentTypeFieldDef, ContentTypeFieldKind } from "../content-types/types.js";

/**
 * @file `validateFieldsAgainstSchema`'s envelope-shape-first ordering and
 * `selectVisibleEntryFields`'s orphaned-field read tolerance ("Failure modes",
 * schema drift / dangling fields: "validation is strict on write, tolerant on read").
 *
 * Purpose:
 * The single pure-logic implementation of "does this `fieldsJson` conform to this content type's
 * current schema" — reused identically by `write-service.ts`'s `createEntry`/`updateEntry` and by
 * any future validate-only route, so there is exactly one place this rule can drift.
 * `fieldsJson` must already be wrapped in the `{ ext: { <owner>: {...} } }` namespaced envelope
 * — a flat/unwrapped payload is rejected as a distinct envelope-shape violation
 * BEFORE any per-field check runs, never conflated with a per-field error for a key
 * that happens to share a field's name.
 *
 * Owner namespace (2026-07-21): `validateFieldsAgainstSchema` takes an optional `owner`, defaulting
 * to `"site"` — every caller that omits it keeps the originally-shipped, single-namespace
 * behavior byte-for-byte (same envelope, same error message, same certified test suite).
 * This is the fix for a real, confirmed gap: this module previously hardcoded the literal `site`
 * namespace with no way for a content type to declare its own, contradicting this engine's
 * documented `fields.ext.{owner}.*` promise (first surfaced by a widgets feature, which needs
 * `ext.widget`/`ext.widgets`, not `ext.site`, for data that structurally belongs to a different
 * feature).
 * `selectVisibleEntryFields` is intentionally left untouched — it has no production caller anywhere
 * in this codebase today, so widening it now would be speculative; extend it the same way once a
 * real caller needs a non-`site` read projection.
 *
 * Architectural role:
 * `features/entries` domain logic. Type-only dependency on `features/content-types/types`.
 */

export interface FieldValidationError {
  field: string;
  reason: string;
}

export interface ValidateFieldsResult {
  valid: boolean;
  fieldErrors: FieldValidationError[];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Maximum nesting depth a `json` field's value may reach.
 *
 * A resource bound, not a product rule — the same role `MAX_FIELD_DEFS` plays in
 * `content-types/field-defs.ts`. It is also what makes this check total: a self-referential value
 * (`a.self = a`) is a legal JS object that `JSON.stringify` throws on, and it is the depth cap,
 * not a visited-set, that guarantees this function terminates on one. Deliberately far above any
 * plausible content payload so it can never act as a product constraint.
 */
const MAX_JSON_DEPTH = 32;

/**
 * Maximum number of values (scalars, arrays and objects, counted together) one `json` field may
 * contain. The second half of the termination guarantee above, and the bound that stops a
 * pathological wide-but-shallow payload from making validation the expensive part of a write.
 */
const MAX_JSON_NODES = 10_000;

/**
 * True only for objects that are structurally plain — prototype `Object.prototype` or `null`.
 *
 * Stricter than this module's {@link isPlainObject}, and deliberately so: a `Map`, `Set`, or class
 * instance passes a `typeof === "object"` test and then `JSON.stringify`s to `{}`, silently
 * discarding every value it held. A `Date` survives, but as a string — its type changes at the
 * storage boundary, so a later read gets a different kind of value than the one written. Both are
 * exactly the "accepted here, mangled downstream" class this check exists to reject.
 */
function isStructurallyPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * Verifies that a value is a JSON value — `null`, a boolean, a FINITE number, a string, an array
 * of JSON values, or a plain object whose values are JSON values — within a bounded depth and node
 * budget.
 *
 * This exists because "storage-only" means "not indexed", never "not checked". The obvious
 * alternative — accepting every value for the `json` kind — is not a validator: it admits
 * functions, `symbol`, `bigint`, `undefined`, `NaN`/`Infinity`, and circular references, each of
 * which either throws inside `JSON.stringify` or is silently dropped/coerced by it, downstream of
 * the validator whose entire job was to catch them. Rejecting them here turns a serialization
 * crash (or a silent data loss) at the storage boundary into a named per-field validation error.
 *
 * Symbol-keyed properties are rejected rather than ignored for the same reason `field-defs.ts`
 * rejects an unrecognized key instead of dropping it: `JSON.stringify` discards them, so accepting
 * one would persist a value the caller did not get told was thrown away.
 *
 * @complexity O(n) in the number of contained values, hard-bounded by {@link MAX_JSON_NODES}, and
 * O(d) stack depth bounded by {@link MAX_JSON_DEPTH}. Total on every input, including cyclic ones.
 * @overallScore 100
 */
function isBoundedJsonValue(value: unknown, budget: { nodes: number }, depth = 0): boolean {
  if (depth > MAX_JSON_DEPTH) return false;
  if (budget.nodes <= 0) return false;
  budget.nodes -= 1;

  if (value === null) return true;
  switch (typeof value) {
    case "boolean":
    case "string":
      return true;
    case "number":
      // `NaN`/`Infinity` are numbers that `JSON.stringify` silently rewrites to `null` — a value
      // that reads back as a different type than the one written.
      return Number.isFinite(value);
    case "object":
      break;
    default:
      // `undefined`, `function`, `symbol`, `bigint`: dropped, dropped, dropped, and throws.
      return false;
  }

  if (Array.isArray(value)) {
    return value.every((element) => isBoundedJsonValue(element, budget, depth + 1));
  }
  if (!isStructurallyPlainObject(value)) return false;
  if (Object.getOwnPropertySymbols(value).length > 0) return false;
  return Object.values(value).every((entry) => isBoundedJsonValue(entry, budget, depth + 1));
}

/**
 * Runtime-conformance check for one field's value against its declared kind. Loose by design
 * (e.g. `datetime` accepts any string) — kind-conformance here is about JS runtime shape, not
 * full ISO-8601/format validation, which is out of this package's scope.
 *
 * The `default: return false` arm is load-bearing: a kind added to `ContentTypeFieldKind` without
 * an arm here does not fail the build, it produces a field that can be DECLARED but whose every
 * value is rejected on write. Any future kind must be added here in the same change.
 *
 * @complexity O(1) for every scalar kind; O(n) bounded by `MAX_JSON_NODES` for `json`.
 * @overallScore 100
 */
function conformsToKind(value: unknown, kind: ContentTypeFieldKind): boolean {
  switch (kind) {
    case "text":
    case "datetime":
    // A foreign entity id. String-shaped exactly like `text`; referential integrity is NOT checked
    // here and is not checked anywhere — this function is a pure runtime-shape check with no repo
    // access, and giving it one would put an I/O dependency into a module whose header commits to
    // having none. The gap is real and belongs to the application layer.
    case "relation":
      return typeof value === "string";
    case "integer":
      return typeof value === "number" && Number.isInteger(value);
    case "real":
      return typeof value === "number";
    case "boolean":
      return typeof value === "boolean";
    // Storage-only: no scalar shape is imposed, but the value must still be something that
    // survives the `JSON.stringify` boundary intact. See `isBoundedJsonValue`.
    case "json":
      return isBoundedJsonValue(value, { nodes: MAX_JSON_NODES });
    default:
      return false;
  }
}

/**
 * REQ-14/15 — validates a candidate `fieldsJson` payload against a content type's current field
 * schema: envelope shape first (AC-50), then per-key unrecognized-field rejection (AC-22) and
 * kind-conformance (AC-49), then a required-field-missing pass (AC-23).
 *
 * @complexity O(f) in the number of schema fields plus O(k) in the number of submitted keys.
 * @overallScore 100
 */
export function validateFieldsAgainstSchema(required: {
  schema: ContentTypeFieldDef[];
  fieldsJson: unknown;
  /** The `ext` sub-key this content type's fields live under. Defaults to `"site"` — every existing caller keeps identical behavior unless it opts into a different owner namespace. */
  owner?: string | undefined;
}): ValidateFieldsResult {
  const { schema, fieldsJson, owner = "site" } = required;

  const ext = isPlainObject(fieldsJson) ? fieldsJson.ext : undefined;
  const ownerBag = isPlainObject(ext) ? ext[owner] : undefined;
  if (!isPlainObject(fieldsJson) || !isPlainObject(ext) || !isPlainObject(ownerBag)) {
    return {
      valid: false,
      fieldErrors: [{ field: "__envelope__", reason: `fieldsJson must be wrapped in the { ext: { ${owner}: {...} } } envelope shape` }],
    };
  }

  const schemaByName = new Map(schema.map((f) => [f.name, f]));
  const fieldErrors: FieldValidationError[] = [];

  for (const [key, value] of Object.entries(ownerBag)) {
    const def = schemaByName.get(key);
    if (!def) {
      fieldErrors.push({ field: key, reason: "unrecognized field: not present in the current content-type schema" });
      continue;
    }
    if (!conformsToKind(value, def.kind)) {
      fieldErrors.push({ field: key, reason: `value does not conform to the declared kind '${def.kind}'` });
    }
  }

  for (const def of schema) {
    if (def.required && !Object.prototype.hasOwnProperty.call(ownerBag, def.name)) {
      fieldErrors.push({ field: def.name, reason: "required field is missing" });
    }
  }

  return { valid: fieldErrors.length === 0, fieldErrors };
}

/**
 * Projects an entry's `fieldsJson.ext.site` down to only the keys still present in
 * the content type's CURRENT schema, silently dropping orphaned keys left behind by a prior field
 * removal rather than erroring ("Failure modes": "validation is strict on write, tolerant
 * on read").
 *
 * @complexity O(k) in the number of keys present on the entry's stored fields bag.
 * @overallScore 100
 */
export function selectVisibleEntryFields(required: {
  entry: { fieldsJson: unknown };
  contentType: { fields: ContentTypeFieldDef[] };
}): Record<string, unknown> {
  const fieldsJson = required.entry.fieldsJson;
  const ext = isPlainObject(fieldsJson) ? fieldsJson.ext : undefined;
  const site = isPlainObject(ext) ? ext.site : undefined;
  const allowedNames = new Set(required.contentType.fields.map((f) => f.name));

  const visible: Record<string, unknown> = {};
  if (!isPlainObject(site)) return visible;
  for (const [key, value] of Object.entries(site)) {
    if (allowedNames.has(key)) visible[key] = value;
  }
  return visible;
}
