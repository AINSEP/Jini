/**
 * @file Tool `sheets_format` (`p_google_workspace__sheets_format`): basic formatting of a grid range — number
 * formats, fonts, colours, alignment and wrapping (cell format with an explicit field mask), borders,
 * frozen rows and columns, and column widths. A `write`: it never touches cell values.
 *
 * Exists as a named wrapper over the reviewed `repeatCell`, `updateBorders`,
 * `updateSheetProperties` and `updateDimensionProperties` request kinds, sent as one batch. The
 * format mask is always prefixed `userEnteredFormat.` from an allow-listed set (input schema), so a
 * format call can never clear or overwrite values the way a `*` or `userEnteredValue` mask would.
 */
import { resourceLines, runBatchUpdate, sheetsClientFor, spreadsheetLine } from '../../lib/sheets-client.mjs';
import { gridRangeLabel } from '../../lib/sheets-a1.mjs';

const BORDER_SIDES = ['top', 'bottom', 'left', 'right', 'innerHorizontal', 'innerVertical'];

function cellFormatRequest(input) {
  const fields = input.fields.map((field) => `userEnteredFormat.${field}`).join(',');
  return { repeatCell: { range: input.range, cell: { userEnteredFormat: input.cellFormat }, fields } };
}

function bordersRequest(input) {
  const sides = Object.fromEntries(BORDER_SIDES.filter((side) => input.borders[side]).map((side) => [side, input.borders[side]]));
  return { updateBorders: { range: input.range, ...sides } };
}

/** Frozen rows/columns, only the ones given. @complexity O(1). */
function frozenRequest(input) {
  const gridProperties = {};
  if (input.frozenRowCount !== undefined) gridProperties.frozenRowCount = input.frozenRowCount;
  if (input.frozenColumnCount !== undefined) gridProperties.frozenColumnCount = input.frozenColumnCount;
  const fields = Object.keys(gridProperties).map((name) => `gridProperties.${name}`).join(',');
  return { updateSheetProperties: { properties: { sheetId: input.range.sheetId, gridProperties }, fields } };
}

function columnWidthRequest(input) {
  const { sheetId, startColumnIndex, endColumnIndex } = input.range;
  const range = { sheetId, dimension: 'COLUMNS', ...(startColumnIndex === undefined ? {} : { startIndex: startColumnIndex }), ...(endColumnIndex === undefined ? {} : { endIndex: endColumnIndex }) };
  return { updateDimensionProperties: { range, properties: { pixelSize: input.columnWidth }, fields: 'pixelSize' } };
}

/** The requests for the parts of the input that are present, in a fixed order. @complexity O(1). */
function requestsFor(input) {
  return [
    input.cellFormat === undefined ? undefined : cellFormatRequest(input),
    input.borders === undefined ? undefined : bordersRequest(input),
    input.frozenRowCount === undefined && input.frozenColumnCount === undefined ? undefined : frozenRequest(input),
    input.columnWidth === undefined ? undefined : columnWidthRequest(input),
  ].filter(Boolean);
}

/** What the card lists as changing. @complexity O(1). */
function changedParts(input) {
  return [
    input.cellFormat === undefined ? undefined : `cell format (${input.fields.join(', ')})`,
    input.borders === undefined ? undefined : 'borders',
    input.frozenRowCount === undefined ? undefined : `frozen rows = ${input.frozenRowCount}`,
    input.frozenColumnCount === undefined ? undefined : `frozen columns = ${input.frozenColumnCount}`,
    input.columnWidth === undefined ? undefined : `column width = ${input.columnWidth}px`,
  ].filter(Boolean);
}

export default {
  async invoke({ input, capabilities, signal }) {
    await runBatchUpdate({ client: sheetsClientFor({ capabilities }), connectionRef: input.connectionRef, spreadsheetId: input.spreadsheetId, requests: requestsFor(input) }, { signal });
    return { formatted: input.range, changed: changedParts(input) };
  },
  describeAffectedResources({ input }) {
    return resourceLines({ lines: [spreadsheetLine(input), `format ${gridRangeLabel({ range: input.range })}: ${changedParts(input).join('; ')}`] });
  },
};
