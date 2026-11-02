/**
 * @file CSV export planning and encoding for the `export_csv` tool: split one tab (or an A1 range of
 * it) into bounded values reads, and encode the rows as RFC 4180 CSV.
 *
 * Exists because Google's own CSV export covers only a spreadsheet's first tab and an arbitrary tab
 * would need an undocumented `gid` URL; bounded `values.batchGet` reads plus local encoding work for
 * any tab. The size is bounded BEFORE the first read (from the tab's grid size or the range), and an
 * export over a bound is an error, never a silently partial file. Text cells that start like a
 * formula are prefixed with `'` so opening the file never runs a visitor's formula.
 */
import { GoogleWorkspaceError } from './request-policy.mjs';
import { columnName, tabRange } from './sheets-a1.mjs';

export const MAX_EXPORT_ROWS = 20_000;
export const MAX_EXPORT_CELLS = 100_000;
export const MAX_CSV_BYTES = 4 * 1024 * 1024;
/** Cells per read: keeps each answer far below the host's 1 MiB response bound. */
const CHUNK_CELLS = 10_000;

const tooLarge = (detail) => new GoogleWorkspaceError({ code: 'limit-exceeded' }, { detail });

/**
 * The reads covering `area` (zero-based, inclusive), in row order.
 * @param {{ title: string, area: { firstRow: number, lastRow: number, firstColumn: number, lastColumn: number } }} required
 * @returns {{ range: string, rowCount: number }[]}
 * @throws {GoogleWorkspaceError} `limit-exceeded` when the area is over the row or cell bound.
 * @complexity O(chunks), at most MAX_EXPORT_CELLS / CHUNK_CELLS.
 */
export function planChunks(required, _optional = {}) {
  const { firstRow, lastRow, firstColumn, lastColumn } = required.area;
  const rows = lastRow - firstRow + 1;
  const columns = lastColumn - firstColumn + 1;
  if (rows > MAX_EXPORT_ROWS) throw tooLarge(`at most ${MAX_EXPORT_ROWS} rows; give a range`);
  if (rows * columns > MAX_EXPORT_CELLS) throw tooLarge(`at most ${MAX_EXPORT_CELLS} cells; give a smaller range`);
  const rowsPerChunk = Math.max(1, Math.floor(CHUNK_CELLS / columns));
  const [from, to] = [columnName({ index: firstColumn }), columnName({ index: lastColumn })];
  const chunks = [];
  for (let start = firstRow; start <= lastRow; start += rowsPerChunk) {
    const end = Math.min(lastRow, start + rowsPerChunk - 1);
    chunks.push({ range: tabRange({ title: required.title, cells: `${from}${start + 1}:${to}${end + 1}` }), rowCount: end - start + 1 });
  }
  return chunks;
}

/**
 * Text a spreadsheet app would run as a formula when it opens the CSV (OWASP "CSV injection"):
 * a leading `=`, `+`, `-`, `@`, tab or carriage return. Form answers are stored RAW, so a visitor's
 * `=HYPERLINK(...)` comes back from Google as plain text and would otherwise become live.
 */
const FORMULA_TRIGGER = /^[=+\-@\t\r]/;

/**
 * One CSV field: text that a spreadsheet app would evaluate gets a leading `'` (shown as text, not
 * run), then the field is quoted when it holds a comma, quote or line break. Only strings are
 * prefixed: a number Google returns as a number (`UNFORMATTED_VALUE`) stays exact, while a
 * formatted value such as `-5` or `+1 555` is text and keeps the `'` (the fidelity trade-off,
 * documented in `references/sheets.md`).
 * @complexity O(length).
 */
function csvField(value) {
  const raw = value === undefined || value === null ? '' : String(value);
  const text = typeof value === 'string' && FORMULA_TRIGGER.test(value) ? `'${raw}` : raw;
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/**
 * RFC 4180 CSV (CRLF line ends) of `rows`, padded to the widest row, trailing empty rows dropped.
 * @param {{ rows: readonly (readonly unknown[])[] }} required
 * @returns {{ csv: string, rows: number, columns: number, bytes: number }}
 * @throws {GoogleWorkspaceError} `limit-exceeded` over {@link MAX_CSV_BYTES}.
 * @complexity O(cells).
 */
export function encodeCsv(required, _optional = {}) {
  let used = required.rows.length;
  while (used > 0 && required.rows[used - 1].length === 0) used -= 1;
  const kept = required.rows.slice(0, used);
  const columns = Math.max(0, ...kept.map((row) => row.length));
  const csv = kept.map((row) => Array.from({ length: columns }, (_, index) => csvField(row[index])).join(',')).join('\r\n');
  const bytes = Buffer.byteLength(csv);
  if (bytes > MAX_CSV_BYTES) throw tooLarge('the CSV would be over 4 MiB; give a smaller range');
  return { csv, rows: used, columns, bytes };
}
