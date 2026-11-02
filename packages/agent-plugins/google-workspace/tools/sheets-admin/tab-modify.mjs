/**
 * @file Tool `sheets_tab_modify` (`p_google_workspace__sheets_tab_modify`): add, rename, delete, duplicate or move
 * one tab of a spreadsheet. Declared destructive because `delete` removes a tab and its data; the
 * confirmation card names the spreadsheet, the action and the tab.
 *
 * Exists as a named wrapper so the common tab changes need no raw batch: each action becomes one
 * reviewed request kind and goes through the same batch path as `batch_update`.
 */
import { resourceLines, runBatchUpdate, sheetsClientFor, spreadsheetLine } from '../../lib/sheets-client.mjs';

/** action → the one batch request it sends. */
const REQUESTS = {
  add: (input) => ({ addSheet: { properties: { title: input.title, ...(input.index === undefined ? {} : { index: input.index }) } } }),
  rename: (input) => ({ updateSheetProperties: { properties: { sheetId: input.sheetId, title: input.title }, fields: 'title' } }),
  delete: (input) => ({ deleteSheet: { sheetId: input.sheetId } }),
  duplicate: (input) => ({ duplicateSheet: { sourceSheetId: input.sheetId, ...(input.title === undefined ? {} : { newSheetName: input.title }), ...(input.index === undefined ? {} : { insertSheetIndex: input.index }) } }),
  move: (input) => ({ updateSheetProperties: { properties: { sheetId: input.sheetId, index: input.index }, fields: 'index' } }),
};

/** The resulting tab: Google's properties for add/duplicate, the requested ones otherwise. @complexity O(1). */
function resultFor(input, reply) {
  const created = reply?.addSheet?.properties ?? reply?.duplicateSheet?.properties;
  if (created) return { action: input.action, tab: { sheetId: created.sheetId, title: created.title, index: created.index } };
  return { action: input.action, tab: { sheetId: input.sheetId, ...(input.title === undefined ? {} : { title: input.title }), ...(input.index === undefined ? {} : { index: input.index }) } };
}

export default {
  async invoke({ input, capabilities, signal }) {
    const { replies } = await runBatchUpdate({ client: sheetsClientFor({ capabilities }), connectionRef: input.connectionRef, spreadsheetId: input.spreadsheetId, requests: [REQUESTS[input.action](input)] }, { signal });
    return resultFor(input, replies[0]);
  },
  describeAffectedResources({ input }) {
    const tab = input.sheetId === undefined ? `new tab "${input.title}"` : `tab ${input.sheetId}`;
    return resourceLines({ lines: [spreadsheetLine(input), `${input.action} ${tab}${input.action === 'delete' ? ' and all of its data' : ''}`] });
  },
};
