/**
 * @file The single untrusted-input boundary for a content type's `fields` payload — used by BOTH
 * callers that accept one from outside the process: the admin HTTP routes
 * (`server/routes/admin/content-types/{register,update-fields}.ts`) and the agent-tool handlers
 * (`assistant/tool-registrations.ts`).
 *
 * Purpose:
 * Before this module both call sites did the same two things: check `Array.isArray(body.fields)`
 * and then cast the result to `ContentTypeFieldDef[]`. The cast was the whole of the nested-shape
 * validation, which left three real gaps:
 *
 * 1. `required` and `queryable` were never type-checked anywhere in the codebase, so
 *    `queryable: "yes"` counted as queryable (`write-service.ts`'s `countQueryableFields` filters
 *    on truthiness) and `required: "maybe"` was persisted verbatim into the stored record and its
 *    revision `stateJson`. That is a data-integrity gap, not merely a sloppy contract.
 * 2. A non-object element (`fields: [null]`) made the field-name grammar guard throw a bare
 *    `TypeError` on `field.name` instead of returning a typed rejection — a 500 on the HTTP path
 *    and an opaque `'failed'` tool execution on the agent path.
 * 3. A misspelled key (`queryible: true`) was silently dropped rather than reported, so a caller
 *    got a field that was quietly non-queryable with no indication why.
 *
 * Division of responsibility (deliberate, and the reason this module is narrow):
 * this module owns STRUCTURE only — array-ness, element object-ness, the four keys and their
 * types. It does NOT own the domain rules. The field-name grammar gate, the reserved-key check and
 * the queryable-field cap stay solely in `write-service.ts`'s CIC U-002-B1 guard chain, whose
 * fixed order (`key grammar -> reserved-key -> field-name grammar -> field-kind -> queryable-cap`)
 * and stop-at-first-failure behavior are pinned by
 * `__tests__/unit/write-service.register.unit.test.ts` (AC-38). Duplicating any of those here
 * would either reorder that chain for boundary callers or create a second source of truth for a
 * rule GOV-ADR-003 requires to have exactly one.
 *
 * The one exception is `kind`, and it is a reuse rather than a restatement: this module calls the
 * same `isContentTypeFieldKind` predicate guard 4 calls and raises the same
 * `InvalidFieldKindError` guard 4 raises. Verifying it here is what lets this function honestly
 * return `ContentTypeFieldDef[]` instead of handing back another unchecked cast. Both call sites
 * already map that error class to `400 VALIDATION_ERROR`, so no HTTP response shape changes.
 *
 * Architectural role:
 * `features/content-types` domain logic. Pure — no I/O, no clock, no repo. Depends only on this
 * package's own `types.ts` and `errors.ts`.
 */
import { InvalidFieldKindError, InvalidFieldShapeError } from "./errors.js";
import { isContentTypeFieldKind, type ContentTypeFieldDef, type Result } from "./types.js";

/**
 * The complete, closed key set of a `ContentTypeFieldDef`. Any other key is rejected rather than
 * ignored — silently dropping an unrecognized key is how a typo'd `queryible: true` became a
 * quietly non-queryable field with no error to act on.
 */
const FIELD_DEF_KEYS = ["name", "kind", "required", "queryable"] as const;

/**
 * Upper bound on how many field definitions one payload may carry.
 *
 * Not a product rule — a resource bound. `fields` is a caller-supplied, previously unbounded
 * collection: the existing `QUERYABLE_FIELD_CAP` (20, `write-service.ts`) limits only the
 * `queryable` subset, so a payload of a million non-queryable fields was accepted and persisted
 * as one JSON blob. Deliberately far above any plausible real content type so it can never act as
 * a product constraint; if a legitimate schema ever approaches it, raise it rather than working
 * around it.
 */
const MAX_FIELD_DEFS = 500;

/**
 * Names the offending value's TYPE for an error message that must never echo operator content.
 * Article chosen by initial vowel because two `typeof` results ("object", "undefined") take "an".
 */
