// GAP: G3 no text search a small app can wire over listEntries
/** @file Text match over note rows: the whole collection is read, so this is a demo filter, not a database bound. */

/**
 * Keeps the rows whose title or body contains `text` (case-insensitive, trimmed), in input order, at most
 * `limit` of them. An empty or whitespace-only query keeps every row. The input is not changed.
 * @complexity O(rows x text length): every row is scanned once.
 */
export function filterNotesByText<Row extends { readonly title: string; readonly body: string }>(
  { rows, text }: { readonly rows: readonly Row[]; readonly text: string },
  { limit = Number.POSITIVE_INFINITY }: { readonly limit?: number } = {},
): Row[] {
  const needle = text.trim().toLowerCase();
  const matches = needle === '' ? rows : rows.filter((row) => `${row.title}\n${row.body}`.toLowerCase().includes(needle));
  return matches.slice(0, limit);
}
