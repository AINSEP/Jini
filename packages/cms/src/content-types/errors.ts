import { ToolInputError } from "@jini-ai/core";

/**
 * @file Typed error surface for the `content-types` package.
 *
 * Purpose:
 * Every rejection this package's write-service/lifecycle/cleanup/index-provisioning modules
 * produce is one of these classes, never a bare `Error`/string, so callers (routes, agent tools,
 * tests) can branch on `instanceof` or on `.name` without parsing a message.
 *
 * `class X extends Error {}` does NOT give an instance a `.name` of `"X"` on this runtime unless
 * the constructor sets `this.name` explicitly (confirmed empirically in Session 2 of this
 * workstream) — every class below sets it.
 *
 * Every class the five wired agent tools (`define`/`update_fields`/`deprecate`/`reactivate`/
 * `tombstone`) can actually throw extends `ToolInputError` (`@jini-ai/core`), not plain `Error` —
 * mirroring `core/entity-liveness.ts`'s `EntityNotLiveError` (see its file header for the full
 * rationale). Without that, `write-service.ts`/`lifecycle.ts` return these via a `Result` that
 * `tool-registrations.ts`'s `fromResult` re-throws unwrapped, `@jini-ai/daemon`'s `ToolExecutor`
 * sees a plain `Error` it cannot distinguish from a genuine internal fault, and every HTTP-facing
 * mapping of that failure (`@jini-ai/http-kit`'s `delegated-tools.ts`) redacts it to a 500
 * `INTERNAL_ERROR` — so a model calling `collections_content_type_define` on a key that already
 * exists never sees "use collections_content_type_update_fields", only an opaque failure it cannot
 * act on. `CleanupNotEligibleError` is the one exception: `collections_plan_cleanup`/
 * `collections_execute_cleanup` are declared but not yet wired to any handler
 * (`tool-registrations.ts`'s `UNWIRED_CONTENT_TYPES_TOOL_IDS`), so nothing reaches a model through
 * it today — left as plain `Error` until that wiring exists and it can be verified the same way.
 *
 * Architectural role:
 * `features/content-types` domain logic. Depends on `@jini-ai/core` only for the `ToolInputError`
 * marker above.
 */

export class ForbiddenError extends ToolInputError {
  constructor(message: string) {
    super(message);
    this.name = "ForbiddenError";
  }
}

/** CIC U-002-B1 guard 1 — `key`/field-name grammar gate `^[a-z][a-z0-9_]{0,63}$` (U-001-B2). */
export class InvalidKeyGrammarError extends ToolInputError {
  constructor(message: string) {
    super(message);
    this.name = "InvalidKeyGrammarError";
  }
}

/** CIC U-002-B1 guard 2 — `key` is one of the permanently reserved legacy `posts` keys. */
export class ReservedContentTypeKeyError extends ToolInputError {
  constructor(message: string) {
    super(message);
    this.name = "ReservedContentTypeKeyError";
  }
}

/** CIC U-002-B1 guard 3 — a field name fails the identifier grammar gate. */
export class InvalidFieldNameGrammarError extends ToolInputError {
  constructor(message: string) {
    super(message);
    this.name = "InvalidFieldNameGrammarError";
  }
}

/** CIC U-001-B1 / U-002-B1 guard 4 — a field `kind` is not one of the closed field-kind enum. */
export class InvalidFieldKindError extends ToolInputError {
  constructor(message: string) {
    super(message);
    this.name = "InvalidFieldKindError";
  }
}

/**
 * CIC U-002-B1 guard 4b — a field declares a STORAGE-ONLY `kind` (`json`) together with
 * `queryable: true`. The kind itself is legal and the field may be declared and written; what is
 * rejected is the pairing, because a storage-only kind has no `CAST` target and therefore no index
 * to provision.
 *
 * DELIBERATELY A SUBCLASS of {@link InvalidFieldKindError}, not a sibling. The fronting HTTP
 * boundaries map rejections with a fixed `instanceof` list and fall through to
 * `500 INTERNAL_ERROR`; they live in consuming applications, outside this package, and cannot be
 * updated in lockstep with it. A sibling class would therefore turn a validation rejection into a
 * 500 at every existing boundary the day this shipped. Subclassing keeps every such boundary at
 * `400 VALIDATION_ERROR` with no coordinated change, and the relationship is honest — this IS a
 * rejection of the field's kind, in the context the kind was used. `.name` still distinguishes it
 * for any caller that wants the finer signal.
 */
