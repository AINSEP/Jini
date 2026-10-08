import { ToolInputError } from "@jini-ai/core";

/**
 * @file The opaque `${createdAt}::${id}` keyset cursor shared by the `(created_at, id)`-ordered
 * list queries (the database ledger, the comment moderation queue).
 *
 * The cursor carries the position itself rather than naming a row to look up, so a page resumes
 * correctly even after the row it ended on was deleted: the comment queue's cursor used to be the
 * last comment's id, and once another moderator purged that comment, every "Load more" was refused
 * with "invalid cursor" and retrying sent the same cursor forever.
 */

/** A position in a `(created_at, id)` order. */
export type KeysetPosition = { createdAt: string; id: string };

/** Builds the cursor for the row a page ended on. @complexity O(1). */
export function encodeKeysetCursor(required: KeysetPosition, _optional: Record<string, never> = {}): string {
  return `${required.createdAt}::${required.id}`;
}

/** Splits a cursor {@link encodeKeysetCursor} built. A cursor it could not have built used to decode
 *  to `null` and read as "no cursor", silently restarting the scan from its first page (the newest
 *  ledger row; the oldest queued comment).
 *  @throws {ToolInputError} `invalid cursor` (a 400 to the tool and admin transports alike).
 *  @complexity O(cursor length). */
export function decodeKeysetCursor(required: { cursor: string }, _optional: Record<string, never> = {}): KeysetPosition {
  const separatorIndex = required.cursor.indexOf("::");
  const createdAt = required.cursor.slice(0, separatorIndex);
  const id = required.cursor.slice(separatorIndex + 2);
  if (separatorIndex < 0 || id.length === 0 || Number.isNaN(Date.parse(createdAt))) {
    throw new ToolInputError({ message: "invalid cursor" });
  }
  return { createdAt, id };
}
