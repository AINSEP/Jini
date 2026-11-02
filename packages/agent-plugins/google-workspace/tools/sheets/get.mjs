/**
 * @file Tool `sheets_get` (`p_google_workspace__sheets_get`): a spreadsheet's title, URL and tabs,
 * with cell data only when asked for and only for the ranges named.
 *
 * Exists so chat can learn tab names and ids before it reads or writes. Grid data is opt-in and
 * needs explicit ranges, and the result must fit the 64 KiB tool-output bound or the call errors.
 */
import { GoogleWorkspaceError } from '../../lib/request-policy.mjs';
import { assertOutputWithin, sendSheetsRequest, sheetsUrl, spreadsheetFields } from '../../lib/sheets-client.mjs';

export default {
  /** @param {{ input: { connectionRef: string, spreadsheetId: string, ranges?: string[], includeGridData?: boolean, fields?: string }, capabilities: object, signal?: AbortSignal }} call */
  async invoke(call) {
    const { input } = call;
    const includeGridData = input.includeGridData === true;
    // Grid data for a whole spreadsheet is unbounded; it is only read for the ranges the caller names.
    if (includeGridData && !input.ranges?.length) throw new GoogleWorkspaceError({ code: 'invalid-input' });
    const query = { fields: spreadsheetFields({ fields: input.fields, includeGridData }), includeGridData, ...(input.ranges ? { ranges: input.ranges } : {}) };
    const body = await sendSheetsRequest({ call, request: { kind: 'read', url: sheetsUrl({ spreadsheetId: input.spreadsheetId }), query } });
    return assertOutputWithin({ value: body });
  },
};
