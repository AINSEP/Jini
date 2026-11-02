/**
 * @file Phase-A security pins for the Sheets admin tools (lot G12): approval class and disclosure
 * per tool, the batch request-kind inventory failing closed, bounds (batch size, export size, tool
 * output), path and query encoding of ids and ranges, no token / Google text / cell contents in
 * errors, uncertain non-replayable batches never replayed, and the picked-file check of
 * `open_existing`. Modules run against the local fake Google only; the full contract suite is phase C.
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { after, before, beforeEach, test } from 'node:test';

import { encodeCsv } from '../lib/sheets-admin-csv.mjs';
import { REQUEST_KINDS, checkRequests } from '../lib/sheets-admin-request-kinds.mjs';
import basicFilter from '../tools/sheets-admin/basic-filter.mjs';
import batchUpdate from '../tools/sheets-admin/batch-update.mjs';
import developerMetadata from '../tools/sheets-admin/developer-metadata.mjs';
import exportCsv from '../tools/sheets-admin/export-csv.mjs';
import filterViews from '../tools/sheets-admin/filter-views.mjs';
import format from '../tools/sheets-admin/format.mjs';
import namedRanges from '../tools/sheets-admin/named-ranges.mjs';
import openExisting from '../tools/sheets-admin/open-existing.mjs';
import protectedRangesGet from '../tools/sheets-admin/protected-ranges-get.mjs';
import sort from '../tools/sheets-admin/sort.mjs';
import tabModify from '../tools/sheets-admin/tab-modify.mjs';
import { startFakeGoogle } from './fake-google-http.mjs';
import { CONNECTION, SPREADSHEET, TOKEN, directCapabilities } from './sheets-admin-harness.mjs';

const BATCH_PATH = `/v4/spreadsheets/${SPREADSHEET}:batchUpdate`;
const base = { connectionRef: CONNECTION, spreadsheetId: SPREADSHEET };
const range = { sheetId: 3, startRowIndex: 1, endRowIndex: 10, startColumnIndex: 0, endColumnIndex: 4 };

let fake;
before(async () => { fake = await startFakeGoogle({ clients: {} }); });
after(async () => { await fake.close(); });
beforeEach(() => { fake.reset(); });

const run = (tool, input, optional) => tool.invoke({ input: { ...base, ...input }, capabilities: directCapabilities({ fake }, optional) });
const sheetsRequests = () => fake.requests.filter((request) => request.host === 'sheets.googleapis.com' || request.host === 'www.googleapis.com');
/** Matches a refusal by safe code and next action, and proves nothing reached Google. */
async function refusedBeforeGoogle(promise, code) {
  await assert.rejects(promise, (error) => error.name === 'GoogleWorkspaceError' && error.code === code && error.outcome === 'not-applied');
  assert.equal(sheetsRequests().length, 0, 'nothing was sent to Google');
}

test('approval: each G12 tool keeps its declared effect (destructive tools are the ones that delete, overwrite, reorder or re-point)', async () => {
  const file = JSON.parse(await readFile(new URL('../tovu-agent-tools.json', import.meta.url), 'utf8'));
  const effects = Object.fromEntries(file.tools.filter((tool) => tool.module.startsWith('tools/sheets-admin/')).map((tool) => [tool.name, tool.effect]));
  assert.deepEqual(effects, {
    sheets_tab_modify: 'destructive', sheets_sort: 'destructive', sheets_basic_filter: 'write', sheets_filter_views: 'destructive', sheets_format: 'write',
    sheets_named_ranges: 'destructive', sheets_protected_ranges_get: 'read', sheets_developer_metadata: 'read', sheets_batch_update: 'destructive',
    sheets_export_csv: 'read', sheets_open_existing: 'read',
  });
});

test('schema: every G12 tool takes spreadsheetId only in Google\'s id alphabet and rejects unknown input keys', async () => {
  const file = JSON.parse(await readFile(new URL('../tovu-agent-tools.json', import.meta.url), 'utf8'));
  for (const tool of file.tools.filter((entry) => entry.module.startsWith('tools/sheets-admin/'))) {
    assert.equal(tool.inputSchema.properties.spreadsheetId.pattern, '^[A-Za-z0-9_-]{10,200}$', tool.name);
    assert.equal(tool.inputSchema.additionalProperties, false, tool.name);
  }
});

