/**
 * @file Phase-A proof for the Sheets tools (lot G11): the plugin's real `tovu-agent-tools.json` and
 * `tools/sheets/*.mjs` modules run through the real Jini tool projection (schema validation,
 * per-call capability session, affected-resource disclosure) against the local fake of Google. One
 * vertical-slice proof plus security pins: approval class and disclosure per tool, read and payload
 * bounds, safe errors (no token, Google text or cell contents), path/query encoding of ids and
 * ranges, the RAW default, and no replay of an uncertain append/create/copy. Only `fake.fetch` is
 * injected; it throws for every non-Google host.
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { after, before, beforeEach, test } from 'node:test';

import { createAgentPluginToolProjection, createIssuedTokenMemories, parseAgentPluginToolsFile } from '@jini-ai/agent-plugins/lifecycle/tools';
import { createPluginContributionRegistry, pluginToolIdFor } from '@jini-ai/plugins/host';

import { pathSegment } from '../lib/http.mjs';
import { startFakeGoogle } from './fake-google-http.mjs';

const PLUGIN = 'google-workspace';
const PLUGIN_ROOT = new URL('../', import.meta.url);
const SHEET = 'sheet-one-0001';
const BASE = `/v4/spreadsheets/${SHEET}`;
// Built at runtime: not secret-shaped, but unique enough to search outputs and errors for.
const TOKEN = `fake-access-${'t'.repeat(24)}`;
const CELL_SECRET = 'visitor-typed-value-0042';

/** One valid input per tool, used for the approval/disclosure pins. */
const SAMPLE_INPUTS = {
  sheets_get: { spreadsheetId: SHEET },
  sheets_get_by_data_filter: { spreadsheetId: SHEET, dataFilters: [{ a1Range: 'Leads!A1:B2' }] },
  sheets_create: { title: 'Leads 2026' },
  sheets_copy: { spreadsheetId: SHEET, title: 'Leads copy' },
  sheets_copy_tab: { spreadsheetId: SHEET, sheetId: 7, destinationSpreadsheetId: 'sheet-two-0002' },
  sheets_values_get: { spreadsheetId: SHEET, range: 'Leads!A1:B2' },
  sheets_values_batch_get: { spreadsheetId: SHEET, ranges: ['Leads!A1:B2'] },
  sheets_values_append: { spreadsheetId: SHEET, range: 'Leads', values: [['a', 'b']] },
  sheets_values_update: { spreadsheetId: SHEET, range: 'Leads!A1:B1', values: [['a', 'b']] },
  sheets_values_batch_update: { spreadsheetId: SHEET, data: [{ range: 'Leads!A1:B1', values: [['a', 'b']] }] },
  sheets_values_clear: { spreadsheetId: SHEET, range: 'Leads!A2:B9' },
  sheets_values_batch_clear: { spreadsheetId: SHEET, ranges: ['Leads!A2:B9'] },
  sheets_values_by_data_filter: { spreadsheetId: SHEET, action: 'clear', dataFilters: [{ a1Range: 'Leads!A2:B9' }] },
  sheets_find: { spreadsheetId: SHEET, ranges: ['Leads'], text: 'acme' },
  sheets_find_replace: { spreadsheetId: SHEET, find: 'acme', replacement: 'Acme', sheetId: 0 },
};
const EXPECTED_EFFECTS = {
  read: ['sheets_find', 'sheets_get', 'sheets_get_by_data_filter', 'sheets_values_batch_get', 'sheets_values_get'],
  write: ['sheets_copy', 'sheets_copy_tab', 'sheets_create', 'sheets_values_append'],
  destructive: ['sheets_find_replace', 'sheets_values_batch_clear', 'sheets_values_batch_update', 'sheets_values_by_data_filter', 'sheets_values_clear', 'sheets_values_update'],
};

let fake;
let projection;
let registry;
let descriptors;

