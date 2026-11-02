/**
 * @file Tool `sheets_find` (`p_google_workspace__sheets_find`): finds cells whose text contains (or
 * equals) a search text in up to 20 explicit ranges, returning cell references and short excerpts.
 *
 * The Sheets API has no read-only search, so this reads the ranges (`values.batchGet`) and matches
 * plain text locally (no regular expressions, so no pathological patterns). It scans at most 50,000
 * cells (more is an error, never a silent partial scan) and returns at most 100 matches with
 * `truncated` set when there were more.
 */
import { GoogleWorkspaceError } from '../../lib/request-policy.mjs';
import { columnIndex, columnName, parseA1Range } from '../../lib/sheets-a1.mjs';
import { cellCount, readOptions, sendSheetsRequest, sheetsUrl, SHEETS_LIMITS } from '../../lib/sheets-client.mjs';

/** The matcher for the caller's options. @complexity O(1) to build; O(text) per cell. */
function matcherFor(input) {
  const fold = (text) => (input.matchCase ? text : text.toLowerCase());
  const needle = fold(input.text);
  return input.matchEntireCell ? (cell) => fold(cell) === needle : (cell) => fold(cell).includes(needle);
}

/**
 * Matching cells of one value range, appended to `found` until it holds one more than the cap (so
 * the caller knows whether there were more).
 * @complexity O(cells).
 */
function collectMatches(valueRange, matches, found) {
  const start = parseA1Range({ range: valueRange.range });
  if (!start) throw new GoogleWorkspaceError({ code: 'unexpected-response' });
  const firstColumn = columnIndex({ column: start.startColumn });
  (valueRange.values ?? []).forEach((row, rowOffset) => row.forEach((value, columnOffset) => {
    if (found.length > SHEETS_LIMITS.maxMatches || !matches(String(value))) return;
    found.push({ cell: `${start.sheet}!${columnName({ index: firstColumn + columnOffset })}${start.startRow + rowOffset}`, excerpt: String(value).slice(0, SHEETS_LIMITS.maxExcerptChars) });
  }));
}

export default {
  /** @param {{ input: { connectionRef: string, spreadsheetId: string, ranges: string[], text: string, matchCase?: boolean, matchEntireCell?: boolean, valueRenderOption?: string }, capabilities: object, signal?: AbortSignal }} call */
  async invoke(call) {
    const { input } = call;
    const body = await sendSheetsRequest({ call, request: {
      kind: 'read', url: sheetsUrl({ spreadsheetId: input.spreadsheetId }, { segments: ['values'], method: ':batchGet' }),
      query: { ranges: input.ranges, ...readOptions({ input }) },
    } });
    const valueRanges = body?.valueRanges ?? [];
    const scannedCells = valueRanges.reduce((total, valueRange) => total + cellCount({ values: valueRange.values ?? [] }), 0);
    if (scannedCells > SHEETS_LIMITS.maxScannedCells) throw new GoogleWorkspaceError({ code: 'limit-exceeded' });
    const matches = matcherFor(input);
    const found = [];
    for (const valueRange of valueRanges) collectMatches(valueRange, matches, found);
    return { matches: found.slice(0, SHEETS_LIMITS.maxMatches), truncated: found.length > SHEETS_LIMITS.maxMatches, scannedCells };
  },
};
