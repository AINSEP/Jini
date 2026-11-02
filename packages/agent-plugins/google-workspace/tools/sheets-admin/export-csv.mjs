/**
 * @file Tool `sheets_export_csv` (`p_google_workspace__sheets_export_csv`): one tab (or an A1 range of it) as a CSV
 * file the person can download. Read only on Google's side; the file is written through the host's
 * artifact capability and only its reference, size and dimensions come back to chat.
 *
 * Exists because chat output is bounded (64 KiB) while a tab is not: the export reads the tab in
 * bounded chunks, encodes CSV locally, and refuses — never truncates — anything over its bounds.
 * A host without an artifact store passes no `artifacts` capability; the export refuses before any
 * Google read then, so nothing is fetched for a file that could never be saved.
 */
import { getSpreadsheet, sheetsClientFor, sheetsUrl, tabsOf } from '../../lib/sheets-client.mjs';
import { encodeCsv, planChunks } from '../../lib/sheets-admin-csv.mjs';
import { parseBoundsA1 } from '../../lib/sheets-a1.mjs';
import { GoogleWorkspaceError } from '../../lib/request-policy.mjs';

/** The tab's title and grid size. @complexity O(t) tabs. */
async function readTab(client, input, signal) {
  const body = await getSpreadsheet({ client, connectionRef: input.connectionRef, spreadsheetId: input.spreadsheetId, fields: 'sheets(properties(sheetId,title,gridProperties(rowCount,columnCount)))' }, { signal });
  const properties = tabsOf({ body, sheetId: input.sheetId })[0]?.properties;
  if (typeof properties?.title !== 'string') throw new GoogleWorkspaceError({ code: 'invalid-input' }, { detail: `no tab with sheetId ${input.sheetId}` });
  return properties;
}

/** The area to export: the given range, or the tab's whole grid. @complexity O(1). */
function areaOf(input, properties) {
  if (input.range !== undefined) return parseBoundsA1({ range: input.range });
  const grid = properties.gridProperties ?? {};
  return { firstRow: 0, lastRow: Math.max(0, (grid.rowCount ?? 1) - 1), firstColumn: 0, lastColumn: Math.max(0, (grid.columnCount ?? 1) - 1) };
}

/** Every chunk's rows, each padded to its row count so later chunks keep their place. @complexity O(cells). */
async function readRows(client, input, chunks, signal) {
  const rows = [];
  for (const chunk of chunks) {
    const body = await client.request({
      connectionRef: input.connectionRef, url: sheetsUrl({ spreadsheetId: input.spreadsheetId }, { segments: ['values'], method: ':batchGet' }), kind: 'read',
      query: { ranges: chunk.range, majorDimension: 'ROWS', valueRenderOption: input.valueRenderOption ?? 'FORMATTED_VALUE' },
    }, signal ? { signal } : {});
    rows.push(...paddedRows(body, chunk.rowCount));
  }
  return rows;
}

/** One chunk's rows; Google drops trailing empty rows, so they are put back as empty rows. @complexity O(rows). */
function paddedRows(body, rowCount) {
  const values = Array.isArray(body?.valueRanges?.[0]?.values) ? body.valueRanges[0].values : [];
  return Array.from({ length: rowCount }, (_, index) => (Array.isArray(values[index]) ? values[index] : []));
}

/** A file name from the tab title: letters, digits, space, dot, dash and underscore only. @complexity O(title). */
function fileNameFor(title) {
  const safe = title.replace(/[^\p{L}\p{N} ._-]+/gu, '_').trim().slice(0, 80);
  return `${safe === '' ? 'sheet' : safe}.csv`;
}

export default {
  async invoke({ input, capabilities, signal }) {
    if (!capabilities.artifacts) throw new GoogleWorkspaceError({ code: 'export-unavailable' });
    const client = sheetsClientFor({ capabilities });
    const properties = await readTab(client, input, signal);
    const chunks = planChunks({ title: properties.title, area: areaOf(input, properties) });
    const { csv, rows, columns, bytes } = encodeCsv({ rows: await readRows(client, input, chunks, signal) });
    const fileName = fileNameFor(properties.title);
    const { artifactRef } = await capabilities.artifacts.write({ name: fileName, mediaType: 'text/csv', content: csv });
    return { artifactRef, fileName, rows, columns, bytes };
  },
};