test('disclosure: every write and destructive tool names the spreadsheet and what changes, before anything is sent', () => {
  const cases = [
    [tabModify, { action: 'delete', sheetId: 3 }, 'delete tab 3 and all of its data'],
    [sort, { range, sortSpecs: [{ dimensionIndex: 0 }] }, 'reorder rows of tab 3, rows 2-10, columns A-D (the old order is not kept)'],
    [basicFilter, { action: 'clear', sheetId: 3 }, 'remove the basic filter from tab 3'],
    [filterViews, { action: 'delete', filterViewId: 12 }, 'delete filter view 12'],
    [format, { range, cellFormat: { textFormat: { bold: true } }, fields: ['textFormat.bold'], frozenRowCount: 1 }, 'format tab 3, rows 2-10, columns A-D: cell format (textFormat.bold); frozen rows = 1'],
    [namedRanges, { action: 'delete', namedRangeId: 'nr-1' }, 'delete named range nr-1 (formulas using it stop working)'],
  ];
  for (const [tool, input, line] of cases) assert.deepEqual(tool.describeAffectedResources({ input: { ...base, ...input } }), [`spreadsheet ${SPREADSHEET}`, line]);
  assert.equal(fake.requests.length, 0);
});

test('basic filter cannot sort: the schema refuses sortSpecs, and a raw setBasicFilter is disclosed as destructive', async () => {
  const file = JSON.parse(await readFile(new URL('../tovu-agent-tools.json', import.meta.url), 'utf8'));
  const tool = file.tools.find((entry) => entry.name === 'sheets_basic_filter');
  assert.equal(tool.effect, 'write');
  assert.equal(tool.inputSchema.additionalProperties, false);
  assert.equal(Object.hasOwn(tool.inputSchema.properties, 'sortSpecs'), false);
  assert.equal(REQUEST_KINDS.setBasicFilter.effect, 'destructive');
  assert.deepEqual(batchUpdate.describeAffectedResources({ input: { ...base, requests: [{ setBasicFilter: { filter: { range } } }] } }), [`spreadsheet ${SPREADSHEET}`, 'setBasicFilter x1 (destructive)']);
});

test('basic filter set sends filterSpecs only, never sortSpecs', async () => {
  fake.route({ method: 'POST', path: BATCH_PATH }, () => [200, { replies: [{}] }]);
  await run(basicFilter, { action: 'set', range, filterSpecs: [{ columnIndex: 0 }], sortSpecs: [{ dimensionIndex: 0 }] });
  assert.deepEqual(JSON.parse(sheetsRequests()[0].body).requests, [{ setBasicFilter: { filter: { range, filterSpecs: [{ columnIndex: 0 }] } } }]);
});

test('batch disclosure: the card lists every request kind with its count and effect', () => {
  const requests = [{ insertDimension: { range: {} } }, { deleteDimension: { range: {} } }, { insertDimension: { range: {} } }];
  assert.deepEqual(batchUpdate.describeAffectedResources({ input: { ...base, requests } }), [`spreadsheet ${SPREADSHEET}`, 'insertDimension x2 (write)', 'deleteDimension x1 (destructive)']);
});

test('inventory: every listed kind has an effect, a replay class and a body check; the data-source kinds are not listed', () => {
  for (const [kind, entry] of Object.entries(REQUEST_KINDS)) {
    assert.ok(['write', 'destructive'].includes(entry.effect), kind);
    assert.ok(['idempotent', 'unsafe'].includes(entry.replay), kind);
    const body = Object.fromEntries(entry.requires.map((requirement) => [[requirement].flat()[0], requirement === 'fields' ? 'title' : {}]));
    assert.equal(checkRequests({ requests: [{ [kind]: body }] }).kinds.get(kind).count, 1, kind);
    if (entry.requires.length > 0) assert.throws(() => checkRequests({ requests: [{ [kind]: {} }] }), { code: 'invalid-input' }, kind);
  }
  for (const kind of ['addDataSource', 'updateDataSource', 'deleteDataSource', 'refreshDataSource', 'cancelDataSourceRefresh']) assert.equal(Object.hasOwn(REQUEST_KINDS, kind), false, kind);
});

