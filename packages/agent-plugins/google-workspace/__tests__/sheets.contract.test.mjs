/**
 * @file Contract suite for the 26 Sheets tools (`sheets_*`, PLAN-google-workspace-codex.md §D): for
 * each tool the exact HTTP method, host, path, query (encoding included), JSON body and the result
 * shape chat receives, plus the approval class per tool, the RAW default, request headers, the
 * mapping of Google failures to safe codes, and the §D bounds. Every call goes through the real Jini
 * tool projection (schema validation, capability session, result gate) against the local fake of
 * Google; `fake.fetch` throws for every non-Google host, so nothing can reach the network.
 *
 * The security suites pin the refusals (secrets, path safety, uncertain writes); this file pins
 * what a correct call sends and returns, so a change to any request shape fails here first.
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { after, before, beforeEach, test } from 'node:test';

import { createAgentPluginToolProjection, createIssuedTokenMemories, parseAgentPluginToolsFile } from '@jini-ai/agent-plugins/lifecycle/tools';
import { createPluginContributionRegistry, pluginToolIdFor } from '@jini-ai/plugins/host';

import { startFakeGoogle } from './fake-google-http.mjs';

const PLUGIN = 'google-workspace';
const PLUGIN_ROOT = new URL('../', import.meta.url);
const SHEET = 'sheet-one-0001';
const BASE = `/v4/spreadsheets/${SHEET}`;
const SHEETS_HOST = 'sheets.googleapis.com';
const DRIVE_HOST = 'www.googleapis.com';
// Minted at runtime; not secret-shaped.
const TOKEN = `fake-access-${'c'.repeat(24)}`;
const CALL_ENDED_MESSAGE = 'This plugin call already finished or was stopped; capabilities kept from it no longer work. Use the capabilities of the current call.';

/** The default metadata mask and the grid-data mask, pinned literally so a silent widening fails. */
const DEFAULT_FIELDS = 'spreadsheetId,spreadsheetUrl,properties(title,locale,timeZone),sheets(properties(sheetId,title,index,sheetType,gridProperties(rowCount,columnCount,frozenRowCount,frozenColumnCount)))';
const GRID_FIELDS = 'spreadsheetId,spreadsheetUrl,properties(title,locale,timeZone),sheets(properties(sheetId,title,index,sheetType,gridProperties(rowCount,columnCount,frozenRowCount,frozenColumnCount)),data(startRow,startColumn,rowData(values(formattedValue))))';

/** Every Sheets tool's reviewed approval class (write → confirm; destructive → confirm + danger). */
const EFFECTS = {
  sheets_get: 'read', sheets_get_by_data_filter: 'read', sheets_values_get: 'read', sheets_values_batch_get: 'read', sheets_find: 'read',
  sheets_protected_ranges_get: 'read', sheets_developer_metadata: 'read', sheets_export_csv: 'read', sheets_open_existing: 'read',
  sheets_create: 'write', sheets_copy: 'write', sheets_copy_tab: 'write', sheets_values_append: 'write', sheets_basic_filter: 'write', sheets_format: 'write',
  sheets_values_update: 'destructive', sheets_values_batch_update: 'destructive', sheets_values_clear: 'destructive', sheets_values_batch_clear: 'destructive',
  sheets_values_by_data_filter: 'destructive', sheets_find_replace: 'destructive', sheets_tab_modify: 'destructive', sheets_sort: 'destructive',
  sheets_filter_views: 'destructive', sheets_named_ranges: 'destructive', sheets_batch_update: 'destructive',
};

let fake;
let registry;
let projection;
let descriptors;
/** Artifact writes the export made in the current test. */
let artifactWrites;

async function loadPluginTools() {
  const parsed = parseAgentPluginToolsFile({ raw: await readFile(new URL('tovu-agent-tools.json', PLUGIN_ROOT), 'utf8') });
  assert.equal(parsed.ok, true);
  return Promise.all(parsed.descriptors.map(async (descriptor) => ({ pluginId: PLUGIN, descriptor, module: (await import(new URL(descriptor.module, PLUGIN_ROOT))).default })));
}

before(async () => {
  fake = await startFakeGoogle({ clients: {} });
  const loaded = await loadPluginTools();
  descriptors = loaded.map((tool) => tool.descriptor);
  registry = createPluginContributionRegistry({});
  projection = createAgentPluginToolProjection({
    registry, toolIdFor: pluginToolIdFor, issuedTokens: createIssuedTokenMemories(),
    capabilities: () => ({
      connections: { getAccessToken: async () => TOKEN },
      http: { fetch: (target, init) => fake.fetch(target, init) },
      limiter: { check: async () => ({ allowed: true }) },
      artifacts: { write: async (file) => { artifactWrites.push(file); return { artifactRef: `artifact-${artifactWrites.length}` }; } },
      state: { get: async ({ key }) => (key === 'products' ? { sheets: true } : null) },
    }),
  });
  assert.deepEqual(projection.sync({ loaded, refusals: [] }).refusals, []);
});
after(async () => { await fake.close(); });
beforeEach(() => { fake.reset(); artifactWrites = []; });

function callTool(name, input, optional = {}) {
  const tool = registry.list({}).find((snapshot) => snapshot.pluginId === PLUGIN).tools.find((entry) => entry.name === name);
  return tool.handler({ pluginId: PLUGIN, auth: { workspaceId: 'ws-1', principalId: 'admin-1' }, input: { connectionRef: 'conn-1', ...input }, ...optional });
}
const disclose = async (name, input) => (await projection.describeAffectedResources({ toolId: pluginToolIdFor({ pluginId: PLUGIN, name }), input: { connectionRef: 'conn-1', ...input } })).resources;

/** Each request the fake received as `{ method, host, path, query, body }` (query: key → every value). */
function sent() {
  return fake.requests.map(({ method, host, path, query, body }) => ({
    method, host, path,
    query: Object.fromEntries([...new Set(query.keys())].map((key) => [key, query.getAll(key)])),
    body: body === '' ? undefined : JSON.parse(body),
  }));
}
const serve = (method, path, answer, status = 200, headers = {}) => fake.route({ method, path }, () => [status, answer, headers]);
const batchUpdate = (requests) => ({ method: 'POST', host: SHEETS_HOST, path: `${BASE}:batchUpdate`, query: {}, body: { requests } });
const rows = (count, width, cell = (row, column) => `r${row}c${column}`) => Array.from({ length: count }, (_, row) => Array.from({ length: width }, (_, column) => cell(row, column)));

// ---------------------------------------------------------------------------------------------
// Inventory and approval class
// ---------------------------------------------------------------------------------------------

test('inventory: the plugin declares exactly 26 Sheets tools, each with its reviewed approval class', () => {
  const declared = Object.fromEntries(descriptors.filter((descriptor) => descriptor.name.startsWith('sheets_')).map((descriptor) => [descriptor.name, descriptor.effect]));
  assert.equal(Object.keys(declared).length, 26);
  assert.deepEqual(declared, EFFECTS);
});

test('inventory: every write and destructive Sheets tool exports a disclosure, and every Sheets tool lives under tools/sheets or tools/sheets-admin', () => {
  for (const descriptor of descriptors.filter((entry) => entry.name.startsWith('sheets_'))) {
    assert.match(descriptor.module, /^tools\/sheets(-admin)?\/[a-z-]+\.mjs$/, descriptor.name);
  }
});

// ---------------------------------------------------------------------------------------------
// Headers
// ---------------------------------------------------------------------------------------------

test('headers: a read sends the bearer token and accept: application/json, and no content-type without a body', async () => {
  serve('GET', BASE, { spreadsheetId: SHEET });
  await callTool('sheets_get', { spreadsheetId: SHEET });
  const [request] = fake.requests;
  assert.equal(request.headers.authorization, `Bearer ${TOKEN}`);
  assert.equal(request.headers.accept, 'application/json');
  assert.equal(request.headers['content-type'], undefined);
});

test('headers: a write with a body adds content-type: application/json', async () => {
  serve('POST', `${BASE}/values:batchClear`, { clearedRanges: [] });
  await callTool('sheets_values_batch_clear', { spreadsheetId: SHEET, ranges: ['Leads!A2:B9'] });
  const [request] = fake.requests;
  assert.equal(request.headers['content-type'], 'application/json');
  assert.equal(request.headers.authorization, `Bearer ${TOKEN}`);
});

// ---------------------------------------------------------------------------------------------
// Request contracts, one per tool and shape
// ---------------------------------------------------------------------------------------------

/**
 * `[title, tool, input, routes, expected requests, expected result]`; routes are
 * `[method, path, answer]`. The expected result is compared with deepEqual after a JSON round trip,
 * because chat receives the result as JSON (absent fields drop out).
 */
