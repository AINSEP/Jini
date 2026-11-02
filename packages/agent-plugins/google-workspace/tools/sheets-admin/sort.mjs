/**
 * @file Tool `sheets_sort` (`p_google_workspace__sheets_sort`): physically reorder the rows of a grid range by one
 * or more columns. Destructive: the original row order is gone and the site cannot undo a remote change.
 *
 * Exists as a named wrapper over the reviewed `sortRange` request, sent through the batch path.
 */
import { resourceLines, runBatchUpdate, sheetsClientFor, spreadsheetLine } from '../../lib/sheets-client.mjs';
import { gridRangeLabel } from '../../lib/sheets-a1.mjs';

export default {
  async invoke({ input, capabilities, signal }) {
    await runBatchUpdate({ client: sheetsClientFor({ capabilities }), connectionRef: input.connectionRef, spreadsheetId: input.spreadsheetId, requests: [{ sortRange: { range: input.range, sortSpecs: input.sortSpecs } }] }, { signal });
    return { sorted: input.range, sortSpecs: input.sortSpecs };
  },
  describeAffectedResources({ input }) {
    return resourceLines({ lines: [spreadsheetLine(input), `reorder rows of ${gridRangeLabel({ range: input.range })} (the old order is not kept)`] });
  },
};
