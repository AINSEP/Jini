/**
 * @file Typed domain errors for `widgets` (SPEC-043).
 *
 * Purpose:
 * One class per error this module originates; route handlers map these 1:1 to HTTP codes.
 * Mirrors the `forms/errors.ts` / `PostConflictError`-style convention already used throughout
 * this codebase.
 *
 * `this.name` fix (found during implementation, additive-only — no constructor signature
 * changed): `class X extends Error {}` does NOT give an instance a `.name` of `"X"` on this
 * runtime unless the constructor sets `this.name` explicitly (confirmed by
 * `features/entries/errors.ts`'s own header, which documents and applies this exact fix already).
 * Without it, `Error.prototype.toString()` — what `assert.rejects(fn, /ClassName/)` matches
 * against — reads `"Error: <message>"` for every class here, so a certified test asserting
 * `/WidgetConfigValidationError/` etc. could never pass regardless of which error actually threw.
 */

/** `WIDGETS_TYPE_UNREGISTERED` (400) — `widgetType` is not present in the registry (REQ-03). */
export class WidgetTypeUnregisteredError extends Error {
  readonly widgetType: string;
  constructor({ message, widgetType }: { message: string; widgetType: string }, _optional: Record<string, never> = {}
  ) {
    super(message);
    this.widgetType = widgetType;
    this.name = "WidgetTypeUnregisteredError";
  }
}

/** `WIDGETS_CONFIG_VALIDATION_ERROR` (400) — config fails the type's registered schema (REQ-02). */
export class WidgetConfigValidationError extends Error {
  readonly fieldErrors: Array<{ field: string; reason: string }>;
  constructor({ message, fieldErrors = [] }: { message: string; fieldErrors?: Array<{ field: string; reason: string }> }, _optional: Record<string, never> = {}
  ) {
    super(message);
    this.fieldErrors = fieldErrors;
    this.name = "WidgetConfigValidationError";
  }
}

/** `WIDGETS_VERSION_CONFLICT` (409) — optimistic-concurrency mismatch (REQ-06). */
export class WidgetVersionConflictError extends Error {
  readonly currentVersion: number;
  constructor({ message, currentVersion }: { message: string; currentVersion: number }, _optional: Record<string, never> = {}
  ) {
    super(message);
    this.currentVersion = currentVersion;
    this.name = "WidgetVersionConflictError";
  }
}

/** `WIDGETS_AREA_CONFLICT` (409) — a `widget_area` mutation lost an OCC race (REQ-15). */
export class WidgetAreaConflictError extends Error {
  readonly currentVersion: number;
  constructor({ message, currentVersion }: { message: string; currentVersion: number }, _optional: Record<string, never> = {}
  ) {
    super(message);
    this.currentVersion = currentVersion;
    this.name = "WidgetAreaConflictError";
  }
}

/**
 * `WIDGETS_REFERENCED` (409) — delete attempted without `.force` while the
 * instance is still referenced by at least one placement (REQ-42).
 */
export class WidgetReferencedError extends Error {
  readonly referencingLocations: Array<{ kind: "region" | "embed"; entryId: string }>;
  constructor({ message, referencingLocations = [] }: { message: string; referencingLocations?: Array<{ kind: "region" | "embed"; entryId: string }> }, _optional: Record<string, never> = {}
  ) {
    super(message);
    this.referencingLocations = referencingLocations;
    this.name = "WidgetReferencedError";
  }
}

/**
 * `WIDGETS_EMBED_GUARDRAIL_VIOLATION` (400) — a `widgetEmbed` mutation would
 * create recursion or exceed the per-document embed count (REQ-19/20), raised
 * identically regardless of whether the mutation originated from the live
 * editor or the server-side/AI command path (INV-04).
 */
export class WidgetEmbedGuardrailError extends Error {
  readonly reason: "recursion" | "count-exceeded";
  constructor({ message, reason }: { message: string; reason: "recursion" | "count-exceeded" }, _optional: Record<string, never> = {}
  ) {
    super(message);
    this.reason = reason;
    this.name = "WidgetEmbedGuardrailError";
  }
}

/** `WIDGETS_INSTANCE_NOT_FOUND` (404). */
export class WidgetInstanceNotFoundError extends Error {
  constructor({ message }: { message: string }, _optional: Record<string, never> = {}) {
    super(message);
    this.name = "WidgetInstanceNotFoundError";
  }
}

/** `WIDGETS_AREA_NOT_FOUND` (404). */
export class WidgetAreaNotFoundError extends Error {
  constructor({ message }: { message: string }, _optional: Record<string, never> = {}) {
    super(message);
    this.name = "WidgetAreaNotFoundError";
  }
}

/**
 * `WIDGETS_FORBIDDEN` (403) — a principal lacking the required flat `widgets.*` permission
 * attempted a widget mutation or read (REQ-40/41, INV-07). Added during implementation: the
 * original stub-era contract had no distinct forbidden-error class for this library (every other
 * `write-service.ts`-shaped chokepoint in this codebase — `features/entries`, `features/
 * content-types` — has its own `ForbiddenError`), so `write-service.ts`/`region-area-service.ts`
 * had no typed way to signal an `authorize()` rejection distinctly from every other failure mode.
 */
export class WidgetForbiddenError extends Error {
  constructor({ message }: { message: string }, _optional: Record<string, never> = {}) {
    super(message);
    this.name = "WidgetForbiddenError";
  }
}

/** `WIDGETS_EMBED_HOST_NOT_FOUND` (404) — no post, page, or content entry with that id in this workspace (or it is trashed). */
export class WidgetEmbedHostNotFoundError extends Error {
  constructor({ message }: { message: string }, _optional: Record<string, never> = {}) {
    super(message);
    this.name = "WidgetEmbedHostNotFoundError";
  }
}

/**
 * `WIDGETS_EMBED_PLACEMENT_NOT_FOUND` (404) — `removeWidgetEmbed` was called with a `placementId`
 * that matches no `widgetEmbed` node in the host's body (already removed, or never existed). Fixed
 * during the C4d leftovers pass: `removeEmbedByPlacementId` is a no-op filter — before this class
 * existed, a stale or bogus `placementId` fell through to `writeHostBody` unchanged and reported
 * success while writing nothing.
 */
export class WidgetEmbedPlacementNotFoundError extends Error {
  constructor({ message }: { message: string }, _optional: Record<string, never> = {}) {
    super(message);
    this.name = "WidgetEmbedPlacementNotFoundError";
  }
}

/** `WIDGETS_EMBED_HOST_UNSUPPORTED` (400) — the host exists but has no rich-text body a widgetEmbed node can live in. */
export class WidgetEmbedHostUnsupportedError extends Error {
  readonly reason: "html-page" | "widget-area";
  constructor({ message, reason }: { message: string; reason: "html-page" | "widget-area" }, _optional: Record<string, never> = {}
  ) {
    super(message);
    this.reason = reason;
    this.name = "WidgetEmbedHostUnsupportedError";
  }
}