const CONTRACTS = [
  ['sheets_get sends the default metadata mask and includeGridData=false and returns Google\'s answer', 'sheets_get',
    { spreadsheetId: SHEET }, [['GET', BASE, { spreadsheetId: SHEET, properties: { title: 'Leads' } }]],
    [{ method: 'GET', host: SHEETS_HOST, path: BASE, query: { fields: [DEFAULT_FIELDS], includeGridData: ['false'] }, body: undefined }],
    { spreadsheetId: SHEET, properties: { title: 'Leads' } }],
  ['sheets_get with includeGridData and ranges asks for cell values of exactly those ranges', 'sheets_get',
    { spreadsheetId: SHEET, includeGridData: true, ranges: ['Leads!A1:B2', "'R&D'!A1"] }, [['GET', BASE, { spreadsheetId: SHEET }]],
    [{ method: 'GET', host: SHEETS_HOST, path: BASE, query: { fields: [GRID_FIELDS], includeGridData: ['true'], ranges: ['Leads!A1:B2', "'R&D'!A1"] }, body: undefined }],
    { spreadsheetId: SHEET }],
  ['sheets_get_by_data_filter POSTs the filters with the default mask and includeGridData=false', 'sheets_get_by_data_filter',
    { spreadsheetId: SHEET, dataFilters: [{ a1Range: 'Leads!A1:B2' }] }, [['POST', `${BASE}:getByDataFilter`, { spreadsheetId: SHEET }]],
    [{ method: 'POST', host: SHEETS_HOST, path: `${BASE}:getByDataFilter`, query: { fields: [DEFAULT_FIELDS] }, body: { dataFilters: [{ a1Range: 'Leads!A1:B2' }], includeGridData: false } }],
    { spreadsheetId: SHEET }],
  ['sheets_get_by_data_filter with includeGridData asks for the grid mask', 'sheets_get_by_data_filter',
    { spreadsheetId: SHEET, dataFilters: [{ gridRange: { sheetId: 3 } }], includeGridData: true }, [['POST', `${BASE}:getByDataFilter`, { spreadsheetId: SHEET }]],
    [{ method: 'POST', host: SHEETS_HOST, path: `${BASE}:getByDataFilter`, query: { fields: [GRID_FIELDS] }, body: { dataFilters: [{ gridRange: { sheetId: 3 } }], includeGridData: true } }],
    { spreadsheetId: SHEET }],
  ['sheets_create sends title, locale and time zone (no tabs when none are given) and returns ids, URL and tabs', 'sheets_create',
    { title: 'Q3', locale: 'en_GB', timeZone: 'Europe/London' }, [['POST', '/v4/spreadsheets', { spreadsheetId: SHEET, spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/sheet-one-0001/edit', properties: { title: 'Q3' } }]],
    [{ method: 'POST', host: SHEETS_HOST, path: '/v4/spreadsheets', query: { fields: ['spreadsheetId,spreadsheetUrl,properties(title),sheets(properties(sheetId,title,index))'] }, body: { properties: { title: 'Q3', locale: 'en_GB', timeZone: 'Europe/London' } } }],
    { spreadsheetId: SHEET, url: 'https://docs.google.com/spreadsheets/d/sheet-one-0001/edit', title: 'Q3', tabs: [] }],
  ['sheets_copy copies through Drive files.copy into the named folder and returns the copy\'s id, title and link', 'sheets_copy',
    { spreadsheetId: SHEET, title: 'Copy', parentFolderId: 'folder_1' },
    [['POST', `/drive/v3/files/${SHEET}/copy`, { id: 'sheet-copy-0002', name: 'Copy', mimeType: 'application/vnd.google-apps.spreadsheet', webViewLink: 'https://docs.google.com/spreadsheets/d/sheet-copy-0002/edit' }]],
    [{ method: 'POST', host: DRIVE_HOST, path: `/drive/v3/files/${SHEET}/copy`, query: { fields: ['id,name,mimeType,webViewLink'], supportsAllDrives: ['true'] }, body: { name: 'Copy', parents: ['folder_1'] } }],
    { spreadsheetId: 'sheet-copy-0002', title: 'Copy', url: 'https://docs.google.com/spreadsheets/d/sheet-copy-0002/edit' }],
  ['sheets_copy without a folder sends no parents', 'sheets_copy',
    { spreadsheetId: SHEET, title: 'Copy' }, [['POST', `/drive/v3/files/${SHEET}/copy`, { id: 'sheet-copy-0002', name: 'Copy' }]],
    [{ method: 'POST', host: DRIVE_HOST, path: `/drive/v3/files/${SHEET}/copy`, query: { fields: ['id,name,mimeType,webViewLink'], supportsAllDrives: ['true'] }, body: { name: 'Copy' } }],
    { spreadsheetId: 'sheet-copy-0002', title: 'Copy' }],
  ['sheets_copy_tab POSTs copyTo on the numeric tab and returns the new tab', 'sheets_copy_tab',
    { spreadsheetId: SHEET, sheetId: 7, destinationSpreadsheetId: 'sheet-two-0002' }, [['POST', `${BASE}/sheets/7:copyTo`, { sheetId: 12, title: 'Copy of Leads', index: 3, sheetType: 'GRID' }]],
    [{ method: 'POST', host: SHEETS_HOST, path: `${BASE}/sheets/7:copyTo`, query: {}, body: { destinationSpreadsheetId: 'sheet-two-0002' } }],
    { destinationSpreadsheetId: 'sheet-two-0002', sheetId: 12, title: 'Copy of Leads', index: 3 }],
  ['sheets_values_get reads rows-major with the caller\'s render options, the range one encoded path segment', 'sheets_values_get',
    { spreadsheetId: SHEET, range: 'Leads!A1:B2', valueRenderOption: 'FORMULA', dateTimeRenderOption: 'SERIAL_NUMBER' }, [['GET', `${BASE}/values/Leads!A1%3AB2`, { range: 'Leads!A1:B2', majorDimension: 'ROWS', values: [['=1+1', 3]] }]],
    [{ method: 'GET', host: SHEETS_HOST, path: `${BASE}/values/Leads!A1%3AB2`, query: { majorDimension: ['ROWS'], valueRenderOption: ['FORMULA'], dateTimeRenderOption: ['SERIAL_NUMBER'] }, body: undefined }],
    { range: 'Leads!A1:B2', values: [['=1+1', 3]] }],
  ['sheets_values_get of an empty range returns the asked range with no values', 'sheets_values_get',
    { spreadsheetId: SHEET, range: "'My Tab'!A1:B2" }, [['GET', `${BASE}/values/'My%20Tab'!A1%3AB2`, {}]],
    [{ method: 'GET', host: SHEETS_HOST, path: `${BASE}/values/'My%20Tab'!A1%3AB2`, query: { majorDimension: ['ROWS'] }, body: undefined }],
    { range: "'My Tab'!A1:B2", values: [] }],
  ['sheets_values_batch_get repeats ranges= per range and returns every value range (an empty one with no values)', 'sheets_values_batch_get',
    { spreadsheetId: SHEET, ranges: ['Leads!A1:A1', 'B!A1:A1'], valueRenderOption: 'UNFORMATTED_VALUE' }, [['GET', `${BASE}/values:batchGet`, { valueRanges: [{ range: 'Leads!A1:A1', values: [[1]] }, { range: 'B!A1:A1' }] }]],
    [{ method: 'GET', host: SHEETS_HOST, path: `${BASE}/values:batchGet`, query: { ranges: ['Leads!A1:A1', 'B!A1:A1'], majorDimension: ['ROWS'], valueRenderOption: ['UNFORMATTED_VALUE'] }, body: undefined }],
    { valueRanges: [{ range: 'Leads!A1:A1', values: [[1]] }, { range: 'B!A1:A1', values: [] }] }],
  ['sheets_values_batch_get of an answer with no value ranges returns none', 'sheets_values_batch_get',
    { spreadsheetId: SHEET, ranges: ['Leads'] }, [['GET', `${BASE}/values:batchGet`, {}]],
    [{ method: 'GET', host: SHEETS_HOST, path: `${BASE}/values:batchGet`, query: { ranges: ['Leads'], majorDimension: ['ROWS'] }, body: undefined }],
    { valueRanges: [] }],
  ['sheets_values_append passes an explicit USER_ENTERED and OVERWRITE through, and reports what Google updated', 'sheets_values_append',
    { spreadsheetId: SHEET, range: 'Leads', values: [['=SUM(1,2)']], valueInputOption: 'USER_ENTERED', insertDataOption: 'OVERWRITE' }, [['POST', `${BASE}/values/Leads:append`, { tableRange: 'Leads!A1:A4' }]],
    [{ method: 'POST', host: SHEETS_HOST, path: `${BASE}/values/Leads:append`, query: { valueInputOption: ['USER_ENTERED'], insertDataOption: ['OVERWRITE'] }, body: { range: 'Leads', majorDimension: 'ROWS', values: [['=SUM(1,2)']] } }],
    { tableRange: 'Leads!A1:A4' }],
  ['sheets_values_update PUTs RAW values and returns the update counts', 'sheets_values_update',
    { spreadsheetId: SHEET, range: 'Leads!A1:B1', values: [['a', 1]] }, [['PUT', `${BASE}/values/Leads!A1%3AB1`, { updatedRange: 'Leads!A1:B1', updatedRows: 1, updatedColumns: 2, updatedCells: 2, spreadsheetId: SHEET }]],
    [{ method: 'PUT', host: SHEETS_HOST, path: `${BASE}/values/Leads!A1%3AB1`, query: { valueInputOption: ['RAW'] }, body: { range: 'Leads!A1:B1', majorDimension: 'ROWS', values: [['a', 1]] } }],
    { updatedRange: 'Leads!A1:B1', updatedRows: 1, updatedColumns: 2, updatedCells: 2 }],
  ['sheets_values_batch_update POSTs RAW rows-major data without values in the response, and keeps two fields per response', 'sheets_values_batch_update',
    { spreadsheetId: SHEET, data: [{ range: 'Leads!A1:B1', values: [['a', 'b']] }] },
    [['POST', `${BASE}/values:batchUpdate`, { totalUpdatedRows: 1, totalUpdatedCells: 2, totalUpdatedSheets: 1, responses: [{ updatedRange: 'Leads!A1:B1', updatedCells: 2, spreadsheetId: SHEET, updatedData: { values: [['a', 'b']] } }] }]],
    [{ method: 'POST', host: SHEETS_HOST, path: `${BASE}/values:batchUpdate`, query: {}, body: { valueInputOption: 'RAW', data: [{ range: 'Leads!A1:B1', majorDimension: 'ROWS', values: [['a', 'b']] }], includeValuesInResponse: false } }],
    { totalUpdatedRows: 1, totalUpdatedCells: 2, totalUpdatedSheets: 1, responses: [{ updatedRange: 'Leads!A1:B1', updatedCells: 2 }] }],
  ['sheets_values_batch_update with an answer without responses returns an empty list', 'sheets_values_batch_update',
    { spreadsheetId: SHEET, data: [{ range: 'Leads!A1', values: [['a']] }] }, [['POST', `${BASE}/values:batchUpdate`, {}]],
    [{ method: 'POST', host: SHEETS_HOST, path: `${BASE}/values:batchUpdate`, query: {}, body: { valueInputOption: 'RAW', data: [{ range: 'Leads!A1', majorDimension: 'ROWS', values: [['a']] }], includeValuesInResponse: false } }],
    { responses: [] }],
  ['sheets_values_clear POSTs :clear on the range with an empty body', 'sheets_values_clear',
    { spreadsheetId: SHEET, range: 'Leads!A2:B9' }, [['POST', `${BASE}/values/Leads!A2%3AB9:clear`, { clearedRange: 'Leads!A2:B9' }]],
    [{ method: 'POST', host: SHEETS_HOST, path: `${BASE}/values/Leads!A2%3AB9:clear`, query: {}, body: {} }],
    { clearedRange: 'Leads!A2:B9' }],
  ['sheets_values_batch_clear POSTs the ranges and returns what Google cleared', 'sheets_values_batch_clear',
    { spreadsheetId: SHEET, ranges: ['Leads!A2:B9', 'B!C1'] }, [['POST', `${BASE}/values:batchClear`, { clearedRanges: ['Leads!A2:B9', 'B!C1'] }]],
    [{ method: 'POST', host: SHEETS_HOST, path: `${BASE}/values:batchClear`, query: {}, body: { ranges: ['Leads!A2:B9', 'B!C1'] } }],
    { clearedRanges: ['Leads!A2:B9', 'B!C1'] }],
  ['sheets_values_batch_clear with an answer naming no ranges returns an empty list', 'sheets_values_batch_clear',
    { spreadsheetId: SHEET, ranges: ['Leads!A2:B9'] }, [['POST', `${BASE}/values:batchClear`, {}]],
    [{ method: 'POST', host: SHEETS_HOST, path: `${BASE}/values:batchClear`, query: {}, body: { ranges: ['Leads!A2:B9'] } }],
    { clearedRanges: [] }],
  ['sheets_values_by_data_filter get POSTs batchGetByDataFilter rows-major and unwraps each matched value range', 'sheets_values_by_data_filter',
    { spreadsheetId: SHEET, action: 'get', dataFilters: [{ a1Range: 'Leads!A1:A1' }], valueRenderOption: 'FORMULA' },
    [['POST', `${BASE}/values:batchGetByDataFilter`, { valueRanges: [{ valueRange: { range: 'Leads!A1:A1', values: [['x']] }, dataFilters: [] }, { dataFilters: [] }] }]],
    [{ method: 'POST', host: SHEETS_HOST, path: `${BASE}/values:batchGetByDataFilter`, query: {}, body: { dataFilters: [{ a1Range: 'Leads!A1:A1' }], majorDimension: 'ROWS', valueRenderOption: 'FORMULA' } }],
    { valueRanges: [{ range: 'Leads!A1:A1', values: [['x']] }, { range: '', values: [] }] }],
  ['sheets_values_by_data_filter get with an answer naming no value ranges returns none', 'sheets_values_by_data_filter',
    { spreadsheetId: SHEET, action: 'get', dataFilters: [{ a1Range: 'Leads!A1:A1' }] }, [['POST', `${BASE}/values:batchGetByDataFilter`, {}]],
    [{ method: 'POST', host: SHEETS_HOST, path: `${BASE}/values:batchGetByDataFilter`, query: {}, body: { dataFilters: [{ a1Range: 'Leads!A1:A1' }], majorDimension: 'ROWS' } }],
    { valueRanges: [] }],
  ['sheets_values_by_data_filter update POSTs RAW rows-major data per filter and returns the totals', 'sheets_values_by_data_filter',
    { spreadsheetId: SHEET, action: 'update', data: [{ dataFilter: { gridRange: { sheetId: 3 } }, values: [['v']] }] },
    [['POST', `${BASE}/values:batchUpdateByDataFilter`, { totalUpdatedRows: 1, totalUpdatedCells: 1, totalUpdatedSheets: 1, responses: [{}] }]],
    [{ method: 'POST', host: SHEETS_HOST, path: `${BASE}/values:batchUpdateByDataFilter`, query: {}, body: { valueInputOption: 'RAW', includeValuesInResponse: false, data: [{ dataFilter: { gridRange: { sheetId: 3 } }, majorDimension: 'ROWS', values: [['v']] }] } }],
    { totalUpdatedRows: 1, totalUpdatedCells: 1, totalUpdatedSheets: 1 }],
  ['sheets_values_by_data_filter clear POSTs batchClearByDataFilter with the filters and returns the cleared ranges', 'sheets_values_by_data_filter',
    { spreadsheetId: SHEET, action: 'clear', dataFilters: [{ developerMetadataLookup: { metadataKey: 'leads' } }] },
    [['POST', `${BASE}/values:batchClearByDataFilter`, { clearedRanges: ['Leads!A1:A9'] }]],
    [{ method: 'POST', host: SHEETS_HOST, path: `${BASE}/values:batchClearByDataFilter`, query: {}, body: { dataFilters: [{ developerMetadataLookup: { metadataKey: 'leads' } }] } }],
    { clearedRanges: ['Leads!A1:A9'] }],
  ['sheets_values_by_data_filter clear with an answer naming no ranges returns an empty list', 'sheets_values_by_data_filter',
    { spreadsheetId: SHEET, action: 'clear', dataFilters: [{ a1Range: 'Leads!A1:A9' }] }, [['POST', `${BASE}/values:batchClearByDataFilter`, {}]],
    [{ method: 'POST', host: SHEETS_HOST, path: `${BASE}/values:batchClearByDataFilter`, query: {}, body: { dataFilters: [{ a1Range: 'Leads!A1:A9' }] } }],
    { clearedRanges: [] }],
  ['sheets_find reads the ranges rows-major and returns each case-insensitive substring match with its A1 cell', 'sheets_find',
    { spreadsheetId: SHEET, ranges: ["'My Tab'!B3:D4"], text: 'acme', valueRenderOption: 'FORMATTED_VALUE' },
    [['GET', `${BASE}/values:batchGet`, { valueRanges: [{ range: "'My Tab'!B3:D4", values: [['Acme Ltd', 'x'], [42, 'ACME']] }] }]],
    [{ method: 'GET', host: SHEETS_HOST, path: `${BASE}/values:batchGet`, query: { ranges: ["'My Tab'!B3:D4"], majorDimension: ['ROWS'], valueRenderOption: ['FORMATTED_VALUE'] }, body: undefined }],
    { matches: [{ cell: "'My Tab'!B3", excerpt: 'Acme Ltd' }, { cell: "'My Tab'!C4", excerpt: 'ACME' }], truncated: false, scannedCells: 4 }],
  ['sheets_find_replace sends one findReplace with every match option explicit, on all tabs, and returns every count (absent = 0)', 'sheets_find_replace',
    { spreadsheetId: SHEET, find: 'a', replacement: 'b', allSheets: true, matchCase: true, searchByRegex: true },
    [['POST', `${BASE}:batchUpdate`, { replies: [{ findReplace: { occurrencesChanged: 3, valuesChanged: 2, sheetsChanged: 1 } }] }]],
    [{ method: 'POST', host: SHEETS_HOST, path: `${BASE}:batchUpdate`, query: {}, body: { requests: [{ findReplace: { find: 'a', replacement: 'b', matchCase: true, matchEntireCell: false, searchByRegex: true, includeFormulas: false, allSheets: true } }], includeSpreadsheetInResponse: false } }],
    { occurrencesChanged: 3, valuesChanged: 2, formulasChanged: 0, rowsChanged: 0, sheetsChanged: 1 }],
  ['sheets_find_replace with an empty reply reports zero for every count', 'sheets_find_replace',
    { spreadsheetId: SHEET, find: 'a', replacement: '', sheetId: 2 }, [['POST', `${BASE}:batchUpdate`, {}]],
    [{ method: 'POST', host: SHEETS_HOST, path: `${BASE}:batchUpdate`, query: {}, body: { requests: [{ findReplace: { find: 'a', replacement: '', matchCase: false, matchEntireCell: false, searchByRegex: false, includeFormulas: false, sheetId: 2 } }], includeSpreadsheetInResponse: false } }],
    { occurrencesChanged: 0, valuesChanged: 0, formulasChanged: 0, rowsChanged: 0, sheetsChanged: 0 }],
  ['sheets_tab_modify add sends addSheet with the index and returns Google\'s new tab', 'sheets_tab_modify',
    { spreadsheetId: SHEET, action: 'add', title: 'New', index: 2 }, [['POST', `${BASE}:batchUpdate`, { replies: [{ addSheet: { properties: { sheetId: 99, title: 'New', index: 2, sheetType: 'GRID' } } }] }]],
    [batchUpdate([{ addSheet: { properties: { title: 'New', index: 2 } } }])],
    { action: 'add', tab: { sheetId: 99, title: 'New', index: 2 } }],
  ['sheets_tab_modify add without an index sends only the title', 'sheets_tab_modify',
    { spreadsheetId: SHEET, action: 'add', title: 'New' }, [['POST', `${BASE}:batchUpdate`, { replies: [{ addSheet: { properties: { sheetId: 99, title: 'New', index: 5 } } }] }]],
    [batchUpdate([{ addSheet: { properties: { title: 'New' } } }])],
    { action: 'add', tab: { sheetId: 99, title: 'New', index: 5 } }],
  ['sheets_tab_modify rename updates only the title and returns the requested tab', 'sheets_tab_modify',
    { spreadsheetId: SHEET, action: 'rename', sheetId: 4, title: 'Renamed' }, [['POST', `${BASE}:batchUpdate`, { replies: [{}] }]],
    [batchUpdate([{ updateSheetProperties: { properties: { sheetId: 4, title: 'Renamed' }, fields: 'title' } }])],
    { action: 'rename', tab: { sheetId: 4, title: 'Renamed' } }],
  ['sheets_tab_modify delete sends deleteSheet (a reply that is not a list counts as no replies)', 'sheets_tab_modify',
    { spreadsheetId: SHEET, action: 'delete', sheetId: 4 }, [['POST', `${BASE}:batchUpdate`, { replies: 'none' }]],
    [batchUpdate([{ deleteSheet: { sheetId: 4 } }])],
    { action: 'delete', tab: { sheetId: 4 } }],
  ['sheets_tab_modify duplicate sends the new name and index and returns Google\'s copy', 'sheets_tab_modify',
    { spreadsheetId: SHEET, action: 'duplicate', sheetId: 4, title: 'Dup', index: 1 }, [['POST', `${BASE}:batchUpdate`, { replies: [{ duplicateSheet: { properties: { sheetId: 41, title: 'Dup', index: 1 } } }] }]],
    [batchUpdate([{ duplicateSheet: { sourceSheetId: 4, newSheetName: 'Dup', insertSheetIndex: 1 } }])],
    { action: 'duplicate', tab: { sheetId: 41, title: 'Dup', index: 1 } }],
  ['sheets_tab_modify duplicate without a name or index sends only the source tab', 'sheets_tab_modify',
    { spreadsheetId: SHEET, action: 'duplicate', sheetId: 4 }, [['POST', `${BASE}:batchUpdate`, { replies: [{ duplicateSheet: { properties: { sheetId: 42, title: 'Copy of Leads', index: 5 } } }] }]],
    [batchUpdate([{ duplicateSheet: { sourceSheetId: 4 } }])],
    { action: 'duplicate', tab: { sheetId: 42, title: 'Copy of Leads', index: 5 } }],
  ['sheets_tab_modify move updates only the index', 'sheets_tab_modify',
    { spreadsheetId: SHEET, action: 'move', sheetId: 4, index: 0 }, [['POST', `${BASE}:batchUpdate`, { replies: [{}] }]],
    [batchUpdate([{ updateSheetProperties: { properties: { sheetId: 4, index: 0 }, fields: 'index' } }])],
    { action: 'move', tab: { sheetId: 4, index: 0 } }],
  ['sheets_sort sends one sortRange with the range and sort specs', 'sheets_sort',
    { spreadsheetId: SHEET, range: { sheetId: 0, startRowIndex: 1 }, sortSpecs: [{ dimensionIndex: 2, sortOrder: 'DESCENDING' }] }, [['POST', `${BASE}:batchUpdate`, { replies: [{}] }]],
    [batchUpdate([{ sortRange: { range: { sheetId: 0, startRowIndex: 1 }, sortSpecs: [{ dimensionIndex: 2, sortOrder: 'DESCENDING' }] } }])],
    { sorted: { sheetId: 0, startRowIndex: 1 }, sortSpecs: [{ dimensionIndex: 2, sortOrder: 'DESCENDING' }] }],
  ['sheets_get with the basic-filter mask reads tab filters (the read the write-only sheets_basic_filter points to)', 'sheets_get',
    { spreadsheetId: SHEET, fields: 'sheets(properties(sheetId),basicFilter)' }, [['GET', BASE, { sheets: [{ properties: { sheetId: 3 }, basicFilter: { range: { sheetId: 3 } } }] }]],
    [{ method: 'GET', host: SHEETS_HOST, path: BASE, query: { fields: ['sheets(properties(sheetId),basicFilter)'], includeGridData: ['false'] }, body: undefined }],
    { sheets: [{ properties: { sheetId: 3 }, basicFilter: { range: { sheetId: 3 } } }] }],
  ['sheets_basic_filter set without filter specs sends only the range and returns the range\'s tab', 'sheets_basic_filter',
    { spreadsheetId: SHEET, action: 'set', range: { sheetId: 2, endRowIndex: 10 } }, [['POST', `${BASE}:batchUpdate`, { replies: [{}] }]],
    [batchUpdate([{ setBasicFilter: { filter: { range: { sheetId: 2, endRowIndex: 10 } } } }])],
    { action: 'set', sheetId: 2 }],
  ['sheets_basic_filter clear sends clearBasicFilter for the tab', 'sheets_basic_filter',
    { spreadsheetId: SHEET, action: 'clear', sheetId: 2 }, [['POST', `${BASE}:batchUpdate`, { replies: [{}] }]],
    [batchUpdate([{ clearBasicFilter: { sheetId: 2 } }])],
    { action: 'clear', sheetId: 2 }],
  ['sheets_filter_views list reads tab ids, titles and views and returns only the named tab', 'sheets_filter_views',
    { spreadsheetId: SHEET, action: 'list', sheetId: 1 }, [['GET', BASE, { sheets: [{ properties: { sheetId: 0, title: 'A' }, filterViews: [{ filterViewId: 5 }] }, { properties: { sheetId: 1, title: 'B' } }] }]],
    [{ method: 'GET', host: SHEETS_HOST, path: BASE, query: { fields: ['sheets(properties(sheetId,title),filterViews)'] }, body: undefined }],
    { action: 'list', tabs: [{ sheetId: 1, title: 'B', filterViews: [] }] }],
  ['sheets_filter_views list without a tab returns every tab', 'sheets_filter_views',
    { spreadsheetId: SHEET, action: 'list' }, [['GET', BASE, { sheets: [{ properties: { sheetId: 0, title: 'A' }, filterViews: [{ filterViewId: 5 }] }, {}] }]],
    [{ method: 'GET', host: SHEETS_HOST, path: BASE, query: { fields: ['sheets(properties(sheetId,title),filterViews)'] }, body: undefined }],
    { action: 'list', tabs: [{ sheetId: 0, title: 'A', filterViews: [{ filterViewId: 5 }] }, { filterViews: [] }] }],
  ['sheets_filter_views add sends addFilterView and returns Google\'s new view', 'sheets_filter_views',
    { spreadsheetId: SHEET, action: 'add', filter: { title: 'Open', range: { sheetId: 0 } } }, [['POST', `${BASE}:batchUpdate`, { replies: [{ addFilterView: { filter: { filterViewId: 11, title: 'Open' } } }] }]],
    [batchUpdate([{ addFilterView: { filter: { title: 'Open', range: { sheetId: 0 } } } }])],
    { action: 'add', filterView: { filterViewId: 11, title: 'Open' } }],
  ['sheets_filter_views update sends the view id inside the filter and the joined field mask', 'sheets_filter_views',
    { spreadsheetId: SHEET, action: 'update', filterViewId: 11, filter: { title: 'X', range: { sheetId: 0 } }, fields: ['title', 'range'] }, [['POST', `${BASE}:batchUpdate`, { replies: [{}] }]],
    [batchUpdate([{ updateFilterView: { filter: { title: 'X', range: { sheetId: 0 }, filterViewId: 11 }, fields: 'title,range' } }])],
    { action: 'update', filterViewId: 11 }],
  ['sheets_filter_views duplicate sends duplicateFilterView and returns the copy', 'sheets_filter_views',
    { spreadsheetId: SHEET, action: 'duplicate', filterViewId: 11 }, [['POST', `${BASE}:batchUpdate`, { replies: [{ duplicateFilterView: { filter: { filterViewId: 12 } } }] }]],
    [batchUpdate([{ duplicateFilterView: { filterId: 11 } }])],
    { action: 'duplicate', filterView: { filterViewId: 12 } }],
  ['sheets_filter_views delete sends deleteFilterView and returns the id', 'sheets_filter_views',
    { spreadsheetId: SHEET, action: 'delete', filterViewId: 11 }, [['POST', `${BASE}:batchUpdate`, {}]],
    [batchUpdate([{ deleteFilterView: { filterId: 11 } }])],
    { action: 'delete', filterViewId: 11 }],
  ['sheets_format cell format sends one repeatCell with the mask under userEnteredFormat', 'sheets_format',
    { spreadsheetId: SHEET, range: { sheetId: 0, endRowIndex: 1 }, cellFormat: { textFormat: { bold: true } }, fields: ['textFormat.bold'] }, [['POST', `${BASE}:batchUpdate`, { replies: [{}] }]],
    [batchUpdate([{ repeatCell: { range: { sheetId: 0, endRowIndex: 1 }, cell: { userEnteredFormat: { textFormat: { bold: true } } }, fields: 'userEnteredFormat.textFormat.bold' } }])],
    { formatted: { sheetId: 0, endRowIndex: 1 }, changed: ['cell format (textFormat.bold)'] }],
  ['sheets_format borders, frozen rows and a whole-tab column width are sent in that order, only the given parts', 'sheets_format',
    { spreadsheetId: SHEET, range: { sheetId: 0 }, borders: { top: { style: 'SOLID' } }, frozenRowCount: 1, columnWidth: 120 }, [['POST', `${BASE}:batchUpdate`, { replies: [{}, {}, {}] }]],
    [batchUpdate([
      { updateBorders: { range: { sheetId: 0 }, top: { style: 'SOLID' } } },
      { updateSheetProperties: { properties: { sheetId: 0, gridProperties: { frozenRowCount: 1 } }, fields: 'gridProperties.frozenRowCount' } },
      { updateDimensionProperties: { range: { sheetId: 0, dimension: 'COLUMNS' }, properties: { pixelSize: 120 }, fields: 'pixelSize' } },
    ])],
    { formatted: { sheetId: 0 }, changed: ['borders', 'frozen rows = 1', 'column width = 120px'] }],
  ['sheets_format frozen columns and a column width over named columns send only those indices', 'sheets_format',
    { spreadsheetId: SHEET, range: { sheetId: 2, startColumnIndex: 1, endColumnIndex: 3 }, frozenColumnCount: 2, columnWidth: 80 }, [['POST', `${BASE}:batchUpdate`, { replies: [{}, {}] }]],
    [batchUpdate([
      { updateSheetProperties: { properties: { sheetId: 2, gridProperties: { frozenColumnCount: 2 } }, fields: 'gridProperties.frozenColumnCount' } },
      { updateDimensionProperties: { range: { sheetId: 2, dimension: 'COLUMNS', startIndex: 1, endIndex: 3 }, properties: { pixelSize: 80 }, fields: 'pixelSize' } },
    ])],
    { formatted: { sheetId: 2, startColumnIndex: 1, endColumnIndex: 3 }, changed: ['frozen columns = 2', 'column width = 80px'] }],
  ['sheets_format frozen rows and columns together share one request and mask', 'sheets_format',
    { spreadsheetId: SHEET, range: { sheetId: 0 }, frozenRowCount: 1, frozenColumnCount: 1 }, [['POST', `${BASE}:batchUpdate`, { replies: [{}] }]],
    [batchUpdate([{ updateSheetProperties: { properties: { sheetId: 0, gridProperties: { frozenRowCount: 1, frozenColumnCount: 1 } }, fields: 'gridProperties.frozenRowCount,gridProperties.frozenColumnCount' } }])],
    { formatted: { sheetId: 0 }, changed: ['frozen rows = 1', 'frozen columns = 1'] }],
  ['sheets_named_ranges list reads only namedRanges', 'sheets_named_ranges',
    { spreadsheetId: SHEET, action: 'list' }, [['GET', BASE, { namedRanges: [{ namedRangeId: 'nr1', name: 'Totals' }] }]],
    [{ method: 'GET', host: SHEETS_HOST, path: BASE, query: { fields: ['namedRanges'] }, body: undefined }],
    { action: 'list', namedRanges: [{ namedRangeId: 'nr1', name: 'Totals' }] }],
  ['sheets_named_ranges list of a spreadsheet without named ranges returns an empty list', 'sheets_named_ranges',
    { spreadsheetId: SHEET, action: 'list' }, [['GET', BASE, {}]],
    [{ method: 'GET', host: SHEETS_HOST, path: BASE, query: { fields: ['namedRanges'] }, body: undefined }],
    { action: 'list', namedRanges: [] }],
  ['sheets_named_ranges add sends addNamedRange and returns Google\'s named range', 'sheets_named_ranges',
    { spreadsheetId: SHEET, action: 'add', name: 'Totals', range: { sheetId: 0 } }, [['POST', `${BASE}:batchUpdate`, { replies: [{ addNamedRange: { namedRange: { namedRangeId: 'nr1', name: 'Totals' } } }] }]],
    [batchUpdate([{ addNamedRange: { namedRange: { name: 'Totals', range: { sheetId: 0 } } } }])],
    { action: 'add', namedRange: { namedRangeId: 'nr1', name: 'Totals' } }],
  ['sheets_named_ranges update of the name alone masks only name', 'sheets_named_ranges',
    { spreadsheetId: SHEET, action: 'update', namedRangeId: 'nr1', name: 'Sum' }, [['POST', `${BASE}:batchUpdate`, { replies: [{}] }]],
    [batchUpdate([{ updateNamedRange: { namedRange: { namedRangeId: 'nr1', name: 'Sum' }, fields: 'name' } }])],
    { action: 'update', namedRangeId: 'nr1' }],
  ['sheets_named_ranges update of the range alone masks only range', 'sheets_named_ranges',
    { spreadsheetId: SHEET, action: 'update', namedRangeId: 'nr1', range: { sheetId: 1 } }, [['POST', `${BASE}:batchUpdate`, { replies: [{}] }]],
    [batchUpdate([{ updateNamedRange: { namedRange: { namedRangeId: 'nr1', range: { sheetId: 1 } }, fields: 'range' } }])],
    { action: 'update', namedRangeId: 'nr1' }],
  ['sheets_named_ranges delete sends deleteNamedRange', 'sheets_named_ranges',
    { spreadsheetId: SHEET, action: 'delete', namedRangeId: 'nr1' }, [['POST', `${BASE}:batchUpdate`, { replies: [{}] }]],
    [batchUpdate([{ deleteNamedRange: { namedRangeId: 'nr1' } }])],
    { action: 'delete', namedRangeId: 'nr1' }],
  ['sheets_protected_ranges_get reads the protection fields and returns the named tab (no ranges = empty list)', 'sheets_protected_ranges_get',
    { spreadsheetId: SHEET, sheetId: 1 }, [['GET', BASE, { sheets: [{ properties: { sheetId: 0, title: 'A' }, protectedRanges: [{ protectedRangeId: 3 }] }, { properties: { sheetId: 1, title: 'B' } }] }]],
    [{ method: 'GET', host: SHEETS_HOST, path: BASE, query: { fields: ['sheets(properties(sheetId,title),protectedRanges(protectedRangeId,range,namedRangeId,tableId,description,warningOnly,requestingUserCanEdit,unprotectedRanges,editors))'] }, body: undefined }],
    { tabs: [{ sheetId: 1, title: 'B', protectedRanges: [] }] }],
  ['sheets_protected_ranges_get without a tab returns every tab', 'sheets_protected_ranges_get',
    { spreadsheetId: SHEET }, [['GET', BASE, { sheets: [{ properties: { sheetId: 0, title: 'A' }, protectedRanges: [{ protectedRangeId: 3 }] }, {}] }]],
    [{ method: 'GET', host: SHEETS_HOST, path: BASE, query: { fields: ['sheets(properties(sheetId,title),protectedRanges(protectedRangeId,range,namedRangeId,tableId,description,warningOnly,requestingUserCanEdit,unprotectedRanges,editors))'] }, body: undefined }],
    { tabs: [{ sheetId: 0, title: 'A', protectedRanges: [{ protectedRangeId: 3 }] }, { protectedRanges: [] }] }],
  ['sheets_protected_ranges_get of an answer with no tab list returns no tabs', 'sheets_protected_ranges_get',
    { spreadsheetId: SHEET }, [['GET', BASE, {}]],
    [{ method: 'GET', host: SHEETS_HOST, path: BASE, query: { fields: ['sheets(properties(sheetId,title),protectedRanges(protectedRangeId,range,namedRangeId,tableId,description,warningOnly,requestingUserCanEdit,unprotectedRanges,editors))'] }, body: undefined }],
    { tabs: [] }],
  ['sheets_developer_metadata get reads one entry by its numeric id', 'sheets_developer_metadata',
    { spreadsheetId: SHEET, action: 'get', metadataId: 5 }, [['GET', `${BASE}/developerMetadata/5`, { metadataId: 5, metadataKey: 'leads' }]],
    [{ method: 'GET', host: SHEETS_HOST, path: `${BASE}/developerMetadata/5`, query: {}, body: undefined }],
    { action: 'get', metadata: { metadataId: 5, metadataKey: 'leads' } }],
  ['sheets_developer_metadata search POSTs the data filters and returns the matches', 'sheets_developer_metadata',
    { spreadsheetId: SHEET, action: 'search', dataFilters: [{ developerMetadataLookup: { metadataKey: 'leads' } }] },
    [['POST', `${BASE}/developerMetadata:search`, { matchedDeveloperMetadata: [{ developerMetadata: { metadataId: 5 } }] }]],
    [{ method: 'POST', host: SHEETS_HOST, path: `${BASE}/developerMetadata:search`, query: {}, body: { dataFilters: [{ developerMetadataLookup: { metadataKey: 'leads' } }] } }],
    { action: 'search', matches: [{ developerMetadata: { metadataId: 5 } }] }],
  ['sheets_developer_metadata search with no matches returns an empty list', 'sheets_developer_metadata',
    { spreadsheetId: SHEET, action: 'search', dataFilters: [{ a1Range: 'Leads!A1' }] }, [['POST', `${BASE}/developerMetadata:search`, {}]],
    [{ method: 'POST', host: SHEETS_HOST, path: `${BASE}/developerMetadata:search`, query: {}, body: { dataFilters: [{ a1Range: 'Leads!A1' }] } }],
    { action: 'search', matches: [] }],
  ['sheets_batch_update sends the requests as given and summarizes them per kind with Google\'s replies', 'sheets_batch_update',
    { spreadsheetId: SHEET, requests: [{ addSheet: { properties: { title: 'X' } } }, { deleteSheet: { sheetId: 1 } }, { deleteSheet: { sheetId: 2 } }] },
    [['POST', `${BASE}:batchUpdate`, { replies: [{ addSheet: { properties: { sheetId: 9 } } }, {}, {}] }]],
    [batchUpdate([{ addSheet: { properties: { title: 'X' } } }, { deleteSheet: { sheetId: 1 } }, { deleteSheet: { sheetId: 2 } }])],
    { summary: { applied: 3, kinds: { addSheet: 1, deleteSheet: 2 } }, replies: [{ addSheet: { properties: { sheetId: 9 } } }, {}, {}] }],
  ['sheets_open_existing with a picked id verifies access through Drive and returns metadata only', 'sheets_open_existing',
    { spreadsheetId: SHEET }, [['GET', `/drive/v3/files/${SHEET}`, { id: SHEET, name: 'Leads (Drive)', mimeType: 'application/vnd.google-apps.spreadsheet' }], ['GET', BASE, { spreadsheetId: SHEET, properties: { title: 'Leads' } }]],
    [
      { method: 'GET', host: DRIVE_HOST, path: `/drive/v3/files/${SHEET}`, query: { fields: ['id,name,mimeType,trashed'], supportsAllDrives: ['true'] }, body: undefined },
      { method: 'GET', host: SHEETS_HOST, path: BASE, query: { fields: ['spreadsheetId,properties.title'] }, body: undefined },
    ],
    { status: 'selected', resource: { spreadsheetId: SHEET, title: 'Leads', url: `https://docs.google.com/spreadsheets/d/${SHEET}/edit` } }],
];

for (const [title, name, input, routes, expectedRequests, expectedResult] of CONTRACTS) {
  test(`contract: ${title}`, async () => {
    for (const [method, path, answer] of routes) serve(method, path, answer);
    const result = await callTool(name, input);
    assert.deepEqual(JSON.parse(JSON.stringify(result)), expectedResult);
    assert.deepEqual(sent(), expectedRequests);
  });
}

test('contract: sheets_open_existing without an id sends nothing and asks for the file picker', async () => {
  const result = await callTool('sheets_open_existing', {});
  assert.equal(result.status, 'waiting');
  assert.equal(result.nextAction, 'open-picker');
  assert.match(result.message, /A pasted link is not enough/);
  assert.equal(fake.requests.length, 0);
});

test('contract: sheets_export_csv reads the tab size, then the whole grid A1-quoted, pads dropped rows and saves text/csv named after the tab', async () => {
  serve('GET', BASE, { sheets: [{ properties: { sheetId: 5, title: 'Q3: Leads/2026', gridProperties: { rowCount: 3, columnCount: 2 } } }] });
  serve('GET', `${BASE}/values:batchGet`, { valueRanges: [{ range: "'Q3: Leads/2026'!A1:B3", values: [['name', 'note'], ['Ada, Lovelace']] }] });
  const result = await callTool('sheets_export_csv', { spreadsheetId: SHEET, sheetId: 5 });
  assert.deepEqual(result, { artifactRef: 'artifact-1', fileName: 'Q3_ Leads_2026.csv', rows: 2, columns: 2, bytes: 27 });
  assert.deepEqual(artifactWrites, [{ name: 'Q3_ Leads_2026.csv', mediaType: 'text/csv', content: 'name,note\r\n"Ada, Lovelace",' }]);
  assert.deepEqual(sent(), [
    { method: 'GET', host: SHEETS_HOST, path: BASE, query: { fields: ['sheets(properties(sheetId,title,gridProperties(rowCount,columnCount)))'] }, body: undefined },
    { method: 'GET', host: SHEETS_HOST, path: `${BASE}/values:batchGet`, query: { ranges: ["'Q3: Leads/2026'!A1:B3"], majorDimension: ['ROWS'], valueRenderOption: ['FORMATTED_VALUE'] }, body: undefined },
  ]);
});

test('contract: sheets_export_csv of a given range with UNFORMATTED_VALUE reads exactly that range', async () => {
  serve('GET', BASE, { sheets: [{ properties: { sheetId: 5, title: 'Leads', gridProperties: { rowCount: 900, columnCount: 26 } } }] });
  serve('GET', `${BASE}/values:batchGet`, { valueRanges: [{ range: "'Leads'!B2:C3", values: [[1, 2], [3, 4]] }] });
  const result = await callTool('sheets_export_csv', { spreadsheetId: SHEET, sheetId: 5, range: 'B2:C3', valueRenderOption: 'UNFORMATTED_VALUE' });
  assert.equal(artifactWrites[0].content, '1,2\r\n3,4');
  assert.deepEqual(result, { artifactRef: 'artifact-1', fileName: 'Leads.csv', rows: 2, columns: 2, bytes: 8 });
  assert.deepEqual(sent()[1].query, { ranges: ["'Leads'!B2:C3"], majorDimension: ['ROWS'], valueRenderOption: ['UNFORMATTED_VALUE'] });
});

test('contract: sheets_export_csv of a tab with no grid size and a blank title reads A1:A1 into sheet.csv', async () => {
  serve('GET', BASE, { sheets: [{ properties: { sheetId: 5, title: '   ' } }] });
  serve('GET', `${BASE}/values:batchGet`, { valueRanges: [{ range: "'   '!A1:A1", values: [['only']] }] });
  const result = await callTool('sheets_export_csv', { spreadsheetId: SHEET, sheetId: 5 });
  assert.equal(result.fileName, 'sheet.csv');
  assert.deepEqual(sent()[1].query.ranges, ["'   '!A1:A1"]);
});

test('contract: sheets_export_csv of an empty tab saves an empty CSV (Google answering with no value ranges)', async () => {
  serve('GET', BASE, { sheets: [{ properties: { sheetId: 5, title: 'Empty', gridProperties: { rowCount: 2, columnCount: 2 } } }] });
  serve('GET', `${BASE}/values:batchGet`, {});
  const result = await callTool('sheets_export_csv', { spreadsheetId: SHEET, sheetId: 5 });
  assert.deepEqual(result, { artifactRef: 'artifact-1', fileName: 'Empty.csv', rows: 0, columns: 0, bytes: 0 });
});

test('contract: sheets_export_csv of a tab id the spreadsheet does not have is invalid-input naming the id, before any values read', async () => {
  serve('GET', BASE, { sheets: [{ properties: { sheetId: 0, title: 'Leads' } }] });
  await assert.rejects(callTool('sheets_export_csv', { spreadsheetId: SHEET, sheetId: 9 }), { code: 'invalid-input', message: /no tab with sheetId 9/ });
  assert.equal(fake.requests.length, 1);
});

for (const range of ['D5:A1', 'A5:D1']) {
  test(`contract: sheets_export_csv with reversed corners ${range} is invalid-input before any values read`, async () => {
    serve('GET', BASE, { sheets: [{ properties: { sheetId: 0, title: 'Leads' } }] });
    await assert.rejects(callTool('sheets_export_csv', { spreadsheetId: SHEET, sheetId: 0, range }), { code: 'invalid-input', message: /top-left corner first/ });
    assert.equal(fake.requests.length, 1);
  });
}

test('contract: sheets_basic_filter has no get action (a read inside a write tool would ask for a needless confirmation)', async () => {
  await assert.rejects(callTool('sheets_basic_filter', { spreadsheetId: SHEET, action: 'get', sheetId: 3 }), { name: 'ToolInputError', message: /\/action/ });
  assert.equal(fake.requests.length, 0);
});

test('contract: sheets_copy with an answer that names no file id is unexpected-response with an unknown outcome', async () => {
  serve('POST', `/drive/v3/files/${SHEET}/copy`, { name: 'Copy' });
  await assert.rejects(callTool('sheets_copy', { spreadsheetId: SHEET, title: 'Copy' }), { code: 'unexpected-response', outcome: 'unknown' });
});

// ---------------------------------------------------------------------------------------------
// sheets_find matching
// ---------------------------------------------------------------------------------------------

const FIND_VALUES = { valueRanges: [{ range: 'Leads!A1:B2', values: [['Acme Ltd', 'acme'], ['ACME', 'other']] }] };
const findCells = async (input) => {
  serve('GET', `${BASE}/values:batchGet`, FIND_VALUES);
  return (await callTool('sheets_find', { spreadsheetId: SHEET, ranges: ['Leads'], ...input })).matches.map((match) => match.cell);
};

test('find: matchCase keeps only matches with the same case', async () => {
  assert.deepEqual(await findCells({ text: 'ACME', matchCase: true }), ['Leads!A2']);
});

test('find: matchEntireCell keeps only cells equal to the text, case-insensitively by default', async () => {
  assert.deepEqual(await findCells({ text: 'acme', matchEntireCell: true }), ['Leads!B1', 'Leads!A2']);
});

test('find: more than 100 matches returns the first 100 and truncated: true', async () => {
  serve('GET', `${BASE}/values:batchGet`, { valueRanges: [{ range: 'Leads!A1:A150', values: rows(150, 1, () => 'hit') }] });
  const result = await callTool('sheets_find', { spreadsheetId: SHEET, ranges: ['Leads'], text: 'hit' });
  assert.equal(result.matches.length, 100);
  assert.equal(result.truncated, true);
  assert.equal(result.matches[99].cell, 'Leads!A100');
});

test('find: an excerpt is at most 120 characters and a number cell is matched as text', async () => {
  serve('GET', `${BASE}/values:batchGet`, { valueRanges: [{ range: 'Leads!AA9:AB9', values: [[`42${'x'.repeat(200)}`, 42]] }] });
  const { matches } = await callTool('sheets_find', { spreadsheetId: SHEET, ranges: ['Leads'], text: '42' });
  assert.deepEqual(matches.map((match) => [match.cell, match.excerpt.length]), [['Leads!AA9', 120], ['Leads!AB9', 2]]);
});

test('find: an answer with no value ranges, or ranges without values, scans nothing', async () => {
  serve('GET', `${BASE}/values:batchGet`, { valueRanges: [{ range: 'Leads!A1:A1' }] });
  assert.deepEqual(await callTool('sheets_find', { spreadsheetId: SHEET, ranges: ['Leads'], text: 'x' }), { matches: [], truncated: false, scannedCells: 0 });
  fake.reset();
  serve('GET', `${BASE}/values:batchGet`, {});
  assert.deepEqual(await callTool('sheets_find', { spreadsheetId: SHEET, ranges: ['Leads'], text: 'x' }), { matches: [], truncated: false, scannedCells: 0 });
});

test('find: a value range Google did not answer in A1 form is unexpected-response, never a guessed cell', async () => {
  serve('GET', `${BASE}/values:batchGet`, { valueRanges: [{ range: 'not a range', values: [['x']] }] });
  await assert.rejects(callTool('sheets_find', { spreadsheetId: SHEET, ranges: ['Leads'], text: 'x' }), { code: 'unexpected-response' });
});

// ---------------------------------------------------------------------------------------------
// Disclosures (what the confirmation card says) for the shapes the security suites do not pin
// ---------------------------------------------------------------------------------------------

const DISCLOSURES = [
  ['sheets_copy', { spreadsheetId: SHEET, title: 'Copy', parentFolderId: 'folder_1' }, [`New spreadsheet "Copy" copied from spreadsheet ${SHEET} in folder folder_1`]],
  ['sheets_copy_tab', { spreadsheetId: SHEET, sheetId: 7, destinationSpreadsheetId: 'sheet-two-0002' }, [`New tab in spreadsheet sheet-two-0002, copied from tab 7 of spreadsheet ${SHEET}`]],
  ['sheets_values_update', { spreadsheetId: SHEET, range: 'Leads!A1:B2', values: [['a', 'b'], ['c']] }, [`Overwrite Leads!A1:B2 of spreadsheet ${SHEET} (3 cell(s); current values are replaced)`]],
  ['sheets_values_batch_update', { spreadsheetId: SHEET, data: [{ range: 'A!A1', values: [['a']] }, { range: 'B!A1:B1', values: [['a', 'b']] }] },
    [`Overwrite A!A1 of spreadsheet ${SHEET} (1 cell(s); current values are replaced)`, `Overwrite B!A1:B1 of spreadsheet ${SHEET} (2 cell(s); current values are replaced)`]],
  ['sheets_values_clear', { spreadsheetId: SHEET, range: 'Leads!A2:B9' }, [`Clear every value in Leads!A2:B9 of spreadsheet ${SHEET}`]],
  ['sheets_values_by_data_filter', { spreadsheetId: SHEET, action: 'update', data: [{ dataFilter: { a1Range: 'Leads!A1' }, values: [['v']] }, { dataFilter: { gridRange: { sheetId: 3 } }, values: [['v', 'w']] }] },
    [`Overwrite range Leads!A1 of spreadsheet ${SHEET} (1 cell(s); current values are replaced)`, `Overwrite grid range on tab 3 of spreadsheet ${SHEET} (2 cell(s); current values are replaced)`]],
  ['sheets_values_by_data_filter', { spreadsheetId: SHEET, action: 'get', dataFilters: [{ developerMetadataLookup: { metadataKey: 'k' } }] }, [`Read values in cells found by developer metadata of spreadsheet ${SHEET}`]],
  ['sheets_values_by_data_filter', { spreadsheetId: SHEET, action: 'clear', dataFilters: [{ a1Range: 'Leads!A2:A9' }] }, [`Clear every value in range Leads!A2:A9 of spreadsheet ${SHEET}`]],
  ['sheets_find_replace', { spreadsheetId: SHEET, find: 'a', replacement: 'b', allSheets: true }, [`Replace every match of "a" with "b" on every tab of spreadsheet ${SHEET} (matched cells are overwritten)`]],
  ['sheets_find_replace', { spreadsheetId: SHEET, find: 'a', replacement: 'b', sheetId: 4 }, [`Replace every match of "a" with "b" on tab 4 of spreadsheet ${SHEET} (matched cells are overwritten)`]],
  ['sheets_tab_modify', { spreadsheetId: SHEET, action: 'add', title: 'New' }, [`spreadsheet ${SHEET}`, 'add new tab "New"']],
  ['sheets_tab_modify', { spreadsheetId: SHEET, action: 'delete', sheetId: 4 }, [`spreadsheet ${SHEET}`, 'delete tab 4 and all of its data']],
  ['sheets_tab_modify', { spreadsheetId: SHEET, action: 'rename', sheetId: 4, title: 'R' }, [`spreadsheet ${SHEET}`, 'rename tab 4']],
  ['sheets_sort', { spreadsheetId: SHEET, range: { sheetId: 0, startRowIndex: 1 }, sortSpecs: [{ dimensionIndex: 0 }] }, [`spreadsheet ${SHEET}`, 'reorder rows of tab 0, rows 2 onward, all columns (the old order is not kept)']],
  ['sheets_basic_filter', { spreadsheetId: SHEET, action: 'set', range: { sheetId: 2, startRowIndex: 0, endRowIndex: 10, startColumnIndex: 0, endColumnIndex: 4 } }, [`spreadsheet ${SHEET}`, 'replace the basic filter on tab 2, rows 1-10, columns A-D']],
  ['sheets_basic_filter', { spreadsheetId: SHEET, action: 'clear', sheetId: 2 }, [`spreadsheet ${SHEET}`, 'remove the basic filter from tab 2']],
  ['sheets_filter_views', { spreadsheetId: SHEET, action: 'list' }, [`spreadsheet ${SHEET}`, 'list filter views (no change)']],
  ['sheets_filter_views', { spreadsheetId: SHEET, action: 'add', filter: { title: 'Open' } }, [`spreadsheet ${SHEET}`, 'add new filter view "Open"']],
  ['sheets_filter_views', { spreadsheetId: SHEET, action: 'add', filter: { range: { sheetId: 0 } } }, [`spreadsheet ${SHEET}`, 'add new filter view "untitled"']],
  ['sheets_filter_views', { spreadsheetId: SHEET, action: 'delete', filterViewId: 11 }, [`spreadsheet ${SHEET}`, 'delete filter view 11']],
  ['sheets_format', { spreadsheetId: SHEET, range: { sheetId: 0, endColumnIndex: 2 }, cellFormat: { wrapStrategy: 'WRAP' }, fields: ['wrapStrategy'], borders: { left: {} }, frozenRowCount: 2, frozenColumnCount: 1, columnWidth: 50 },
    [`spreadsheet ${SHEET}`, 'format tab 0, all rows, columns A-B: cell format (wrapStrategy); borders; frozen rows = 2; frozen columns = 1; column width = 50px']],
  ['sheets_named_ranges', { spreadsheetId: SHEET, action: 'list' }, [`spreadsheet ${SHEET}`, 'list named ranges (no change)']],
  ['sheets_named_ranges', { spreadsheetId: SHEET, action: 'add', name: 'Totals', range: { sheetId: 0, startRowIndex: 4, endRowIndex: 5 } }, [`spreadsheet ${SHEET}`, 'add named range "Totals" at tab 0, rows 5-5, all columns']],
  ['sheets_named_ranges', { spreadsheetId: SHEET, action: 'update', namedRangeId: 'nr1', name: 'Sum' }, [`spreadsheet ${SHEET}`, 'change named range nr1 to "Sum" (formulas using it follow the change)']],
  ['sheets_named_ranges', { spreadsheetId: SHEET, action: 'update', namedRangeId: 'nr1', range: { sheetId: 1 } }, [`spreadsheet ${SHEET}`, 'change named range nr1 at tab 1, all rows, all columns (formulas using it follow the change)']],
  ['sheets_named_ranges', { spreadsheetId: SHEET, action: 'delete', namedRangeId: 'nr1' }, [`spreadsheet ${SHEET}`, 'delete named range nr1 (formulas using it stop working)']],
];

test('disclosure: a line over 300 characters is shortened to 300 with an ellipsis, never dropped', async () => {
  const [line] = await disclose('sheets_find_replace', { spreadsheetId: SHEET, find: 'f'.repeat(400), replacement: 'r', allSheets: true });
  assert.equal(line.length, 300);
  assert.ok(line.startsWith('Replace every match of "ffff'));
  assert.ok(line.endsWith('…'));
});

test('disclosure: a grid-range data filter without a tab id is refused by the schema, so the card never guesses a tab', async () => {
  const input = (gridRange) => ({ spreadsheetId: SHEET, action: 'clear', dataFilters: [{ gridRange }] });
  await assert.rejects(disclose('sheets_values_by_data_filter', input({ startRowIndex: 1 })), { name: 'ToolInputError', message: /#\/dataFilters\/0 \(properties\)/ });
  // The same filter with its tab id is accepted: the refusal is the missing sheetId, nothing else.
  assert.deepEqual(await disclose('sheets_values_by_data_filter', input({ startRowIndex: 1, sheetId: 0 })), [`Clear every value in grid range on tab 0 of spreadsheet ${SHEET}`]);
});

for (const [name, input, expected] of DISCLOSURES) {
  test(`disclosure: ${name} ${JSON.stringify(input).slice(0, 90)}`, async () => {
    assert.deepEqual(await disclose(name, input), expected);
    assert.equal(fake.requests.length, 0);
  });
}

// ---------------------------------------------------------------------------------------------
// Error mapping: Google's failure → safe code (fixed sentence, retry advice, outcome)
// ---------------------------------------------------------------------------------------------

/** `[status, body, expected code, retryable, nextAction]`; all non-retryable, so one request each. */
const FAILURES = [
  [400, { error: { code: 400, status: 'INVALID_ARGUMENT' } }, 'invalid-request', false, 'fix-request'],
  [401, { error: { code: 401, status: 'UNAUTHENTICATED' } }, 'reconnect-required', false, 'reconnect'],
  [403, { error: { code: 403, status: 'PERMISSION_DENIED' } }, 'access-denied', false, 're-pick-file'],
  [403, { error: { code: 403, errors: [{ reason: 'insufficientPermissions' }] } }, 'missing-permission', false, 'grant-permission'],
  [403, { error: { code: 403, details: [{ reason: 'ACCESS_TOKEN_SCOPE_INSUFFICIENT' }] } }, 'missing-permission', false, 'grant-permission'],
  [403, { error: { code: 403, errors: [{ reason: 'appNotAuthorizedToFile' }] } }, 'file-not-granted', false, 're-pick-file'],
  [403, { error: { code: 403, errors: [{ reason: 'domainPolicy' }] } }, 'admin-policy', false, 'contact-admin'],
  [404, { error: { code: 404, status: 'NOT_FOUND' } }, 'file-not-granted', false, 're-pick-file'],
  [413, { error: { code: 413 } }, 'invalid-request', false, 'fix-request'],
  [418, { error: 'teapot' }, 'unexpected-response', false, 'report'],
];

for (const [status, body, code, retryable, nextAction] of FAILURES) {
  test(`error mapping: HTTP ${status} ${JSON.stringify(body.error?.errors ?? body.error?.details ?? '')} → ${code}`, async () => {
    serve('GET', `${BASE}/values/Leads`, body, status);
    await assert.rejects(callTool('sheets_values_get', { spreadsheetId: SHEET, range: 'Leads' }), { name: 'GoogleWorkspaceError', code, retryable, nextAction, outcome: 'not-applied' });
    // The host still serves the same cached token after a 401, so reconnect is required without resending it.
    assert.equal(fake.requests.length, 1);
  });
}

test('error mapping: a 429 with Retry-After longer than the inline wait is quota-delay with retryAfterMs, sent once', async () => {
  serve('GET', `${BASE}/values/Leads`, { error: { code: 429, status: 'RESOURCE_EXHAUSTED' } }, 429, { 'retry-after': '30' });
  await assert.rejects(callTool('sheets_values_get', { spreadsheetId: SHEET, range: 'Leads' }), { code: 'quota-delay', retryable: true, retryAfterMs: 30_000, nextAction: 'retry-later' });
  assert.equal(fake.requests.length, 1);
});

test('error mapping: a 403 rateLimitExceeded reason is quota-delay even without a 429 status', async () => {
  serve('GET', `${BASE}/values/Leads`, { error: { code: 403, errors: [{ reason: 'rateLimitExceeded' }] } }, 403, { 'retry-after': '60' });
  await assert.rejects(callTool('sheets_values_get', { spreadsheetId: SHEET, range: 'Leads' }), { code: 'quota-delay', retryAfterMs: 60_000 });
});

test('error mapping: a 409 on an idempotent write is conflict, retryable, and its outcome is not-applied', async () => {
  serve('PUT', `${BASE}/values/Leads!A1`, { error: { code: 409 } }, 409, { 'retry-after': '20' });
  await assert.rejects(callTool('sheets_values_update', { spreadsheetId: SHEET, range: 'Leads!A1', values: [['a']] }), { code: 'conflict', retryable: true, outcome: 'not-applied', retryAfterMs: 20_000 });
  assert.equal(fake.requests.length, 1);
});

test('error mapping: a 503 on an idempotent write is service-unavailable with an unknown outcome (safe to retry, unlike an append)', async () => {
  serve('POST', `${BASE}/values/Leads!A2:clear`, { error: { code: 503 } }, 503, { 'retry-after': '120' });
  await assert.rejects(callTool('sheets_values_clear', { spreadsheetId: SHEET, range: 'Leads!A2' }), { code: 'service-unavailable', retryable: true, outcome: 'unknown', retryAfterMs: 120_000 });
  assert.equal(fake.requests.length, 1);
});

test('retry: a read answered 503 once is retried and the second answer is returned', async () => {
  let calls = 0;
  fake.route({ method: 'GET', path: `${BASE}/values/Leads` }, () => {
    calls += 1;
    return calls === 1 ? [503, { error: { code: 503 } }, { 'retry-after': '0' }] : [200, { range: 'Leads!A1:A1', values: [['ok']] }];
  });
  assert.deepEqual(await callTool('sheets_values_get', { spreadsheetId: SHEET, range: 'Leads' }), { range: 'Leads!A1:A1', values: [['ok']] });
  assert.equal(fake.requests.length, 2);
});

// ---------------------------------------------------------------------------------------------
// Bounds (§D) not already pinned by the security suites
// ---------------------------------------------------------------------------------------------

test('bounds: a values read is also cut at 64 KiB of output, with the continuation range', async () => {
  // 100 rows of one 1 KiB cell: far under 500 rows and 5,000 cells, so only the byte budget can cut.
  serve('GET', `${BASE}/values/Leads!A1%3AA100`, { range: 'Leads!A1:A100', values: rows(100, 1, () => 'x'.repeat(1024)) });
  const result = await callTool('sheets_values_get', { spreadsheetId: SHEET, range: 'Leads!A1:A100' });
  assert.ok(result.values.length > 0 && result.values.length < 100);
  assert.equal(result.continuation, `Leads!A${result.values.length + 1}:A100`);
});

test('bounds: a continuation of a single-cell range keeps its one-cell shape', async () => {
  serve('GET', `${BASE}/values:batchGet`, { valueRanges: [{ range: 'A!A1:A500', values: rows(500, 1) }, { range: 'B!C7', values: [['x']] }] });
  const { valueRanges } = await callTool('sheets_values_batch_get', { spreadsheetId: SHEET, ranges: ['A!A1:A500', 'B!C7'] });
  assert.deepEqual(valueRanges[1], { range: 'B!C7', values: [], continuation: 'B!C7' });
});

test('bounds: a first row that alone is over the output budget is limit-exceeded (no progress possible)', async () => {
  serve('GET', `${BASE}/values/Leads`, { range: 'Leads!A1:A1', values: [['x'.repeat(70 * 1024)]] });
  await assert.rejects(callTool('sheets_values_get', { spreadsheetId: SHEET, range: 'Leads' }), { code: 'limit-exceeded', nextAction: 'narrow-request' });
});

test('bounds: a cut range Google did not answer in A1 form cannot be continued and is limit-exceeded, not a silent partial', async () => {
  serve('GET', `${BASE}/values/Leads`, { range: 'Leads', values: rows(600, 1) });
  await assert.rejects(callTool('sheets_values_get', { spreadsheetId: SHEET, range: 'Leads' }), { code: 'limit-exceeded' });
});

test('bounds: a values_by_data_filter read shares the same 500-row budget and names the continuation', async () => {
  serve('POST', `${BASE}/values:batchGetByDataFilter`, { valueRanges: [{ valueRange: { range: 'Leads!A1:A700', values: rows(700, 1) } }] });
  const { valueRanges } = await callTool('sheets_values_by_data_filter', { spreadsheetId: SHEET, action: 'get', dataFilters: [{ a1Range: 'Leads!A1:A700' }] });
  assert.deepEqual([valueRanges[0].values.length, valueRanges[0].continuation], [500, 'Leads!A501:A700']);
});

const OVER_1_MIB = Array.from({ length: 30 }, () => ['x'.repeat(40_000)]);
for (const [name, input] of [
  ['sheets_values_append', { spreadsheetId: SHEET, range: 'Leads', values: OVER_1_MIB }],
  ['sheets_values_batch_update', { spreadsheetId: SHEET, data: [{ range: 'Leads!A1', values: OVER_1_MIB }] }],
  ['sheets_values_by_data_filter', { spreadsheetId: SHEET, action: 'update', data: [{ dataFilter: { a1Range: 'Leads!A1' }, values: OVER_1_MIB }] }],
]) {
  test(`bounds: ${name} with a body over 1 MiB is limit-exceeded before any request`, async () => {
    await assert.rejects(callTool(name, input), { code: 'limit-exceeded', outcome: 'not-applied' });
    assert.equal(fake.requests.length, 0);
  });
}

const BIG = 'y'.repeat(70 * 1024);
for (const [name, input, method, path, answer] of [
  ['sheets_get_by_data_filter', { spreadsheetId: SHEET, dataFilters: [{ a1Range: 'Leads!A1' }] }, 'POST', `${BASE}:getByDataFilter`, { spreadsheetId: SHEET, note: BIG }],
  ['sheets_filter_views', { spreadsheetId: SHEET, action: 'list' }, 'GET', BASE, { sheets: [{ properties: { sheetId: 0 }, filterViews: [{ title: BIG }] }] }],
  ['sheets_filter_views', { spreadsheetId: SHEET, action: 'add', filter: { title: 'T' } }, 'POST', `${BASE}:batchUpdate`, { replies: [{ addFilterView: { filter: { title: BIG } } }] }],
  ['sheets_named_ranges', { spreadsheetId: SHEET, action: 'list' }, 'GET', BASE, { namedRanges: [{ name: BIG }] }],
  ['sheets_protected_ranges_get', { spreadsheetId: SHEET }, 'GET', BASE, { sheets: [{ protectedRanges: [{ description: BIG }] }] }],
  ['sheets_developer_metadata', { spreadsheetId: SHEET, action: 'get', metadataId: 1 }, 'GET', `${BASE}/developerMetadata/1`, { metadataValue: BIG }],
]) {
  test(`bounds: ${name} ${input.action ?? ''} with an answer over 64 KiB is limit-exceeded, never cut short`, async () => {
    serve(method, path, answer);
    await assert.rejects(callTool(name, input), { code: 'limit-exceeded', message: /answer over 64 KiB/ });
  });
}

test('bounds: sheets_batch_update with replies over 64 KiB keeps the summary and states that the replies were omitted', async () => {
  serve('POST', `${BASE}:batchUpdate`, { replies: [{ addSheet: { properties: { title: BIG } } }] });
  const result = await callTool('sheets_batch_update', { spreadsheetId: SHEET, requests: [{ addSheet: { properties: { title: 'X' } } }] });
  assert.deepEqual(result, { summary: { applied: 1, kinds: { addSheet: 1 } }, repliesOmitted: 'larger than 64 KiB' });
});

test('bounds: the schema refuses more than 100 ranges to clear, 20 find ranges and 100 batch requests', async () => {
  const many = (count) => Array.from({ length: count }, (_, index) => `Leads!A${index + 1}`);
  await assert.rejects(callTool('sheets_values_batch_clear', { spreadsheetId: SHEET, ranges: many(101) }), { name: 'ToolInputError', message: /\/ranges \(maxItems\)/ });
  await assert.rejects(callTool('sheets_find', { spreadsheetId: SHEET, ranges: many(21), text: 'x' }), { name: 'ToolInputError', message: /\/ranges \(maxItems\)/ });
  await assert.rejects(callTool('sheets_batch_update', { spreadsheetId: SHEET, requests: Array.from({ length: 101 }, () => ({ deleteSheet: { sheetId: 1 } })) }), { name: 'ToolInputError', message: /\/requests \(maxItems\)/ });
  assert.equal(fake.requests.length, 0);
});

// ---------------------------------------------------------------------------------------------
// Cancellation: the caller's signal reaches every request
// ---------------------------------------------------------------------------------------------

/** One valid input per Sheets tool that sends a request, with the route its first request hits. */
const SIGNAL_CALLS = [
  ['sheets_get', { spreadsheetId: SHEET }],
  ['sheets_get_by_data_filter', { spreadsheetId: SHEET, dataFilters: [{ a1Range: 'Leads!A1' }] }],
  ['sheets_create', { title: 'T' }],
  ['sheets_copy', { spreadsheetId: SHEET, title: 'T' }],
  ['sheets_copy_tab', { spreadsheetId: SHEET, sheetId: 1, destinationSpreadsheetId: 'sheet-two-0002' }],
  ['sheets_values_get', { spreadsheetId: SHEET, range: 'Leads' }],
  ['sheets_values_batch_get', { spreadsheetId: SHEET, ranges: ['Leads'] }],
  ['sheets_values_append', { spreadsheetId: SHEET, range: 'Leads', values: [['a']] }],
  ['sheets_values_update', { spreadsheetId: SHEET, range: 'Leads', values: [['a']] }],
  ['sheets_values_batch_update', { spreadsheetId: SHEET, data: [{ range: 'Leads', values: [['a']] }] }],
  ['sheets_values_clear', { spreadsheetId: SHEET, range: 'Leads' }],
  ['sheets_values_batch_clear', { spreadsheetId: SHEET, ranges: ['Leads'] }],
  ['sheets_values_by_data_filter', { spreadsheetId: SHEET, action: 'clear', dataFilters: [{ a1Range: 'Leads' }] }],
  ['sheets_find', { spreadsheetId: SHEET, ranges: ['Leads'], text: 'x' }],
  ['sheets_find_replace', { spreadsheetId: SHEET, find: 'a', replacement: 'b', allSheets: true }],
  ['sheets_tab_modify', { spreadsheetId: SHEET, action: 'delete', sheetId: 1 }],
  ['sheets_sort', { spreadsheetId: SHEET, range: { sheetId: 0 }, sortSpecs: [{ dimensionIndex: 0 }] }],
  ['sheets_basic_filter', { spreadsheetId: SHEET, action: 'clear', sheetId: 0 }],
  ['sheets_filter_views', { spreadsheetId: SHEET, action: 'list' }],
  ['sheets_format', { spreadsheetId: SHEET, range: { sheetId: 0 }, columnWidth: 10 }],
  ['sheets_named_ranges', { spreadsheetId: SHEET, action: 'list' }],
  ['sheets_protected_ranges_get', { spreadsheetId: SHEET }],
  ['sheets_developer_metadata', { spreadsheetId: SHEET, action: 'get', metadataId: 1 }],
  ['sheets_batch_update', { spreadsheetId: SHEET, requests: [{ deleteSheet: { sheetId: 1 } }] }],
  ['sheets_export_csv', { spreadsheetId: SHEET, sheetId: 0 }],
  ['sheets_open_existing', { spreadsheetId: SHEET }],
];

test('cancellation: the signal list covers all 26 Sheets tools', () => {
  assert.deepEqual(SIGNAL_CALLS.map(([name]) => name).sort(), Object.keys(EFFECTS).sort());
});

for (const [name, input] of SIGNAL_CALLS) {
  test(`cancellation: ${name} called with an aborted signal sends nothing and rejects at the capability gate`, async () => {
    const controller = new AbortController();
    const reason = new Error('person cancelled');
    controller.abort(reason);
    await assert.rejects(callTool(name, input, { signal: controller.signal }), { message: CALL_ENDED_MESSAGE });
    assert.equal(fake.requests.length, 0);
  });
}

test('cancellation: account_info called with an aborted signal sends nothing and rejects at the capability gate', async () => {
  const controller = new AbortController();
  const reason = new Error('person cancelled');
  controller.abort(reason);
  await assert.rejects(callTool('account_info', {}, { signal: controller.signal }), { message: CALL_ENDED_MESSAGE });
  assert.equal(fake.requests.length, 0);
});

test('cancellation: sheets_export_csv aborted while its values read is in flight writes no file', async () => {
  const controller = new AbortController();
  const reason = new Error('person cancelled');
  serve('GET', BASE, { sheets: [{ properties: { sheetId: 0, title: 'Leads', gridProperties: { rowCount: 2, columnCount: 2 } } }] });
  fake.route({ method: 'GET', path: `${BASE}/values:batchGet` }, () => { controller.abort(reason); return [200, { valueRanges: [] }]; });
  await assert.rejects(callTool('sheets_export_csv', { spreadsheetId: SHEET, sheetId: 0 }, { signal: controller.signal }), (error) => error === reason);
  assert.equal(fake.requests.length, 2);
  assert.deepEqual(artifactWrites, []);
});
