/**
 * @file Tool `sheets_values_batch_update` (`p_google_workspace__sheets_values_batch_update`): writes
 * values over up to 100 explicit ranges in one request (`values.batchUpdate`). Destructive: the
 * current values of every listed range are replaced.
 *
 * Values go in `RAW` unless the caller explicitly asks for `USER_ENTERED`; the whole body stays under
 * 1 MiB. Repeating the same batch gives the same cells, so a transient failure may be retried.
 */
import { assertPayloadWithin, cellCount, resourceLines, sendSheetsRequest, sheetsUrl, valueInputOption } from '../../lib/sheets-client.mjs';

export default {
  /** @param {{ input: { connectionRef: string, spreadsheetId: string, data: { range: string, values: unknown[][] }[], valueInputOption?: string }, capabilities: object, signal?: AbortSignal }} call */
  async invoke(call) {
    const { input } = call;
    const data = input.data.map(({ range, values }) => ({ range, majorDimension: 'ROWS', values }));
    const body = await sendSheetsRequest({ call, request: {
      kind: 'idempotent-write', method: 'POST',
      url: sheetsUrl({ spreadsheetId: input.spreadsheetId }, { segments: ['values'], method: ':batchUpdate' }),
      body: assertPayloadWithin({ value: { valueInputOption: valueInputOption({ option: input.valueInputOption }), data, includeValuesInResponse: false } }),
    } });
    return {
      totalUpdatedRows: body?.totalUpdatedRows, totalUpdatedCells: body?.totalUpdatedCells, totalUpdatedSheets: body?.totalUpdatedSheets,
      responses: (body?.responses ?? []).map(({ updatedRange, updatedCells }) => ({ updatedRange, updatedCells })),
    };
  },
  describeAffectedResources({ input }) {
    return resourceLines({ lines: input.data.map(({ range, values }) => `Overwrite ${range} of spreadsheet ${input.spreadsheetId} (${cellCount({ values })} cell(s); current values are replaced)`) });
  },
};
