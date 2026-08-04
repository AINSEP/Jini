/**
 * @file Typed error surface for the `entries` package.
 *
 * `class X extends Error {}` does NOT give an instance a `.name` of `"X"` on this runtime unless
 * the constructor sets `this.name` explicitly — every class below sets it, matching the
 * `content-types` package's own convention.
 *
 * Architectural role:
 * `features/entries` domain logic. No dependencies.
 */

export class ForbiddenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ForbiddenError";
  }
}

export class EntryNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ENTRY_NOT_FOUND";
  }
}

/** REQ-29/AC-29 — the owning content type does not exist, or (INV-01) exists only in a different workspace. */
export class ContentTypeNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CONTENT_TYPE_NOT_FOUND";
  }
}

/** REQ-10 (create) / REQ-28 (update/publish/unpublish) — the owning content type's status forbids this write. */
export class ContentTypeNotActiveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ContentTypeNotActiveError";
  }
}

/** AC-21 — a second entry submitted with an identical `(workspaceId, type, slug)`. */
export class EntrySlugConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ENTRY_SLUG_CONFLICT";
  }
}

export class VersionConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VersionConflictError";
  }
}

/** REQ-14/15 — `fieldsJson` failed `validateFieldsAgainstSchema` against the owning type's current schema. */
export class EntryFieldValidationError extends Error {
  readonly fieldErrors: Array<{ field: string; reason: string }>;

  constructor(fieldErrors: Array<{ field: string; reason: string }>) {
    super(`fieldsJson failed schema validation: ${fieldErrors.map((e) => `${e.field}: ${e.reason}`).join("; ")}`);
    this.name = "EntryFieldValidationError";
    this.fieldErrors = fieldErrors;
  }
}
