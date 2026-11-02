/**
 * @file Tool `sheets_find_replace` (`p_google_workspace__sheets_find_replace`): replaces every match
 * of a text on one tab or on every tab (`batchUpdate` with one `findReplace` request). Destructive:
 * matched cells are overwritten and the site cannot undo it.
 *
 * Not idempotent (replacing `a` with `aa` twice differs), so a lost answer is `uncertain-outcome` and
 * is never replayed.
 */
import { resourceLines, sendSheetsRequest, sheetsUrl } from '../../lib/sheets-client.mjs';

/** The request's scope: the named tab, else every tab (the schema requires exactly one). @complexity O(1). */
const scopeOf = (input) => (input.sheetId === undefined ? { allSheets: true } : { sheetId: input.sheetId });
const MATCH_OPTIONS = ['matchCase', 'matchEntireCell', 'searchByRegex', 'includeFormulas'];
const COUNTS = ['occurrencesChanged', 'valuesChanged', 'formulasChanged', 'rowsChanged', 'sheetsChanged'];

/** The one `findReplace` request; every match option is sent explicitly (absent = false). @complexity O(1). */
function findReplaceRequest(input) {
  const options = Object.fromEntries(MATCH_OPTIONS.map((name) => [name, input[name] === true]));
  return { find: input.find, replacement: input.replacement, ...options, ...scopeOf(input) };
}

export default {
  /** @param {{ input: { connectionRef: string, spreadsheetId: string, find: string, replacement: string, sheetId?: number, allSheets?: true, matchCase?: boolean, matchEntireCell?: boolean, searchByRegex?: boolean, includeFormulas?: boolean }, capabilities: object, signal?: AbortSignal }} call */
  async invoke(call) {
    const { input } = call;
    const body = await sendSheetsRequest({ call, request: {
      kind: 'write', method: 'POST', url: sheetsUrl({ spreadsheetId: input.spreadsheetId }, { method: ':batchUpdate' }),
      body: { requests: [{ findReplace: findReplaceRequest(input) }], includeSpreadsheetInResponse: false },
    } });
    // Google omits a zero count from the reply.
    const reply = body?.replies?.[0]?.findReplace ?? {};
    return Object.fromEntries(COUNTS.map((name) => [name, reply[name] ?? 0]));
  },
  describeAffectedResources({ input }) {
    const where = input.sheetId === undefined ? 'every tab' : `tab ${input.sheetId}`;
    return resourceLines({ lines: [`Replace every match of "${input.find}" with "${input.replacement}" on ${where} of spreadsheet ${input.spreadsheetId} (matched cells are overwritten)`] });
  },
};