/** Loads the real declaration file and modules the way the host loader hands them to the projection. */
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
      connections: { getAccessToken: async ({ connectionRef }) => { assert.equal(connectionRef, 'conn-1'); return TOKEN; } },
      http: { fetch: (target, init) => fake.fetch(target, init) },
      limiter: { check: async () => ({ allowed: true }) },
      artifacts: { write: async () => { throw new Error('no artifacts in this test'); } },
      state: { get: async ({ key }) => (key === 'products' ? { sheets: true } : null) },
    }),
  });
  assert.deepEqual(projection.sync({ loaded, refusals: [] }).refusals, []);
});
after(async () => { await fake.close(); });
beforeEach(() => { fake.reset(); });

/** Calls one tool through the projected contract handler, as the host's registry would. */
function callTool(name, input) {
  const tool = registry.list({}).find((snapshot) => snapshot.pluginId === PLUGIN).tools.find((entry) => entry.name === name);
  return tool.handler({ pluginId: PLUGIN, auth: { workspaceId: 'ws-1', principalId: 'admin-1' }, input: { connectionRef: 'conn-1', ...input } });
}

const disclose = (name, input) => projection.describeAffectedResources({ toolId: pluginToolIdFor({ pluginId: PLUGIN, name }), input: { connectionRef: 'conn-1', ...input } });
const rows = (count, width) => Array.from({ length: count }, (_, row) => Array.from({ length: width }, (_, column) => `r${row}c${column}`));
const sheetsRequests = () => fake.requests.filter((request) => request.host === 'sheets.googleapis.com');

