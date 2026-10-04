/**
 * @file Keyset cursor codec for the Trash list, shared by both `TrashRepoPort` adapters so the
 * persistent repo and the in-memory test double cannot drift on pagination.
 *
 * Keyset on `(trashed_at, id)` rather than OFFSET: the sweeper deletes rows underneath a paging
 * reader, and OFFSET would silently skip an item every time a row above the window disappeared.
 */
const SEPARATOR = "\u0000";

/** @complexity O(1). */
export function encodeTrashCursor(required: { trashedAt: string; id: string; }): string {
  return Buffer.from(`${required.trashedAt}${SEPARATOR}${required.id}`, "utf8").toString("base64url");
}

/**
 * Decodes a cursor produced by {@link encodeTrashCursor}.
 *
 * Returns `null` for anything unparseable rather than throwing — a stale or hand-edited cursor
 * degrades to "start from the top", which is the safe reading for a list of deleted things.
 *
 * @complexity O(1).
 */
export function decodeTrashCursor({ cursor }: { cursor: string | null | undefined; }): { trashedAt: string; id: string; } | null {
  if (!cursor) return null;
  let decoded: string;
  try {
    decoded = Buffer.from(cursor, "base64url").toString("utf8");
  } catch {
    return null;
  }
  const at = decoded.indexOf(SEPARATOR);
  if (at <= 0 || at === decoded.length - 1) return null;
  return { trashedAt: decoded.slice(0, at), id: decoded.slice(at + 1) };
}
