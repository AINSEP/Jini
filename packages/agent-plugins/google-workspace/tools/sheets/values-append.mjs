/**
 * @file Tool `sheets_values_append` (`p_google_workspace__sheets_values_append`): appends rows after
 * the table found in a tab or range (`values.append`), inserting new rows by default so nothing
 * below the table is written over.
 *
 * Values go in `RAW` unless the caller explicitly asks for `USER_ENTERED`. An append is not
 * idempotent: a lost answer is `uncertain-outcome` and is never replayed (it could add the rows twice).
 */
import { assertPayloadWithin, cellCount, resourceLines, sendSheetsRequest, sheetsUrl, valueInputOption } from '../../lib/sheets-client.mjs';

export default {
  /** @param {{ input: { connectionRef: string, spreadsheetId: string, range: string, values: unknown[][], valueInputOption?: string, insertDataOption?: string }, capabilities: object, signal?: AbortSignal }} call */
  async invoke(call) {
    const { input } = call;
    const body = await sendSheetsRequest({ call, request: {
      kind: 'write', method: 'POST',
      url: sheetsUrl({ spreadsheetId: input.spreadsheetId }, { segments: ['values', input.range], method: ':append' }),
      query: { valueInputOption: valueInputOption({ option: input.valueInputOption }), insertDataOption: input.insertDataOption ?? 'INSERT_ROWS' },
      body: assertPayloadWithin({ value: { range: input.range, majorDimension: 'ROWS', values: input.values } }),
    } });
    const updates = body?.updates ?? {};
    return { tableRange: body?.tableRange, updatedRange: updates.updatedRange, updatedRows: updates.updatedRows, updatedCells: updates.updatedCells };
  },
  describeAffectedResources({ input }) {
    return resourceLines({ lines: [`Append ${input.values.length} row(s), ${cellCount({ values: input.values })} cell(s), after the table in ${input.range} of spreadsheet ${input.spreadsheetId}`] });
  },
};
