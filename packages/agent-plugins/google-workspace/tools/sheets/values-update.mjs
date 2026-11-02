/**
 * @file Tool `sheets_values_update` (`p_google_workspace__sheets_values_update`): writes values over
 * one explicit range (`values.update`). Destructive: what was in those cells is replaced, and the site
 * cannot undo a remote change.
 *
 * Values go in `RAW` unless the caller explicitly asks for `USER_ENTERED`. The same update twice
 * gives the same cells, so a transient failure may be retried.
 */
import { assertPayloadWithin, cellCount, resourceLines, sendSheetsRequest, sheetsUrl, valueInputOption } from '../../lib/sheets-client.mjs';

export default {
  /** @param {{ input: { connectionRef: string, spreadsheetId: string, range: string, values: unknown[][], valueInputOption?: string }, capabilities: object, signal?: AbortSignal }} call */
  async invoke(call) {
    const { input } = call;
    const body = await sendSheetsRequest({ call, request: {
      kind: 'idempotent-write', method: 'PUT',
      url: sheetsUrl({ spreadsheetId: input.spreadsheetId }, { segments: ['values', input.range] }),
      query: { valueInputOption: valueInputOption({ option: input.valueInputOption }) },
      body: assertPayloadWithin({ value: { range: input.range, majorDimension: 'ROWS', values: input.values } }),
    } });
    return { updatedRange: body?.updatedRange, updatedRows: body?.updatedRows, updatedColumns: body?.updatedColumns, updatedCells: body?.updatedCells };
  },
  describeAffectedResources({ input }) {
    return resourceLines({ lines: [`Overwrite ${input.range} of spreadsheet ${input.spreadsheetId} (${cellCount({ values: input.values })} cell(s); current values are replaced)`] });
  },
};
