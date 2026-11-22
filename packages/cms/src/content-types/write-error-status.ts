import { EntityNotLiveError } from "../core/entity-liveness.js";
import {
  ContentTypeAlreadyExistsError,
  ContentTypeLifecycleError,
  ContentTypeNotFoundError,
  ForbiddenError,
  InvalidFieldKindError,
  InvalidFieldNameGrammarError,
  InvalidFieldShapeError,
  InvalidKeyGrammarError,
  QueryableFieldCapExceededError,
  ReservedContentTypeKeyError,
  ValidationError,
  VersionConflictError,
} from "./errors.js";

/** Every rejection that answers 400: request-shape and domain-grammar failures. */
const VALIDATION_ERRORS = [
  ValidationError,
  InvalidKeyGrammarError,
  ReservedContentTypeKeyError,
  InvalidFieldNameGrammarError,
  InvalidFieldShapeError,
  InvalidFieldKindError,
  QueryableFieldCapExceededError,
] as const;

/**
 * Maps a content-type write rejection (`parseContentTypeFieldDefs`, `registerContentType`,
 * `updateContentTypeFields`, and the deprecate/reactivate/tombstone lifecycle) to an HTTP
 * status/code pair — one table a host's register, update-fields and lifecycle routes, so the three cannot drift. Each write function returns only a subset of these
 * kinds; their `Result<_, Error>` signature still admits any `Error`, which is answered as a 500.
 *
 * The `ContentTypeAlreadyExistsError`/`EntityNotLiveError` arms are S9 (web-high fix plan,
 * 2026-09-24) — row 7 (define overwrites/resurrects) and its tombstone-resurrect sibling;
 * `updateContentTypeFields` rejects a tombstoned type with `EntityNotLiveError` instead of silently
 * applying a full-replace to it.
 *
 * @complexity O(1).
 */
export function contentTypeWriteErrorStatus({ error }: { error: Error }, _optional: Record<string, never> = {}): { status: number; code: string } {
  if (error instanceof ForbiddenError) return { status: 403, code: "FORBIDDEN" };
  if (error instanceof ContentTypeNotFoundError) return { status: 404, code: "CONTENT_TYPE_NOT_FOUND" };
  if (error instanceof ContentTypeAlreadyExistsError) return { status: 409, code: "CONTENT_TYPE_ALREADY_EXISTS" };
  if (error instanceof EntityNotLiveError) return { status: 409, code: error.code };
  if (error instanceof VersionConflictError) return { status: 409, code: "VERSION_CONFLICT" };
  if (error instanceof ContentTypeLifecycleError) return { status: 409, code: "CONTENT_TYPE_LIFECYCLE_ERROR" };
  if (VALIDATION_ERRORS.some((ErrorType) => error instanceof ErrorType)) return { status: 400, code: "VALIDATION_ERROR" };
  return { status: 500, code: "INTERNAL_ERROR" };
}
