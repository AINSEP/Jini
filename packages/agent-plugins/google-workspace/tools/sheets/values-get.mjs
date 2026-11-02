/**
 * @file Tool `sheets_values_get` (`p_google_workspace__sheets_values_get`): the values of one
 * explicit A1 range (`values.get`), rows-major.
 *
 * Exists for bounded reads: at most 500 rows, 5,000 cells and 64 KiB come back; when the range holds
 * more, the result carries `continuation`, the exact range to read next (Sheets values reads have no
 * page tokens).
 */
import { boundValueRanges, readOptions, sendSheetsRequest, sheetsUrl } from '../../lib/sheets-client.mjs';

export default {
  /** @param {{ input: { connectionRef: string, spreadsheetId: string, range: string, valueRenderOption?: string, dateTimeRenderOption?: string }, capabilities: object, signal?: AbortSignal }} call */
  async invoke(call) {
    const { input } = call;
    const body = await sendSheetsRequest({ call, request: {
      kind: 'read', url: sheetsUrl({ spreadsheetId: input.spreadsheetId }, { segments: ['values', input.range] }), query: readOptions({ input }),
    } });
    const [bounded] = boundValueRanges({ valueRanges: [{ range: body?.range ?? input.range, values: body?.values }] });
    return bounded;
  },
};