test('vertical slice: create, append and read a spreadsheet through the real projection; RAW, bearer token only in the header, no token in any result', async () => {
  fake.route({ method: 'POST', path: '/v4/spreadsheets' }, (_req, body) => [200, { spreadsheetId: SHEET, spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/sheet-one-0001/edit', properties: { title: JSON.parse(body).properties.title }, sheets: [{ properties: { sheetId: 0, title: 'Leads', index: 0 } }] }]);
  fake.route({ method: 'POST', path: `${BASE}/values/Leads:append` }, () => [200, { tableRange: 'Leads!A1:B1', updates: { updatedRange: 'Leads!A2:B3', updatedRows: 2, updatedCells: 4 } }]);
  fake.route({ method: 'GET', path: `${BASE}/values/Leads!A1%3AB3` }, () => [200, { range: 'Leads!A1:B3', majorDimension: 'ROWS', values: [['name', 'email'], ['Ada', '=1+1'], ['Bo', 'bo@example.test']] }]);

  assert.deepEqual((await disclose('sheets_create', { title: 'Leads 2026', tabs: ['Leads'] })).resources, ['New spreadsheet "Leads 2026" in the connected Google Drive']);
  const created = await callTool('sheets_create', { title: 'Leads 2026', tabs: ['Leads'] });
  assert.deepEqual(created, { spreadsheetId: SHEET, url: 'https://docs.google.com/spreadsheets/d/sheet-one-0001/edit', title: 'Leads 2026', tabs: [{ sheetId: 0, title: 'Leads', index: 0 }] });

  const appendInput = { spreadsheetId: SHEET, range: 'Leads', values: [['Ada', '=1+1'], ['Bo', 'bo@example.test']] };
  assert.deepEqual((await disclose('sheets_values_append', appendInput)).resources, ['Append 2 row(s), 4 cell(s), after the table in Leads of spreadsheet sheet-one-0001']);
  assert.deepEqual(await callTool('sheets_values_append', appendInput), { tableRange: 'Leads!A1:B1', updatedRange: 'Leads!A2:B3', updatedRows: 2, updatedCells: 4 });

  const read = await callTool('sheets_values_get', { spreadsheetId: SHEET, range: 'Leads!A1:B3' });
  assert.deepEqual(read, { range: 'Leads!A1:B3', values: [['name', 'email'], ['Ada', '=1+1'], ['Bo', 'bo@example.test']] });

  const [create, append, get] = sheetsRequests();
  assert.deepEqual(JSON.parse(create.body), { properties: { title: 'Leads 2026' }, sheets: [{ properties: { title: 'Leads' } }] });
  assert.equal(append.query.get('valueInputOption'), 'RAW');
  assert.equal(append.query.get('insertDataOption'), 'INSERT_ROWS');
  assert.deepEqual(JSON.parse(append.body), { range: 'Leads', majorDimension: 'ROWS', values: appendInput.values });
  assert.equal(get.query.get('majorDimension'), 'ROWS');
  for (const request of [create, append, get]) assert.equal(request.headers.authorization, `Bearer ${TOKEN}`);
  assert.equal(JSON.stringify([created, read]).includes(TOKEN), false);
});

test('approval class: each Sheets tool declares exactly its reviewed effect (write → confirm, destructive → confirm + danger)', () => {
  const byEffect = { read: [], write: [], destructive: [] };
  for (const descriptor of descriptors.filter((entry) => entry.module.startsWith('tools/sheets/'))) byEffect[descriptor.effect].push(descriptor.name);
  for (const names of Object.values(byEffect)) names.sort();
  assert.deepEqual(byEffect, EXPECTED_EFFECTS);
});

test('disclosure: every write and destructive Sheets tool names what it changes before confirmation', async () => {
  for (const name of [...EXPECTED_EFFECTS.write, ...EXPECTED_EFFECTS.destructive]) {
    const disclosure = await disclose(name, SAMPLE_INPUTS[name]);
    assert.equal(disclosure.effect, EXPECTED_EFFECTS.write.includes(name) ? 'write' : 'destructive', name);
    assert.ok(disclosure.resources.length > 0 && disclosure.resources.every((line) => line.includes(SHEET) || line.includes('Leads 2026')), name);
  }
});

test('disclosure: a 100-range destructive batch stays inside the card bound and states how many ranges are not listed', async () => {
  const ranges = Array.from({ length: 100 }, (_, index) => `Leads!A${index + 1}:B${index + 1}`);
  const { resources } = await disclose('sheets_values_batch_clear', { spreadsheetId: SHEET, ranges });
  assert.equal(resources.length, 50);
  assert.equal(resources[48], 'Clear every value in Leads!A49:B49 of spreadsheet sheet-one-0001');
  assert.equal(resources[49], '… and 51 more');
});

test('bounds: a values read over 500 rows returns 500 rows and the exact continuation range', async () => {
  fake.route({ method: 'GET', path: `${BASE}/values/Leads!A1%3AB600` }, () => [200, { range: 'Leads!A1:B600', values: rows(600, 2) }]);
  const result = await callTool('sheets_values_get', { spreadsheetId: SHEET, range: 'Leads!A1:B600' });
  assert.equal(result.values.length, 500);
  assert.equal(result.continuation, 'Leads!A501:B600');
});

test('bounds: batch reads share one 5,000-cell budget; the cut range carries its continuation', async () => {
  // 100 rows x 40 cells per range: under the 500-row bound, so only the cell budget can cut.
  fake.route({ method: 'GET', path: `${BASE}/values:batchGet` }, () => [200, { valueRanges: [{ range: 'A!A1:AN100', values: rows(100, 40) }, { range: 'B!A1:AN100', values: rows(100, 40) }] }]);
  const { valueRanges } = await callTool('sheets_values_batch_get', { spreadsheetId: SHEET, ranges: ['A!A1:AN100', 'B!A1:AN100'] });
  assert.deepEqual(valueRanges.map((entry) => [entry.values.length, entry.continuation]), [[100, undefined], [25, 'B!A26:AN100']]);
});

test('bounds: more than 20 ranges are refused by the schema before any request', async () => {
  const ranges = Array.from({ length: 21 }, (_, index) => `Leads!A${index + 1}`);
  await assert.rejects(callTool('sheets_values_batch_get', { spreadsheetId: SHEET, ranges }), { name: 'ToolInputError', message: /\/ranges \(maxItems\)/ });
  assert.equal(fake.requests.length, 0);
});

test('bounds: a mutation body over 1 MiB is refused as limit-exceeded before any request', async () => {
  const values = Array.from({ length: 30 }, () => ['x'.repeat(40_000)]);
  await assert.rejects(callTool('sheets_values_update', { spreadsheetId: SHEET, range: 'Leads!A1:A30', values }), { code: 'limit-exceeded', outcome: 'not-applied' });
  assert.equal(fake.requests.length, 0);
});

test('bounds: metadata over 64 KiB is an error, never a cut result', async () => {
  fake.route({ method: 'GET', path: BASE }, () => [200, { spreadsheetId: SHEET, sheets: Array.from({ length: 2_000 }, (_, sheetId) => ({ properties: { sheetId, title: `Tab number ${sheetId}` } })) }]);
  await assert.rejects(callTool('sheets_get', { spreadsheetId: SHEET }), { code: 'limit-exceeded', nextAction: 'narrow-request' });
});

test('bounds: find refuses to scan more than 50,000 cells instead of returning a partial search', async () => {
  fake.route({ method: 'GET', path: `${BASE}/values:batchGet` }, () => [200, { valueRanges: [{ range: 'Leads!A1:Z2000', values: rows(2_000, 26) }] }]);
  await assert.rejects(callTool('sheets_find', { spreadsheetId: SHEET, ranges: ['Leads'], text: 'r1' }), { code: 'limit-exceeded' });
});

test('safe errors: a Google refusal that echoes the token and a cell value becomes a fixed message without either', async () => {
  fake.route({ method: 'PUT', path: `${BASE}/values/Leads!A1` }, () => [400, { error: { code: 400, message: `Invalid value "${CELL_SECRET}" for ${TOKEN}`, status: 'INVALID_ARGUMENT' } }]);
  const error = await callTool('sheets_values_update', { spreadsheetId: SHEET, range: 'Leads!A1', values: [[CELL_SECRET]] }).catch((caught) => caught);
  assert.equal(error.code, 'invalid-request');
  for (const text of [error.message, JSON.stringify(error)]) {
    assert.equal(text.includes(CELL_SECRET), false);
    assert.equal(text.includes(TOKEN), false);
  }
});

test('path safety: a range is one encoded path segment, so slashes, dots, query and fragment text cannot change the endpoint', async () => {
  const range = 'Leads/../../x?alt=media#frag';
  fake.route({ method: 'GET', path: `${BASE}/values/Leads%2F..%2F..%2Fx%3Falt%3Dmedia%23frag` }, () => [200, { range: 'Leads!A1:A1', values: [['ok']] }]);
  assert.deepEqual(await callTool('sheets_values_get', { spreadsheetId: SHEET, range }), { range: 'Leads!A1:A1', values: [['ok']] });
  const [request] = sheetsRequests();
  assert.equal(request.query.has('alt'), false);
});

test('path safety: a dot-segment id or range is refused before any request (schema and helper)', async () => {
  await assert.rejects(callTool('sheets_values_get', { spreadsheetId: '..', range: 'A1' }), { name: 'ToolInputError', message: /\/spreadsheetId \(pattern\)/ });
  await assert.rejects(callTool('sheets_values_clear', { spreadsheetId: SHEET, range: '..' }), { code: 'invalid-input' });
  assert.throws(() => pathSegment({ value: '.' }), { code: 'invalid-input' });
  assert.equal(fake.requests.length, 0);
});

test('query safety: batch ranges travel as separate encoded query values, so & and = in a tab name cannot add parameters', async () => {
  fake.route({ method: 'GET', path: `${BASE}/values:batchGet` }, () => [200, { valueRanges: [] }]);
  await callTool('sheets_values_batch_get', { spreadsheetId: SHEET, ranges: ["'R&D=1'!A1", 'Leads!A1'] });
  const [request] = sheetsRequests();
  assert.deepEqual(request.query.getAll('ranges'), ["'R&D=1'!A1", 'Leads!A1']);
  assert.equal(request.query.has('D'), false);
});

test('RAW: update and batch update send RAW unless USER_ENTERED is explicitly asked for', async () => {
  fake.route({ method: 'PUT', path: `${BASE}/values/Leads!A1` }, () => [200, { updatedRange: 'Leads!A1', updatedCells: 1 }]);
  fake.route({ method: 'POST', path: `${BASE}/values:batchUpdate` }, () => [200, { totalUpdatedCells: 1 }]);
  await callTool('sheets_values_update', { spreadsheetId: SHEET, range: 'Leads!A1', values: [['=IMPORTXML("x")']] });
  await callTool('sheets_values_batch_update', { spreadsheetId: SHEET, data: [{ range: 'Leads!A1', values: [['=1']] }] });
  await callTool('sheets_values_update', { spreadsheetId: SHEET, range: 'Leads!A1', values: [['=1']], valueInputOption: 'USER_ENTERED' });
  const [update, batch, explicit] = sheetsRequests();
  assert.equal(update.query.get('valueInputOption'), 'RAW');
  assert.equal(JSON.parse(batch.body).valueInputOption, 'RAW');
  assert.equal(explicit.query.get('valueInputOption'), 'USER_ENTERED');
});

/** Non-idempotent writes and the route each one calls. */
const UNCERTAIN_WRITES = [
  ['sheets_values_append', 'POST', `${BASE}/values/Leads:append`, 'sheets.googleapis.com'],
  ['sheets_create', 'POST', '/v4/spreadsheets', 'sheets.googleapis.com'],
  ['sheets_copy', 'POST', `/drive/v3/files/${SHEET}/copy`, 'www.googleapis.com'],
  ['sheets_copy_tab', 'POST', `${BASE}/sheets/7:copyTo`, 'sheets.googleapis.com'],
  ['sheets_find_replace', 'POST', `${BASE}:batchUpdate`, 'sheets.googleapis.com'],
];
for (const [name, method, path, host] of UNCERTAIN_WRITES) {
  test(`uncertain outcome: ${name} answered 503 is reported unknown and never replayed`, async () => {
    fake.route({ method, path }, () => [503, { error: { code: 503, status: 'UNAVAILABLE' } }]);
    await assert.rejects(callTool(name, SAMPLE_INPUTS[name]), { code: 'uncertain-outcome', outcome: 'unknown', retryable: false, nextAction: 'review-outcome' });
    assert.deepEqual(fake.requests.map((request) => [request.host, request.method, request.path]), [[host, method, path]]);
  });
}

test('grid data opt-in: a fields mask with * or data is refused unless includeGridData (and, for sheets_get, ranges) are given', async () => {
  for (const fields of ['*', 'sheets.data', 'sheets(data(rowData))', 'spreadsheetId,*']) {
    await assert.rejects(callTool('sheets_get', { spreadsheetId: SHEET, fields }), (error) => error.code === 'invalid-input' && error.message.includes('needs includeGridData and ranges'), fields);
    await assert.rejects(callTool('sheets_get_by_data_filter', { spreadsheetId: SHEET, dataFilters: [{ a1Range: 'Leads!A1:B2' }], fields }), (error) => error.code === 'invalid-input', fields);
  }
  await assert.rejects(callTool('sheets_get', { spreadsheetId: SHEET, fields: '*', includeGridData: true }), (error) => error.code === 'invalid-input');
  assert.equal(sheetsRequests().length, 0);
});

test('grid data opt-in: a grid mask with includeGridData and ranges is sent, and a mask naming dataSources is not grid data', async () => {
  fake.route({ method: 'GET', path: BASE }, () => [200, { spreadsheetId: SHEET }]);
  await callTool('sheets_get', { spreadsheetId: SHEET, fields: '*', includeGridData: true, ranges: ['Leads!A1:B2'] });
  await callTool('sheets_get', { spreadsheetId: SHEET, fields: 'spreadsheetId,dataSources' });
  assert.deepEqual(sheetsRequests().map((request) => request.query.get('fields')), ['*', 'spreadsheetId,dataSources']);
});
