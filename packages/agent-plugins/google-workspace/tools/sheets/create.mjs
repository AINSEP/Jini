/**
 * @file Tool `sheets_create` (`p_google_workspace__sheets_create`): a new spreadsheet, optionally
 * with named tabs. Under `drive.file`, a file the site creates is one the site may open from then on.
 *
 * A create is not idempotent: if Google's answer is lost the outcome is `unknown`
 * (`uncertain-outcome`) and the call is never replayed, so a lost answer cannot make two files.
 */
import { resourceLines, SHEETS_API, sendSheetsRequest } from '../../lib/sheets-client.mjs';

const CREATE_FIELDS = 'spreadsheetId,spreadsheetUrl,properties(title),sheets(properties(sheetId,title,index))';

/** The new file's properties: the title plus the locale and time zone only when given. @complexity O(1). */
function propertiesOf(input) {
  return { title: input.title, ...(input.locale ? { locale: input.locale } : {}), ...(input.timeZone ? { timeZone: input.timeZone } : {}) };
}

/** What chat needs from Google's answer: ids, URL and tabs. @complexity O(tabs). */
function created(body) {
  return { spreadsheetId: body?.spreadsheetId, url: body?.spreadsheetUrl, title: body?.properties?.title, tabs: (body?.sheets ?? []).map((sheet) => sheet.properties) };
}

export default {
  /** @param {{ input: { connectionRef: string, title: string, tabs?: string[], locale?: string, timeZone?: string }, capabilities: object, signal?: AbortSignal }} call */
  async invoke(call) {
    const { input } = call;
    const body = await sendSheetsRequest({ call, request: {
      kind: 'write', method: 'POST', url: SHEETS_API, query: { fields: CREATE_FIELDS },
      body: { properties: propertiesOf(input), ...(input.tabs ? { sheets: input.tabs.map((title) => ({ properties: { title } })) } : {}) },
    } });
    return created(body);
  },
  describeAffectedResources({ input }) {
    return resourceLines({ lines: [`New spreadsheet "${input.title}" in the connected Google Drive`] });
  },
};
