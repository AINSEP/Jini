import type { ContentTypeFieldDef, ContentTypeFieldKind } from "../content-types/types.js";

/**
 * @file REQ-14/15/25 (SPEC-020) — `validateFieldsAgainstSchema`'s envelope-shape-first ordering
 * (C-411) and `selectVisibleEntryFields`'s orphaned-field read tolerance (ADR-022 "Failure modes",
 * schema drift / dangling fields: "validation is strict on write, tolerant on read").
 *
 * Purpose:
 * The single pure-logic implementation of "does this `fieldsJson` conform to this content type's
 * current schema" — reused identically by `write-service.ts`'s `createEntry`/`updateEntry` and by
 * any future validate-only route (AC-39/AC-40), so there is exactly one place this rule can drift.
 * `fieldsJson` must already be wrapped in the `{ ext: { <owner>: {...} } }` namespaced envelope
 * (ADR-022 §2) — a flat/unwrapped payload is rejected as a distinct envelope-shape violation
 * BEFORE any per-field check runs (AC-50/EC-15), never conflated with a per-field error for a key
 * that happens to share a field's name.
 *
 * Owner namespace (2026-07-21): `validateFieldsAgainstSchema` takes an optional `owner`, defaulting
 * to `"site"` — every caller that omits it keeps ADR-022 §2's originally-shipped, single-namespace
 * behavior byte-for-byte (same envelope, same error message, same certified SPEC-020 test suite).
 * This is the fix for a real, confirmed gap: this module previously hardcoded the literal `site`
 * namespace with no way for a content type to declare its own, contradicting ADR-022 §2's documented
 * `fields.ext.{owner}.*` promise (first surfaced by SPEC-043/widgets, which needs `ext.widget`/
 * `ext.widgets`, not `ext.site`, for data that structurally belongs to a different feature).
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
 * Runtime-conformance check for one field's value against its declared kind. Loose by design
 * (e.g. `datetime` accepts any string) — kind-conformance here is about JS runtime shape, not
 * full ISO-8601/format validation, which is out of this package's scope.
 *
 * @complexity O(1).
 * @overallScore 100
 */
function conformsToKind(value: unknown, kind: ContentTypeFieldKind): boolean {
  switch (kind) {
    case "text":
    case "datetime":
      return typeof value === "string";
    case "integer":
      return typeof value === "number" && Number.isInteger(value);
    case "real":
      return typeof value === "number";
    case "boolean":
      return typeof value === "boolean";
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
  /** The `ext` sub-key this content type's fields live under (ADR-022 §2). Defaults to `"site"` — every existing caller keeps identical behavior unless it opts into a different owner namespace. */
  owner?: string | undefined;
}): ValidateFieldsResult {
  const { schema, fieldsJson, owner = "site" } = required;

  const ext = isPlainObject(fieldsJson) ? fieldsJson.ext : undefined;
  const ownerBag = isPlainObject(ext) ? ext[owner] : undefined;
  if (!isPlainObject(fieldsJson) || !isPlainObject(ext) || !isPlainObject(ownerBag)) {
    return {
      valid: false,
      fieldErrors: [{ field: "__envelope__", reason: `fieldsJson must be wrapped in the { ext: { ${owner}: {...} } } envelope shape (ADR-022 §2)` }],
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
 * AC-24/EC-08 — projects an entry's `fieldsJson.ext.site` down to only the keys still present in
 * the content type's CURRENT schema, silently dropping orphaned keys left behind by a prior field
 * removal rather than erroring (ADR-022 "Failure modes": "validation is strict on write, tolerant
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
