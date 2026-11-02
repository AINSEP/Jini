/**
 * @file The A1-notation helpers of the Google Workspace plugin's Sheets code (tools, CSV export and
 * form delivery): column letters, Google's normalized range parsed into parts, the strict
 * two-corner range the CSV export plans with, tab-title quoting, and the person-readable label of a
 * Sheets `GridRange` the confirmation card shows.
 *
 * Exists so each of these has ONE name and ONE contract: a range Google returns is parsed one way
 * (`parseA1Range`, undefined when not in Google's shape), a range a person gives the export another
 * (`parseBoundsA1`, refused when not a plain `A1:B2`), and a tab title is quoted one way
 * (`tabRange`), so a title can never change which cells a range names.
 */
import { GoogleWorkspaceError } from './request-policy.mjs';

/** 0 → `A`, 25 → `Z`, 26 → `AA`. @complexity O(letters). */
export function columnName(required, _optional = {}) {
  let name = '';
  for (let n = required.index + 1; n > 0; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  return name;
}

/** `A` → 0, `AA` → 26. @complexity O(letters). */
export function columnIndex(required, _optional = {}) {
  return [...required.column].reduce((index, letter) => index * 26 + letter.charCodeAt(0) - 64, 0) - 1;
}

/** `'Tab ''name'''!<cells>`: the title quoted, its quotes doubled, so a title cannot change the range. @complexity O(title). */
export function tabRange(required, _optional = {}) {
  return `'${required.title.replaceAll("'", "''")}'!${required.cells}`;
}

const GOOGLE_RANGE = /^(?<sheet>.+)!(?<startColumn>[A-Z]+)(?<startRow>\d+)(?::(?<endColumn>[A-Z]+)(?<endRow>\d+))?$/;

/**
 * Google's normalized A1 range (`'Tab name'!B2:D90`) as its parts; undefined when it is not in that
 * shape (Google normalizes every values range it returns to it).
 * @complexity O(n) characters.
 */
export function parseA1Range(required, _optional = {}) {
  const groups = GOOGLE_RANGE.exec(required.range ?? '')?.groups;
  if (!groups) return undefined;
  return { sheet: groups.sheet, startColumn: groups.startColumn, startRow: Number(groups.startRow), endColumn: groups.endColumn, endRow: groups.endRow === undefined ? undefined : Number(groups.endRow) };
}

const BOUNDS_RANGE = /^([A-Z]{1,3})([1-9]\d{0,6}):([A-Z]{1,3})([1-9]\d{0,6})$/;

/**
 * Zero-based inclusive bounds of a two-corner A1 range such as `B2:F200` (no tab name): the CSV
 * export bounds its reads from it before it sends any.
 * @returns {{ firstRow: number, lastRow: number, firstColumn: number, lastColumn: number }}
 * @throws {GoogleWorkspaceError} `invalid-input` for anything else, including reversed corners.
 * @complexity O(1).
 */
export function parseBoundsA1(required, _optional = {}) {
  const match = BOUNDS_RANGE.exec(required.range);
  const bounds = match && { firstColumn: columnIndex({ column: match[1] }), firstRow: Number(match[2]) - 1, lastColumn: columnIndex({ column: match[3] }), lastRow: Number(match[4]) - 1 };
  if (!bounds || bounds.lastRow < bounds.firstRow || bounds.lastColumn < bounds.firstColumn) {
    throw new GoogleWorkspaceError({ code: 'invalid-input' }, { detail: 'range must look like A1:D200, top-left corner first' });
  }
  return bounds;
}

/** "rows 2-10", "rows 2 onward" or "all rows" for zero-based [start, end). @complexity O(1). */
function span(name, start, end, show) {
  if (start === undefined && end === undefined) return `all ${name}`;
  const first = show(start ?? 0);
  return end === undefined ? `${name} ${first} onward` : `${name} ${first}-${show(end - 1)}`;
}

/**
 * The card label of a `GridRange`: `tab 0, rows 2-10, columns A-D`, instead of raw zero-based indices.
 * @param {{ range: { sheetId: number, startRowIndex?: number, endRowIndex?: number, startColumnIndex?: number, endColumnIndex?: number } }} required
 * @complexity O(1).
 */
export function gridRangeLabel(required, _optional = {}) {
  const { sheetId, startRowIndex, endRowIndex, startColumnIndex, endColumnIndex } = required.range;
  const rows = span('rows', startRowIndex, endRowIndex, (index) => String(index + 1));
  const columns = span('columns', startColumnIndex, endColumnIndex, (index) => columnName({ index }));
  return `tab ${sheetId}, ${rows}, ${columns}`;
}
