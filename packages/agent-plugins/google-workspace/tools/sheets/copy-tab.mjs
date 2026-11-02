/**
 * @file Tool `sheets_copy_tab` (`p_google_workspace__sheets_copy_tab`): copies one tab into another
 * spreadsheet the connection can open (`sheets.copyTo`), returning the new tab's properties.
 *
 * Each call adds a new tab, so a lost answer is `uncertain-outcome` and is never replayed.
 */
import { resourceLines, sendSheetsRequest, sheetsUrl } from '../../lib/sheets-client.mjs';

export default {
  /** @param {{ input: { connectionRef: string, spreadsheetId: string, sheetId: number, destinationSpreadsheetId: string }, capabilities: object, signal?: AbortSignal }} call */
  async invoke(call) {
    const { input } = call;
    const body = await sendSheetsRequest({ call, request: {
      kind: 'write', method: 'POST',
      url: sheetsUrl({ spreadsheetId: input.spreadsheetId }, { segments: ['sheets', String(input.sheetId)], method: ':copyTo' }),
      body: { destinationSpreadsheetId: input.destinationSpreadsheetId },
    } });
    return { destinationSpreadsheetId: input.destinationSpreadsheetId, sheetId: body?.sheetId, title: body?.title, index: body?.index };
  },
  describeAffectedResources({ input }) {
    return resourceLines({ lines: [`New tab in spreadsheet ${input.destinationSpreadsheetId}, copied from tab ${input.sheetId} of spreadsheet ${input.spreadsheetId}`] });
  },
};
