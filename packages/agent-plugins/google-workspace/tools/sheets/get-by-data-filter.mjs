/**
 * @file Tool `sheets_get_by_data_filter` (`p_google_workspace__sheets_get_by_data_filter`): the
 * spreadsheet data matching data filters (A1 ranges, grid ranges or developer-metadata lookups),
 * via `spreadsheets.getByDataFilter`.
 *
 * Exists for reads addressed by metadata rather than by position. The result has no range
 * continuation, so a result over the 64 KiB tool-output bound is an error, never a cut result.
 */
import { assertOutputWithin, sendSheetsRequest, sheetsUrl, spreadsheetFields } from '../../lib/sheets-client.mjs';

export default {
  /** @param {{ input: { connectionRef: string, spreadsheetId: string, dataFilters: object[], includeGridData?: boolean, fields?: string }, capabilities: object, signal?: AbortSignal }} call */
  async invoke(call) {
    const { input } = call;
    const includeGridData = input.includeGridData === true;
    const body = await sendSheetsRequest({ call, request: {
      kind: 'read', method: 'POST', url: sheetsUrl({ spreadsheetId: input.spreadsheetId }, { method: ':getByDataFilter' }),
      query: { fields: spreadsheetFields({ fields: input.fields, includeGridData }) },
      body: { dataFilters: input.dataFilters, includeGridData },
    } });
    return assertOutputWithin({ value: body });
  },
};
