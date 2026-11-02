/**
 * @file Security pins for the per-product on/off gate (phase-B finding H2): products are OFF until
 * the plugin's own settings say `products: { sheets: true }`, every Sheets tool (every tool named
 * with the product's `toolPrefix` in `products.json`) refuses `product-disabled` before reading a
 * token or sending anything to Google, the gate is read per request, the sign-in's own
 * `account_info` is not a product tool, and form delivery gets the same reader through
 * `productEnabledReader`. Modules run against the local fake Google only.
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { after, before, beforeEach, test } from 'node:test';

import catalog from '../products.json' with { type: 'json' };
import { PRODUCT_STATE_KEY, isProductEnabled } from '../lib/product-state.mjs';
import accountInfo from '../tools/account-info.mjs';
import { startFakeGoogle } from './fake-google-http.mjs';
import { CONNECTION, PLUGIN_ROOT, SPREADSHEET, TOKEN } from './sheets-admin-harness.mjs';

const range = { sheetId: 3, startRowIndex: 1, endRowIndex: 10, startColumnIndex: 0, endColumnIndex: 4 };
/** One input per Sheets tool that passes every local check, so only the gate can refuse it. */
const SAMPLE_INPUTS = {
  sheets_get: {}, sheets_get_by_data_filter: { dataFilters: [{ a1Range: 'Leads!A1:B2' }] },
  sheets_create: { title: 'Leads 2026' }, sheets_copy: { title: 'Leads copy' },
  sheets_copy_tab: { sheetId: 7, destinationSpreadsheetId: 'sheet2234567890abcdef' },
  sheets_values_get: { range: 'Leads!A1:B2' }, sheets_values_batch_get: { ranges: ['Leads!A1:B2'] },
  sheets_values_append: { range: 'Leads', values: [['a']] }, sheets_values_update: { range: 'Leads!A1', values: [['a']] },
  sheets_values_batch_update: { data: [{ range: 'Leads!A1', values: [['a']] }] },
  sheets_values_clear: { range: 'Leads!A2:B9' }, sheets_values_batch_clear: { ranges: ['Leads!A2:B9'] },
  sheets_values_by_data_filter: { action: 'clear', dataFilters: [{ a1Range: 'Leads!A2:B9' }] },
  sheets_find: { ranges: ['Leads'], text: 'acme' }, sheets_find_replace: { find: 'acme', replacement: 'Acme', sheetId: 0 },
  sheets_tab_modify: { action: 'delete', sheetId: 3 }, sheets_sort: { range, sortSpecs: [{ dimensionIndex: 0 }] },
  sheets_basic_filter: { action: 'clear', sheetId: 3 }, sheets_filter_views: { action: 'list' },
  sheets_format: { range, cellFormat: { textFormat: { bold: true } }, fields: ['textFormat.bold'] },
  sheets_named_ranges: { action: 'list' }, sheets_protected_ranges_get: {},
  sheets_developer_metadata: { action: 'get', metadataId: 1 }, sheets_batch_update: { requests: [{ deleteSheet: { sheetId: 3 } }] },
  sheets_export_csv: { sheetId: 0 },
  // No id: the "choose it with the picker" answer, which sends nothing to Google, is gated as well.
  sheets_open_existing: { spreadsheetId: undefined },
};
const SHEETS = catalog.products.find((product) => product.id === 'sheets');

let fake;
before(async () => { fake = await startFakeGoogle({ clients: {} }); });
after(async () => { await fake.close(); });
beforeEach(() => { fake.reset(); });

/** Capabilities over the fake with the given settings reader; counts token reads. */
function capabilitiesWith(state) {
  const counts = { tokens: 0 };
  return {
    counts,
    capabilities: {
      connections: { getAccessToken: async () => { counts.tokens += 1; return TOKEN; } },
      http: { fetch: (target, init) => fake.fetch(target, init) },
      limiter: { check: async () => ({ allowed: true }) },
      artifacts: { write: async () => ({ artifactRef: 'artifact-1' }) },
      ...(state === undefined ? {} : { state }),
    },
  };
}

const readerOf = (value) => ({ get: async ({ key }) => (key === PRODUCT_STATE_KEY ? value : null) });
const isDisabled = (error) => error.name === 'GoogleWorkspaceError' && error.code === 'product-disabled' && error.nextAction === 'enable-product'
  && error.message.includes('Google Workspace panel') && error.message.includes('(Google Sheets)') && error.outcome === 'not-applied';

