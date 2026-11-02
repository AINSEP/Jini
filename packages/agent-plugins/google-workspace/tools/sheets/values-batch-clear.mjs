/**
 * @file Tool `sheets_values_batch_clear` (`p_google_workspace__sheets_values_batch_clear`): clears
 * the values of up to 100 explicit ranges in one request (`values.batchClear`). Destructive.
 */
import { resourceLines, sendSheetsRequest, sheetsUrl } from '../../lib/sheets-client.mjs';

export default {
  /** @param {{ input: { connectionRef: string, spreadsheetId: string, ranges: string[] }, capabilities: object, signal?: AbortSignal }} call */
  async invoke(call) {
    const { input } = call;
    const body = await sendSheetsRequest({ call, request: {
      kind: 'idempotent-write', method: 'POST', body: { ranges: input.ranges },
      url: sheetsUrl({ spreadsheetId: input.spreadsheetId }, { segments: ['values'], method: ':batchClear' }),
    } });
    return { clearedRanges: body?.clearedRanges ?? [] };
  },
  describeAffectedResources({ input }) {
    return resourceLines({ lines: input.ranges.map((range) => `Clear every value in ${range} of spreadsheet ${input.spreadsheetId}`) });
  },
};
