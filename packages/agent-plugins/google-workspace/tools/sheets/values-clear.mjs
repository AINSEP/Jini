/**
 * @file Tool `sheets_values_clear` (`p_google_workspace__sheets_values_clear`): clears the values of
 * one explicit range (`values.clear`; formatting stays). Destructive and not undoable from the site.
 */
import { resourceLines, sendSheetsRequest, sheetsUrl } from '../../lib/sheets-client.mjs';

export default {
  /** @param {{ input: { connectionRef: string, spreadsheetId: string, range: string }, capabilities: object, signal?: AbortSignal }} call */
  async invoke(call) {
    const { input } = call;
    const body = await sendSheetsRequest({ call, request: {
      kind: 'idempotent-write', method: 'POST', body: {},
      url: sheetsUrl({ spreadsheetId: input.spreadsheetId }, { segments: ['values', input.range], method: ':clear' }),
    } });
    return { clearedRange: body?.clearedRange };
  },
  describeAffectedResources({ input }) {
    return resourceLines({ lines: [`Clear every value in ${input.range} of spreadsheet ${input.spreadsheetId}`] });
  },
};
