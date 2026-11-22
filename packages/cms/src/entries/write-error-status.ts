import {
  ContentTypeNotActiveError,
  ContentTypeNotFoundError,
  EntryFieldValidationError,
  EntryNotFoundError,
  EntrySlugConflictError,
  ForbiddenError,
  VersionConflictError,
} from "./errors.js";

/**
 * Maps an entry write-service `Result` error (`createEntry`/`updateEntry`/`publishEntry`/
 * `unpublishEntry`) to its HTTP status and stable error code — one table shared by the create,
 * update and lifecycle routes. Each write function only returns a subset of these kinds; their
 * `Result<_, Error>` signature still admits any `Error`, which is answered as a 500.
 *
 * @complexity O(1).
 */
export function entryWriteErrorStatus({ error }: { error: Error }, _optional: Record<string, never> = {}): { status: number; code: string } {
  if (error instanceof ForbiddenError) return { status: 403, code: "FORBIDDEN" };
  if (error instanceof ContentTypeNotFoundError) return { status: 404, code: "CONTENT_TYPE_NOT_FOUND" };
  if (error instanceof EntryNotFoundError) return { status: 404, code: "ENTRY_NOT_FOUND" };
  if (error instanceof ContentTypeNotActiveError) return { status: 409, code: "CONTENT_TYPE_NOT_ACTIVE" };
  if (error instanceof EntrySlugConflictError) return { status: 409, code: "ENTRY_SLUG_CONFLICT" };
  if (error instanceof VersionConflictError) return { status: 409, code: "VERSION_CONFLICT" };
  if (error instanceof EntryFieldValidationError) return { status: 400, code: "VALIDATION_ERROR" };
  return { status: 500, code: "INTERNAL_ERROR" };
}