test('fail closed: an unknown, preview, data-source or prototype-named kind is unsupported-request and the card cannot be shown', async () => {
  for (const request of [{ addWidget: {} }, { addDataSource: { dataSource: {} } }, JSON.parse('{"__proto__": {}}'), { constructor: {} }]) {
    assert.throws(() => batchUpdate.describeAffectedResources({ input: { ...base, requests: [request] } }), { code: 'unsupported-request' });
    await refusedBeforeGoogle(run(batchUpdate, { requests: [{ sortRange: { range, sortSpecs: [] } }, request] }), 'unsupported-request');
  }
});

test('fail closed: a request naming two kinds, or a * field mask, is refused before Google', async () => {
  await refusedBeforeGoogle(run(batchUpdate, { requests: [{ deleteSheet: { sheetId: 1 }, addSheet: {} }] }), 'invalid-input');
  await refusedBeforeGoogle(run(batchUpdate, { requests: [{ repeatCell: { range, cell: {}, fields: '*' } }] }), 'invalid-input');
});

test('bounds: more than 100 requests or more than 1 MiB per batch is limit-exceeded before Google', async () => {
  const many = Array.from({ length: 101 }, () => ({ unmergeCells: { range } }));
  await refusedBeforeGoogle(run(batchUpdate, { requests: many }), 'limit-exceeded');
  const huge = [{ updateCells: { rows: [{ values: [{ note: 'n'.repeat(1024 * 1024) }] }], fields: 'note', range } }];
  await refusedBeforeGoogle(run(batchUpdate, { requests: huge }), 'limit-exceeded');
});

test('bounds: more than 48 different request kinds is limit-exceeded, so the card can always list every kind', async () => {
  const kinds = Object.entries(REQUEST_KINDS).slice(0, 49).map(([kind, entry]) => ({ [kind]: Object.fromEntries(entry.requires.map((requirement) => [[requirement].flat()[0], requirement === 'fields' ? 'title' : {}])) }));
  await refusedBeforeGoogle(run(batchUpdate, { requests: kinds }), 'limit-exceeded');
  assert.equal(checkRequests({ requests: kinds.slice(0, 48) }).kinds.size, 48);
});

test('uncertain: a batch holding a non-replayable kind that gets a 5xx is uncertain-outcome and is sent exactly once', async () => {
  fake.route({ method: 'POST', path: BATCH_PATH }, () => [503, { error: { code: 503, status: 'UNAVAILABLE' } }]);
  await assert.rejects(run(tabModify, { action: 'add', title: 'New' }), { code: 'uncertain-outcome', outcome: 'unknown', retryable: false, nextAction: 'review-outcome' });
  assert.equal(fake.requests.filter((request) => request.path === BATCH_PATH).length, 1);
});

// The host executor's schema refusal of the same id (validation before the module runs) is pinned
// with the host's registrar in its overlay tests; here the declared pattern itself must refuse it.
test('paths: a spreadsheet id that is not a Google id never reaches a URL, and the declared input schema refuses it too', async () => {
  for (const spreadsheetId of ['../../drive/v3/files/x', 'abc/def?x=1#y', 'short']) {
    await refusedBeforeGoogle(run(protectedRangesGet, { spreadsheetId }), 'invalid-input');
  }
  const file = JSON.parse(await readFile(new URL('../tovu-agent-tools.json', import.meta.url), 'utf8'));
  const declared = file.tools.find((tool) => tool.name === 'sheets_protected_ranges_get');
  assert.equal(new RegExp(declared.inputSchema.properties.spreadsheetId.pattern).test('../x/y/zzzzzz'), false);
});

test('paths: a developer metadata id must be a non-negative integer before it becomes a path segment', async () => {
  for (const metadataId of [1.5, -1, '1/../../x']) await refusedBeforeGoogle(run(developerMetadata, { action: 'get', metadataId }), 'invalid-input');
});