/** The plugin's Sheets tools (named with the product's toolPrefix) and their loaded modules. */
async function sheetsTools() {
  const file = JSON.parse(await readFile(new URL('../tovu-agent-tools.json', import.meta.url), 'utf8'));
  const tools = file.tools.filter((tool) => tool.name.startsWith(SHEETS.toolPrefix));
  return Promise.all(tools.map(async (tool) => ({ name: tool.name, module: (await import(new URL(tool.module, new URL(`file://${PLUGIN_ROOT}/`)))).default })));
}

test('default off: with no products setting, every Sheets tool refuses product-disabled before any token read or Google request', async () => {
  const tools = await sheetsTools();
  assert.deepEqual(tools.map((tool) => tool.name).sort(), Object.keys(SAMPLE_INPUTS).sort(), 'every sheets_ tool has a sample');
  for (const { name, module } of tools) {
    const { capabilities, counts } = capabilitiesWith(readerOf(null));
    await assert.rejects(module.invoke({ input: { connectionRef: CONNECTION, spreadsheetId: SPREADSHEET, ...SAMPLE_INPUTS[name] }, capabilities }), isDisabled, name);
    assert.deepEqual({ tokens: counts.tokens, requests: fake.requests.length }, { tokens: 0, requests: 0 }, name);
  }
});

test('fail closed: any stored value other than exactly true, or no settings reader, keeps Sheets off', async () => {
  const [{ module }] = (await sheetsTools()).filter((tool) => tool.name === 'sheets_values_get');
  for (const state of [readerOf({ sheets: false }), readerOf({ sheets: 'true' }), readerOf({ sheets: 1 }), readerOf(['sheets']), readerOf('sheets'), readerOf({ docs: true }), undefined]) {
    const { capabilities } = capabilitiesWith(state);
    await assert.rejects(module.invoke({ input: { connectionRef: CONNECTION, spreadsheetId: SPREADSHEET, range: 'Leads!A1' }, capabilities }), isDisabled, JSON.stringify(state));
  }
  assert.equal(fake.requests.length, 0);
});

test('on: products.sheets === true lets a Sheets tool reach Google, and the gate reads only the products key', async () => {
  fake.route({ method: 'GET', path: `/v4/spreadsheets/${SPREADSHEET}/values/Leads!A1` }, () => [200, { range: 'Leads!A1', values: [['a']] }]);
  const keys = [];
  const { capabilities } = capabilitiesWith({ get: async ({ key }) => { keys.push(key); return { sheets: true }; } });
  const [{ module }] = (await sheetsTools()).filter((tool) => tool.name === 'sheets_values_get');
  assert.deepEqual(await module.invoke({ input: { connectionRef: CONNECTION, spreadsheetId: SPREADSHEET, range: 'Leads!A1' }, capabilities }), { range: 'Leads!A1', values: [['a']] });
  assert.deepEqual(keys, ['products']);
});

test('per request: Sheets turned off during a multi-request export stops it before the next request', async () => {
  fake.route({ method: 'GET', path: `/v4/spreadsheets/${SPREADSHEET}` }, () => [200, { sheets: [{ properties: { sheetId: 0, title: 'Leads', gridProperties: { rowCount: 2, columnCount: 2 } } }] }]);
  let enabled = true;
  const { capabilities } = capabilitiesWith({ get: async () => { const value = { sheets: enabled }; enabled = false; return value; } });
  const [{ module }] = (await sheetsTools()).filter((tool) => tool.name === 'sheets_export_csv');
  await assert.rejects(module.invoke({ input: { connectionRef: CONNECTION, spreadsheetId: SPREADSHEET, sheetId: 0 }, capabilities }), isDisabled);
  assert.equal(fake.requests.length, 1, 'only the metadata read was sent');
});

test('account_info is the sign-in, not a product: it answers while every product is off', async () => {
  fake.route({ method: 'GET', path: '/drive/v3/about' }, () => [200, { user: { permissionId: 'perm-alice', emailAddress: 'alice@example.test' } }]);
  const { capabilities } = capabilitiesWith(readerOf(null));
  assert.deepEqual(await accountInfo.invoke({ input: { connectionRef: CONNECTION }, capabilities }), { accountId: 'perm-alice', displayName: 'alice@example.test' });
});

test('form delivery gate: isProductEnabled (over the state reader the host hands delivery) is true only for products.sheets === true, and false with no reader', async () => {
  assert.equal(await isProductEnabled({ state: readerOf({ sheets: true }), productId: 'sheets' }), true);
  assert.equal(await isProductEnabled({ state: readerOf({ sheets: false }), productId: 'sheets' }), false);
  assert.equal(await isProductEnabled({ state: readerOf(null), productId: 'sheets' }), false);
  assert.equal(await isProductEnabled({ productId: 'sheets' }), false);
});
