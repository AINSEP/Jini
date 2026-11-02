/**
 * @file Tool `sheets_basic_filter` (`p_google_workspace__sheets_basic_filter`): set or clear the basic
 * filter of one tab. A filter only hides rows, so the tool is a `write` (confirmed, never destructive).
 *
 * Exists as a named wrapper over the reviewed `setBasicFilter` and `clearBasicFilter` request kinds.
 * Reading a tab's filter is NOT an action here: a tool's effect is declared per tool, so a read
 * inside this write tool would ask for a confirmation it does not need. `sheets_get` with
 * `fields: "sheets(properties(sheetId),basicFilter)"` reads it without one.
 */
import { resourceLines, runBatchUpdate, sheetsClientFor, spreadsheetLine } from '../../lib/sheets-client.mjs';
import { gridRangeLabel } from '../../lib/sheets-a1.mjs';

/** The set/clear request. @complexity O(1). */
function changeRequest(input) {
  if (input.action === 'clear') return { clearBasicFilter: { sheetId: input.sheetId } };
  // No sortSpecs: a basic-filter sort physically reorders rows (destructive), so sorting stays in `sheets_sort`.
  const filter = { range: input.range, ...(input.filterSpecs ? { filterSpecs: input.filterSpecs } : {}) };
  return { setBasicFilter: { filter } };
}

export default {
  async invoke({ input, capabilities, signal }) {
    const client = sheetsClientFor({ capabilities });
    await runBatchUpdate({ client, connectionRef: input.connectionRef, spreadsheetId: input.spreadsheetId, requests: [changeRequest(input)] }, { signal });
    return { action: input.action, sheetId: input.sheetId ?? input.range.sheetId };
  },
  describeAffectedResources({ input }) {
    const where = input.action === 'set' ? gridRangeLabel({ range: input.range }) : `tab ${input.sheetId}`;
    const what = input.action === 'set' ? 'replace the basic filter on' : 'remove the basic filter from';
    return resourceLines({ lines: [spreadsheetLine(input), `${what} ${where}`] });
  },
};