test('query: an export range travels as an encoded ranges= parameter with the tab title A1-quoted, never in the path', async () => {
  fake.route({ method: 'GET', path: `/v4/spreadsheets/${SPREADSHEET}` }, () => [200, { sheets: [{ properties: { sheetId: 3, title: "O'Brien & co/x?#", gridProperties: { rowCount: 2, columnCount: 2 } } }] }]);
  fake.route({ method: 'GET', path: `/v4/spreadsheets/${SPREADSHEET}/values:batchGet` }, () => [200, { valueRanges: [{ values: [['a', 'b']] }] }]);
  const written = [];
  await run(exportCsv, { sheetId: 3 }, { writeArtifact: async (file) => { written.push(file); return { artifactRef: 'artifact-1' }; } });
  const read = fake.requests.find((request) => request.path.endsWith('/values:batchGet'));
  assert.deepEqual(read.query.getAll('ranges'), ["'O''Brien & co/x?#'!A1:B2"]);
  assert.equal(written[0].name, "O_Brien _ co_x_.csv");
});

test('errors: a Google failure that echoes the token and cell contents becomes a fixed safe message without either', async () => {
  fake.route({ method: 'POST', path: BATCH_PATH }, () => [400, { error: { code: 400, message: `Invalid value at 'SECRET-CELL-VALUE' for ${TOKEN}`, status: 'INVALID_ARGUMENT' } }]);
  const error = await run(sort, { range, sortSpecs: [{ dimensionIndex: 0 }] }).catch((caught) => caught);
  assert.equal(error.code, 'invalid-request');
  for (const text of [error.message, JSON.stringify(error)]) {
    assert.equal(text.includes('SECRET-CELL-VALUE'), false);
    assert.equal(text.includes(TOKEN), false);
  }
});

test('export: a host with no artifact store is refused with export-unavailable before anything is read from Google', async () => {
  await refusedBeforeGoogle(run(exportCsv, { sheetId: 3 }, { withoutArtifacts: true }), 'export-unavailable');
});

test('export bounds: a tab over 20,000 grid rows is refused after the metadata read, before any values read', async () => {
  fake.route({ method: 'GET', path: `/v4/spreadsheets/${SPREADSHEET}` }, () => [200, { sheets: [{ properties: { sheetId: 3, title: 'Big', gridProperties: { rowCount: 20_001, columnCount: 1 } } }] }]);
  await assert.rejects(run(exportCsv, { sheetId: 3 }), { code: 'limit-exceeded' });
  assert.deepEqual(fake.requests.map((request) => request.path), [`/v4/spreadsheets/${SPREADSHEET}`]);
});

test('export bounds: a range over 100,000 cells is refused before any values read', async () => {
  fake.route({ method: 'GET', path: `/v4/spreadsheets/${SPREADSHEET}` }, () => [200, { sheets: [{ properties: { sheetId: 3, title: 'T', gridProperties: { rowCount: 10, columnCount: 2 } } }] }]);
  await assert.rejects(run(exportCsv, { sheetId: 3, range: 'A1:Z5000' }), { code: 'limit-exceeded' });
  assert.deepEqual(fake.requests.map((request) => request.path), [`/v4/spreadsheets/${SPREADSHEET}`]);
});

test('export bounds: a CSV over 4 MiB is an error and no partial file is written', async () => {
  fake.route({ method: 'GET', path: `/v4/spreadsheets/${SPREADSHEET}` }, () => [200, { sheets: [{ properties: { sheetId: 3, title: 'Wide', gridProperties: { rowCount: 10_000, columnCount: 10 } } }] }]);
  const row = Array.from({ length: 10 }, () => 'v'.repeat(50));
  fake.route({ method: 'GET', path: `/v4/spreadsheets/${SPREADSHEET}/values:batchGet` }, () => [200, { valueRanges: [{ values: Array.from({ length: 1000 }, () => row) }] }]);
  const written = [];
  await assert.rejects(run(exportCsv, { sheetId: 3 }, { writeArtifact: async (file) => { written.push(file); return { artifactRef: 'x' }; } }), { code: 'limit-exceeded' });
  assert.equal(written.length, 0);
});

