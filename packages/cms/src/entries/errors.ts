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
  constructor({ message }: { message: string }, _optional: Record<string, never> = {}) {
    super(message);
    this.name = "ForbiddenError";
  }
}

export class EntryNotFoundError extends Error {
  constructor(requiredArgs: { message: string }, optionalArgs: Record<string, never> = {}) {
    const { message } = requiredArgs;
    super(message);
    this.name = "ENTRY_NOT_FOUND";
  }
}

/** — the owning content type does not exist, or exists only in a different workspace. See docs/decisions/DR-002-content-lifecycle-and-cleanup.md. */
export class ContentTypeNotFoundError extends Error {
  constructor(requiredArgs: { message: string }, optionalArgs: Record<string, never> = {}) {
    const { message } = requiredArgs;
    super(message);
    this.name = "CONTENT_TYPE_NOT_FOUND";
  }
}

/** (create) / (update/publish/unpublish) — the owning content type's status forbids this write. See docs/decisions/DR-002-content-lifecycle-and-cleanup.md. */
export class ContentTypeNotActiveError extends Error {
  constructor(requiredArgs: { message: string }, optionalArgs: Record<string, never> = {}) {
    const { message } = requiredArgs;
    super(message);
    this.name = "ContentTypeNotActiveError";
  }
}

/** — a second entry submitted with an identical `(workspaceId, type, slug)`. See docs/decisions/DR-002-content-lifecycle-and-cleanup.md. */
export class EntrySlugConflictError extends Error {
  constructor(requiredArgs: { message: string }, optionalArgs: Record<string, never> = {}) {
    const { message } = requiredArgs;
    super(message);
    this.name = "ENTRY_SLUG_CONFLICT";
  }
}

export class VersionConflictError extends Error {
  constructor(requiredArgs: { message: string }, optionalArgs: Record<string, never> = {}) {
    const { message } = requiredArgs;
    super(message);
    this.name = "VersionConflictError";
  }
}

/** — `fieldsJson` failed `validateFieldsAgainstSchema` against the owning type's current schema. See docs/decisions/DR-002-content-lifecycle-and-cleanup.md. */
export class EntryFieldValidationError extends Error {
  readonly fieldErrors: Array<{ field: string; reason: string }>;

  constructor(requiredArgs: { fieldErrors: Array<{ field: string; reason: string }> }, optionalArgs: Record<string, never> = {}) {
    const { fieldErrors } = requiredArgs;
    super(`fieldsJson failed schema validation: ${fieldErrors.map((e) => `${e.field}: ${e.reason}`).join("; ")}`);
    this.name = "EntryFieldValidationError";
    this.fieldErrors = fieldErrors;
  }
}