function describeType(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "an array";
  const type = typeof value;
  return `${/^[aeiou]/.test(type) ? "an" : "a"} ${type}`;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Validates an untrusted value against the `ContentTypeFieldDef[]` contract, returning either the
 * verified array or the first structural violation found.
 *
 * Stops at the first violation rather than collecting all of them, matching the
 * stop-at-first-failure convention CIC U-002-B1 already establishes for the domain guard chain
 * this function feeds.
 *
 * @param value - The untrusted `fields` payload: a parsed JSON body's property, or an agent tool's
 * `ctx.input.fields`. Any type is accepted as input; that is the point.
 * @returns `{ok:true, value}` with an array whose every element is a verified
 * {@link ContentTypeFieldDef}, or `{ok:false, error}` carrying an
 * {@link InvalidFieldShapeError} (wrong structure, with the offending path) or an
 * {@link InvalidFieldKindError} (well-formed string `kind` outside the closed enum).
 * @throws Never. Every rejection is returned, including for inputs that previously threw.
 * @complexity O(f·k) time with f = element count (bounded by {@link MAX_FIELD_DEFS}) and k = 4
 * fixed keys, so effectively O(f); O(f) space for the returned array.
 * @example
 * const parsed = parseContentTypeFieldDefs([{ name: "servings", kind: "integer", required: false, queryable: true }]);
 * if (!parsed.ok) return { ok: false, error: parsed.error };
 * @overallScore 100
 */
export function parseContentTypeFieldDefs(value: unknown): Result<ContentTypeFieldDef[], Error> {
  if (!Array.isArray(value)) {
    return { ok: false, error: new InvalidFieldShapeError({ path: "fields", expected: "an array", received: describeType(value) }) };
  }
  if (value.length > MAX_FIELD_DEFS) {
    return {
      ok: false,
      error: new InvalidFieldShapeError({ path: "fields", expected: `at most ${MAX_FIELD_DEFS} entries`, received: `an array of ${value.length}` }),
    };
  }

  const parsed: ContentTypeFieldDef[] = [];
  for (const [index, element] of value.entries()) {
    const one = parseOneFieldDef(element, `fields[${index}]`);
    if (!one.ok) return one;
    parsed.push(one.value);
  }

  return { ok: true, value: parsed };
}

/**
 * Validates one element of the `fields` array. Split out of {@link parseContentTypeFieldDefs} so
 * the guard sequence sits flat at one nesting level instead of inside the array loop — the checks,
 * their order, and the exact error each returns are unchanged, and the first failure still
 * short-circuits the whole parse.
 *
 * @complexity O(k) with k = 4 fixed keys.
 */
function parseOneFieldDef(element: unknown, at: string): Result<ContentTypeFieldDef, Error> {
  if (!isPlainObject(element)) {
    return { ok: false, error: new InvalidFieldShapeError({ path: at, expected: "an object", received: describeType(element) }) };
  }

  const unrecognized = Object.keys(element).find((key) => !(FIELD_DEF_KEYS as readonly string[]).includes(key));
  if (unrecognized !== undefined) {
    return {
      ok: false,
      error: new InvalidFieldShapeError({ path: `${at}.${unrecognized}`, expected: `absent (allowed keys: ${FIELD_DEF_KEYS.join(", ")})`, received: "an unrecognized key" }),
    };
  }

  // `name` is checked for string-ness only — its grammar belongs to guard 3. Checking it here is
  // what stops that guard from receiving a non-string and throwing inside `RegExp.test`.
  if (typeof element.name !== "string") {
    return { ok: false, error: new InvalidFieldShapeError({ path: `${at}.name`, expected: "a string", received: describeType(element.name) }) };
  }
  if (typeof element.required !== "boolean") {
    return { ok: false, error: new InvalidFieldShapeError({ path: `${at}.required`, expected: "a boolean", received: describeType(element.required) }) };
  }
  if (typeof element.queryable !== "boolean") {
    return { ok: false, error: new InvalidFieldShapeError({ path: `${at}.queryable`, expected: "a boolean", received: describeType(element.queryable) }) };
  }
  if (typeof element.kind !== "string") {
    return { ok: false, error: new InvalidFieldShapeError({ path: `${at}.kind`, expected: "a string", received: describeType(element.kind) }) };
  }
  if (!isContentTypeFieldKind(element.kind)) {
    return { ok: false, error: new InvalidFieldKindError(`field '${element.name}' has kind '${element.kind}', not one of the closed field-kind enum`) };
  }

  return { ok: true, value: { name: element.name, kind: element.kind, required: element.required, queryable: element.queryable } };
}
