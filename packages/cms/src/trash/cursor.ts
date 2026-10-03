const SEPARATOR = "\u0000";

export function encodeTrashCursor(required: { trashedAt: string; id: string }): string {
  return Buffer.from(`${required.trashedAt}${SEPARATOR}${required.id}`, "utf8").toString("base64url");
}

export function decodeTrashCursor({ cursor }: { cursor: string | null | undefined }): { trashedAt: string; id: string } | null {
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
