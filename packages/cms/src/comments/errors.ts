/**
 * @file Typed domain errors for `comments` (ADR-031, SPEC-035).
 *
 * One class per error this module originates, mirroring `src/seo/errors.ts`'s one-class-per-code
 * convention. Route handlers (`src/server/routes/admin/comments/*.ts`) map these 1:1 to HTTP codes.
 */
export class CommentsSettingsValidationError extends Error {}

/** A comment id the caller named does not exist in this workspace (tool + route not-found arm). */
export class CommentNotFoundError extends Error {
  constructor(required: { commentId: string }, _optional: Record<string, never> = {}) {
    super(`comment '${required.commentId}' was not found`);
    this.name = "CommentNotFoundError";
  }
}

/** The caller's `expectedVersion` is stale; `currentVersion` is what a retry should send. */
export class CommentVersionConflictError extends Error {
  readonly currentVersion: number | undefined;
  constructor(required: { commentId: string; currentVersion?: number }, _optional: Record<string, never> = {}) {
    super(`comment '${required.commentId}' was modified concurrently (current version is ${required.currentVersion ?? "unknown"})`);
    this.name = "CommentVersionConflictError";
    this.currentVersion = required.currentVersion;
  }
}