export class StorageOnlyFieldNotQueryableError extends InvalidFieldKindError {
  constructor(message: string) {
    super(message);
    this.name = "StorageOnlyFieldNotQueryableError";
  }
}

/**
 * A `fields` payload whose STRUCTURE is wrong — not a value that failed a domain rule, but a
 * shape the `ContentTypeFieldDef[]` contract does not describe at all (a non-array, a non-object
 * element, a missing/mistyped `name`/`required`/`queryable`, or an unrecognized key).
 *
 * Distinct from the five CIC U-002-B1 guard errors on purpose: those judge a well-formed field
 * definition against a domain rule, and they remain the sole owners of the grammar, kind-enum and
 * queryable-cap decisions. This one fires strictly earlier, at the untrusted-input boundary
 * (`field-defs.ts`), for payloads the guards could not have judged without either crashing or
 * silently persisting a value of the wrong type.
 *
 * `violation.received` names the offending value's TYPE, never the value — a field payload can
 * carry operator content, and this message reaches both an HTTP client and a model.
 */
export class InvalidFieldShapeError extends ToolInputError {
  readonly code = "VALIDATION_ERROR" as const;
  readonly violation: { path: string; expected: string; received: string };

  constructor(violation: { path: string; expected: string; received: string }) {
    super(`${violation.path} must be ${violation.expected}, received ${violation.received}`);
    this.name = "InvalidFieldShapeError";
    this.violation = violation;
  }
}

/** CIC U-002-B1 guard 5 — more than the per-type cap of `queryable` fields were submitted. */
export class QueryableFieldCapExceededError extends ToolInputError {
  constructor(message: string) {
    super(message);
    this.name = "QueryableFieldCapExceededError";
  }
}

/** CIC U-004-B1 — `expectedVersion` did not match the current row's version (OCC conflict). */
export class VersionConflictError extends ToolInputError {
  constructor(message: string) {
    super(message);
    this.name = "VersionConflictError";
  }
}

export class ContentTypeNotFoundError extends ToolInputError {
  constructor(message: string) {
    super(message);
    this.name = "CONTENT_TYPE_NOT_FOUND";
  }
}

/**
 * Row 7 (web-high fix plan, 2026-09-24) — `registerContentType` loaded no existing row before
 * saving, so two concurrent first-widget creates (or a caller retrying an existing key) could
 * silently overwrite the current fields, and registering a tombstoned key could resurrect it
 * (INV-06 forbids any transition out of tombstone, including via a fresh register). Thrown when
 * `deps.repo.findByKey` already returns a row for the key, whether that row is active/deprecated
 * or tombstoned — `tombstoned` distinguishes the two so a caller/HTTP route can give the right
 * guidance (retry with update-fields, vs. the key is permanently gone).
 */
export class ContentTypeAlreadyExistsError extends ToolInputError {
  readonly tombstoned: boolean;

  constructor(key: string, tombstoned: boolean) {
    super(
      tombstoned
        ? `content type '${key}' was permanently deleted; its key can't be reused (INV-06)`
        : `content type '${key}' already exists; use collections_content_type_update_fields to change its fields`
    );
    this.name = "ContentTypeAlreadyExistsError";
    this.tombstoned = tombstoned;
  }
}

/** A generic validation rejection carrying a stable machine-readable `details.reason`. */
export class ValidationError extends ToolInputError {
  readonly code = "VALIDATION_ERROR" as const;
  readonly details: { reason: string };

  constructor(message: string, reason: string) {
    super(message);
    this.name = "VALIDATION_ERROR";
    this.details = { reason };
  }
}

/** REQ-09..12 lifecycle state-machine guard rejection (INV-06 terminal-tombstone, EC-09 deprecate-first). */
export class ContentTypeLifecycleError extends ToolInputError {
  constructor(message: string) {
    super(message);
    this.name = "ContentTypeLifecycleError";
  }
}

/** REQ-20 `planCleanup` eligibility-gate rejection; `reason` is one of a closed, ordered set. */
export class CleanupNotEligibleError extends Error {
  readonly reason: string;

  constructor(reason: string, message?: string) {
    super(message ?? `cleanup is not eligible: ${reason}`);
    this.name = "CleanupNotEligibleError";
    this.reason = reason;
  }
}
