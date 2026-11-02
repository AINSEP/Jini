/**
 * @file Tool `sheets_filter_views` (`p_google_workspace__sheets_filter_views`): list, add, update, duplicate or
 * delete saved filter views. Destructive because `delete` removes a view other people may use.
 *
 * Exists as a named wrapper over the reviewed filter-view request kinds; `list` reads only the views
 * (field mask), never cell data.
 */
import { assertOutputWithin, getSpreadsheet, resourceLines, runBatchUpdate, sheetsClientFor, spreadsheetLine, tabsOf } from '../../lib/sheets-client.mjs';

/** action → the one batch request it sends. */
const REQUESTS = {
  add: (input) => ({ addFilterView: { filter: input.filter } }),
  update: (input) => ({ updateFilterView: { filter: { ...input.filter, filterViewId: input.filterViewId }, fields: input.fields.join(',') } }),
  duplicate: (input) => ({ duplicateFilterView: { filterId: input.filterViewId } }),
  delete: (input) => ({ deleteFilterView: { filterId: input.filterViewId } }),
};

/** Views per tab, optionally one tab. @complexity O(t) tabs. */
async function listViews(client, input, signal) {
  const body = await getSpreadsheet({ client, connectionRef: input.connectionRef, spreadsheetId: input.spreadsheetId, fields: 'sheets(properties(sheetId,title),filterViews)' }, { signal });
  const tabs = tabsOf({ body, sheetId: input.sheetId }).map((sheet) => ({ sheetId: sheet.properties?.sheetId, title: sheet.properties?.title, filterViews: sheet.filterViews ?? [] }));
  return assertOutputWithin({ value: { action: 'list', tabs } });
}

export default {
  async invoke({ input, capabilities, signal }) {
    const client = sheetsClientFor({ capabilities });
    if (input.action === 'list') return listViews(client, input, signal);
    const { replies } = await runBatchUpdate({ client, connectionRef: input.connectionRef, spreadsheetId: input.spreadsheetId, requests: [REQUESTS[input.action](input)] }, { signal });
    const view = replies[0]?.addFilterView?.filter ?? replies[0]?.duplicateFilterView?.filter;
    return assertOutputWithin({ value: { action: input.action, ...(view ? { filterView: view } : { filterViewId: input.filterViewId }) } });
  },
  describeAffectedResources({ input }) {
    const target = input.action === 'add' ? `new filter view "${input.filter?.title ?? 'untitled'}"` : `filter view ${input.filterViewId ?? ''}`.trim();
    const verb = input.action === 'list' ? 'list filter views (no change)' : `${input.action} ${target}`;
    return resourceLines({ lines: [spreadsheetLine(input), verb] });
  },
};
