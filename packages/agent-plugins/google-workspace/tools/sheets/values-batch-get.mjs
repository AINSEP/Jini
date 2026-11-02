/**
 * @file Tool `sheets_values_batch_get` (`p_google_workspace__sheets_values_batch_get`): the values
 * of up to 20 explicit ranges in one request (`values.batchGet`).
 *
 * All ranges share ONE output budget (500 rows, 5,000 cells, 64 KiB); every range that was cut
 * carries its own `continuation` range.
 */
import { boundValueRanges, readOptions, sendSheetsRequest, sheetsUrl } from '../../lib/sheets-client.mjs';

export default {
  /** @param {{ input: { connectionRef: string, spreadsheetId: string, ranges: string[], valueRenderOption?: string, dateTimeRenderOption?: string }, capabilities: object, signal?: AbortSignal }} call */
  async invoke(call) {
    const { input } = call;
    const body = await sendSheetsRequest({ call, request: {
      kind: 'read', url: sheetsUrl({ spreadsheetId: input.spreadsheetId }, { segments: ['values'], method: ':batchGet' }),
      query: { ranges: input.ranges, ...readOptions({ input }) },
    } });
    return { valueRanges: boundValueRanges({ valueRanges: body?.valueRanges ?? [] }) };
  },
};