test('output bound: an answer over 64 KiB is limit-exceeded, never cut short', async () => {
  const protectedRanges = Array.from({ length: 2000 }, (_, index) => ({ protectedRangeId: index, description: 'd'.repeat(40) }));
  fake.route({ method: 'GET', path: `/v4/spreadsheets/${SPREADSHEET}` }, () => [200, { sheets: [{ properties: { sheetId: 3, title: 'T' }, protectedRanges }] }]);
  await assert.rejects(run(protectedRangesGet, {}), { code: 'limit-exceeded', nextAction: 'narrow-request' });
});

test('format: the cell-format mask is always under userEnteredFormat, and the schema refuses a value mask', async () => {
  fake.route({ method: 'POST', path: BATCH_PATH }, () => [200, { replies: [{}] }]);
  await run(format, { range, cellFormat: { textFormat: { bold: true } }, fields: ['textFormat.bold'] });
  assert.equal(JSON.parse(fake.requests.at(-1).body).requests[0].repeatCell.fields, 'userEnteredFormat.textFormat.bold');
  const file = JSON.parse(await readFile(new URL('../tovu-agent-tools.json', import.meta.url), 'utf8'));
  const pattern = new RegExp(file.tools.find((tool) => tool.name === 'sheets_format').inputSchema.properties.fields.items.pattern);
  for (const field of ['userEnteredValue', '*', 'note', 'textFormat.bold,userEnteredValue']) assert.equal(pattern.test(field), false, field);
});

test('open_existing: no id means waiting with no request; an ungranted id is file-not-granted; a non-spreadsheet is not-a-spreadsheet (the Picker code)', async () => {
  assert.equal((await run(openExisting, { spreadsheetId: undefined })).status, 'waiting');
  assert.equal(fake.requests.length, 0);
  await assert.rejects(run(openExisting, {}), { code: 'file-not-granted', nextAction: 're-pick-file' });
  fake.route({ method: 'GET', path: `/drive/v3/files/${SPREADSHEET}` }, () => [200, { id: SPREADSHEET, name: 'Notes', mimeType: 'application/vnd.google-apps.document' }]);
  await assert.rejects(run(openExisting, {}), { code: 'not-a-spreadsheet', nextAction: 're-pick-file' });
  fake.route({ method: 'GET', path: `/drive/v3/files/${SPREADSHEET}` }, () => [200, { id: SPREADSHEET, name: 'Old', mimeType: 'application/vnd.google-apps.spreadsheet', trashed: true }]);
  await assert.rejects(run(openExisting, {}), { code: 'file-not-granted' });
});

test('open_existing: a picked spreadsheet returns metadata only, with a link built from the verified id', async () => {
  fake.route({ method: 'GET', path: `/drive/v3/files/${SPREADSHEET}` }, () => [200, { id: SPREADSHEET, name: 'Leads', mimeType: 'application/vnd.google-apps.spreadsheet', webViewLink: 'https://evil.example/phish' }]);
  // The same check as a Picker selection: Drive metadata, then the Sheets API must open it.
  fake.route({ method: 'GET', path: `/v4/spreadsheets/${SPREADSHEET}` }, () => [200, { spreadsheetId: SPREADSHEET, properties: { title: 'Leads' } }]);
  assert.deepEqual(await run(openExisting, {}), { status: 'selected', resource: { spreadsheetId: SPREADSHEET, title: 'Leads', url: `https://docs.google.com/spreadsheets/d/${SPREADSHEET}/edit` } });
});

test('CSV injection: text starting with =, +, -, @, tab or CR gets a leading apostrophe, so a spreadsheet app shows it as text', () => {
  const rows = [['=HYPERLINK("https://x.test","y")', '+1', '-2+3', '@SUM(A1)', '\t=1', '\r=1']];
  assert.equal(encodeCsv({ rows }).csv, `"'=HYPERLINK(""https://x.test"",""y"")",'+1,'-2+3,'@SUM(A1),'\t=1,"'\r=1"`);
});

test('CSV injection: numbers, booleans and ordinary text are written unchanged (only formula-like text is prefixed)', () => {
  assert.equal(encodeCsv({ rows: [[-5, 1.5, true, 'a=b', 'plain', '']] }).csv, '-5,1.5,true,a=b,plain,');
});
