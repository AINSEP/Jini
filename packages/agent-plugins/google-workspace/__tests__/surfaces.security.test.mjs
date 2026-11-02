/**
 * @file Security pins for the plugin's admin surfaces (phase A, G13b), through the real Jini handler
 * host and dispatcher: the declared allowlists (start params, callback field, public config, CSP),
 * input validation, Picker sessions and desktop attempts, "verified before saved", "cancel changes
 * nothing", no token in any action result (only the hosted bootstrap carries the short-lived access
 * token), and the honest revocation wording. Google is the 127.0.0.1 fake; any other host throws.
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { after, before, beforeEach, test } from 'node:test';

import { readAdminSurfaceFile } from '@jini-ai/agent-plugins/admin-surfaces';

import { GOOGLE_ACCOUNT_ACCESS_PAGE } from '../lib/auth.mjs';
import { DESKTOP_PICKER_START_PARAMS } from '../lib/picker-selection.mjs';
import { PICKED_SPREADSHEETS_KEY, PICKER_SESSION_TTL_MS } from '../lib/picker-flow.mjs';
import { REVOCATION_PENDING_TEXT, connectionSummary, revocationMessage } from '../ui/connection-view.mjs';
import { startFakeGoogle } from './fake-google-http.mjs';
import { FILE_ID, OTHER_FILE_ID, TOKEN, bootSurfaces, createHostPorts, serveGoogle, surfaceDescriptors } from './surface-harness.mjs';

const PICKER_CONFIG = { TOVU_GOOGLE_PICKER_BROWSER_KEY: 'browser-key-placeholder', TOVU_GOOGLE_PICKER_APP_ID: '123456789' };
const SESSION = 'session-0123456789abcdef';
let fake;
let clock;

before(async () => { fake = await startFakeGoogle({ clients: {} }); });
after(async () => { await fake.close(); });
beforeEach(() => { fake.reset(); clock = Date.parse('2030-01-01T00:00:00Z'); });

async function boot(options = {}) {
  const { hostKind = 'hosted', ...portOptions } = options;
  const ports = createHostPorts({ publicConfig: PICKER_CONFIG, ...portOptions });
  ports.state.set('products', { sheets: true });
  const surfaces = await bootSurfaces({ fake, ports }, { now: () => clock, randomId: () => SESSION, hostKind });
  return { ports, surfaces };
}

const settings = (ports) => JSON.stringify([ports.state.get(PICKED_SPREADSHEETS_KEY), ports.bindings]);
const googleRequests = () => fake.requests.length;

// --- declarations -------------------------------------------------------------------------------

test('CSP: only the hosted Picker surfaces add sources, exactly apis.google.com scripts and docs.google.com frames', async () => {
  const csp = Object.fromEntries((await surfaceDescriptors()).map((surface) => [surface.id, surface.csp]));
  const picker = { 'script-src': ['https://apis.google.com'], 'frame-src': ['https://docs.google.com'] };
  assert.deepEqual(csp, { connection: {}, picker, 'form-destinations': picker });
  // The header the host serves the picker entry with (the CSP builder itself is internal to Jini).
  const pickerDescriptor = (await surfaceDescriptors()).find((surface) => surface.id === 'picker');
  const served = await readAdminSurfaceFile({ surface: { plugin: {}, descriptor: pickerDescriptor }, path: pickerDescriptor.entry, readFile: async () => '' });
  const header = served.headers['Content-Security-Policy'];
  assert.match(header, /connect-src 'none'/);
  assert.match(header, /script-src 'self' https:\/\/apis\.google\.com;/);
  assert.match(header, /frame-src https:\/\/docs\.google\.com;/);
});

test('declarations: only the connection panel may open a link, only to the Google Account page origin it shows', async () => {
  const linkOrigins = Object.fromEntries((await surfaceDescriptors()).map((surface) => [surface.id, surface.linkOrigins ?? []]));
  assert.deepEqual(linkOrigins, { connection: ['https://myaccount.google.com'], picker: [], 'form-destinations': [] });
  assert.equal(new URL(GOOGLE_ACCOUNT_ACCESS_PAGE).origin, linkOrigins.connection[0]);
});

test('declarations: Picker surfaces declare exactly the desktop start params, the picked_file_ids field and the two public Picker names; the connection panel none; the binding surfaces only the Sheets adapter', async () => {
  const descriptors = await surfaceDescriptors();
  const connectionsFile = JSON.parse(await readFile(new URL('../tovu-connections.json', import.meta.url), 'utf8')).connections[0];
  const declared = Object.fromEntries(descriptors.map((surface) => [surface.id, { connections: surface.connections, publicConfig: surface.publicConfig ?? [] }]));
  const pickerConnection = [{ id: 'account', startParams: Object.keys(DESKTOP_PICKER_START_PARAMS), callbackFields: ['picked_file_ids'] }];
  const publicConfig = ['TOVU_GOOGLE_PICKER_BROWSER_KEY', 'TOVU_GOOGLE_PICKER_APP_ID'];
  assert.deepEqual(declared, {
    connection: { connections: [{ id: 'account', startParams: [], callbackFields: [] }], publicConfig: [] },
    picker: { connections: pickerConnection, publicConfig },
    'form-destinations': { connections: pickerConnection, publicConfig },
  });
  // The two surfaces that read or write form-delivery bindings name exactly this plugin's Sheets adapter
  // (`tovu-form-destinations.json`); the Picker surface touches no binding.
  const destinationsFile = JSON.parse(await readFile(new URL('../tovu-form-destinations.json', import.meta.url), 'utf8'));
  assert.deepEqual(Object.fromEntries(descriptors.map((surface) => [surface.id, surface.deliveryAdapters ?? []])), {
    connection: [destinationsFile.destinations[0].id], picker: [], 'form-destinations': [destinationsFile.destinations[0].id],
  });
  // Every declared start param and callback field is one the connection descriptor allowlists.
  assert.deepEqual(connectionsFile.startParams.map((param) => param.name), pickerConnection[0].startParams);
  assert.deepEqual(connectionsFile.callbackFields.map((field) => field.name), ['picked_file_ids']);
});

// --- bootstrap and tokens -----------------------------------------------------------------------

for (const [label, options, reason] of [
  ['not connected', { connected: false }, 'not-connected'],
  ['Sheets permission not granted', { granted: [] }, 'missing-permission'],
]) {
  test(`bootstrap: ${label} → unavailable (${reason}), no access token requested or returned`, async () => {
    const { ports, surfaces } = await boot(options);
    const bootstrap = await surfaces.bootstrap('picker');
    assert.equal(bootstrap.mode, 'unavailable');
    assert.equal(bootstrap.reason, reason);
    assert.equal(ports.calls.getAccessToken, 0);
    assert.equal(JSON.stringify(bootstrap).includes(TOKEN), false);
  });
}

test('bootstrap: Sheets turned off → unavailable (product-disabled), no access token', async () => {
  const { ports, surfaces } = await boot();
  ports.state.set('products', { sheets: false });
  assert.deepEqual(await surfaces.bootstrap('picker'), { mode: 'unavailable', reason: 'product-disabled', message: 'This Google product is turned off. Turn it on in the Google Workspace panel, then retry; the Google sign-in is kept.' });
  assert.equal(ports.calls.getAccessToken, 0);
});

test('bootstrap: a hosted site without both public Picker values is unavailable (picker-not-configured) and hands out no token', async () => {
  const { ports, surfaces } = await boot({ publicConfig: { TOVU_GOOGLE_PICKER_BROWSER_KEY: 'browser-key-placeholder' } });
  const bootstrap = await surfaces.bootstrap('picker');
  assert.equal(bootstrap.mode, 'unavailable');
  assert.equal(bootstrap.reason, 'picker-not-configured');
  assert.equal(ports.calls.getAccessToken, 0);
});

test('bootstrap: the host kind decides the flow, not the config: a desktop host gets the system-browser Picker with both values set, and no token', async () => {
  const { ports, surfaces } = await boot({ hostKind: 'desktop' });
  assert.deepEqual(await surfaces.bootstrap('picker'), { mode: 'system-browser' });
  assert.deepEqual(await surfaces.bootstrap('form-destinations'), { mode: 'system-browser' });
  assert.equal(ports.calls.getAccessToken, 0);
});

test('tokens: the hosted bootstrap carries the access token only as picker.accessToken; the stored Picker session holds none', async () => {
  serveGoogle(fake);
  const { ports, surfaces } = await boot();
  const bootstrap = await surfaces.bootstrap('picker');
  assert.equal(bootstrap.picker.accessToken, TOKEN);
  assert.equal(JSON.stringify({ ...bootstrap, picker: { ...bootstrap.picker, accessToken: '' } }).includes(TOKEN), false);
  assert.deepEqual(ports.state.get('picker-session:picker'), { id: SESSION, accountId: 'perm-alice', expiresAt: clock + PICKER_SESSION_TTL_MS });
});

test('tokens: no action result or failure of any surface mentions the access token', async () => {
  serveGoogle(fake);
  const { surfaces } = await boot();
  await surfaces.bootstrap('picker');
  const outcomes = [
    await surfaces.dispatch('picker', 'verify-picked', { sessionId: SESSION, fileId: FILE_ID }),
    await surfaces.dispatch('picker', 'list-picked'),
    await surfaces.dispatch('picker', 'start-system-picker'),
    await surfaces.dispatch('form-destinations', 'list-tabs', { spreadsheetId: FILE_ID }),
    await surfaces.dispatch('form-destinations', 'save-destination', { formSlug: 'contact', spreadsheetId: FILE_ID, sheetId: 7, confirmExternalRows: true }),
    await surfaces.dispatch('connection', 'status'),
    await surfaces.dispatch('connection', 'sign-in', { action: 'reconnect' }),
  ];
  assert.equal(outcomes.every((outcome) => outcome.ok), true, JSON.stringify(outcomes.filter((outcome) => !outcome.ok)));
  assert.equal(JSON.stringify(outcomes).includes(TOKEN), false);
});

// --- hosted Picker selection --------------------------------------------------------------------

test('hosted: a session id the bootstrap did not issue is refused (picker-expired) before any Google request; nothing saved', async () => {
  serveGoogle(fake);
  const { ports, surfaces } = await boot();
  await surfaces.bootstrap('picker');
  const before = googleRequests();
  const outcome = await surfaces.dispatch('picker', 'verify-picked', { sessionId: 'session-forged-0000000000', fileId: FILE_ID });
  assert.equal(outcome.error.code, 'picker-expired');
  assert.equal(googleRequests(), before);
  assert.equal(ports.state.has(PICKED_SPREADSHEETS_KEY), false);
});

test('hosted: an expired Picker session is refused (picker-expired); nothing saved', async () => {
  serveGoogle(fake);
  const { ports, surfaces } = await boot();
  await surfaces.bootstrap('picker');
  clock += PICKER_SESSION_TTL_MS;
  assert.equal((await surfaces.dispatch('picker', 'verify-picked', { sessionId: SESSION, fileId: FILE_ID })).error.code, 'picker-expired');
  assert.equal(ports.state.has(PICKED_SPREADSHEETS_KEY), false);
});

test('hosted: a session opened by another surface does not authorize this one (picker-expired)', async () => {
  serveGoogle(fake);
  const { surfaces } = await boot();
  await surfaces.bootstrap('form-destinations');
  assert.equal((await surfaces.dispatch('picker', 'verify-picked', { sessionId: SESSION, fileId: FILE_ID })).error.code, 'picker-expired');
});

for (const bad of ['../about', 'abc?x=1', 'short', `${FILE_ID}/copy`]) {
  test(`hosted: file id ${JSON.stringify(bad)} is refused (invalid-selection) before any file request, never echoed`, async () => {
    serveGoogle(fake);
    const { ports, surfaces } = await boot();
    await surfaces.bootstrap('picker');
    const before = googleRequests();
    const outcome = await surfaces.dispatch('picker', 'verify-picked', { sessionId: SESSION, fileId: bad });
    assert.equal(outcome.error.code, 'invalid-selection');
    assert.equal(outcome.error.message.includes(bad), false);
    assert.equal(googleRequests(), before);
    assert.equal(ports.state.has(PICKED_SPREADSHEETS_KEY), false);
  });
}

test('hosted: a file picked while signed in as another account is refused (account-changed); nothing saved', async () => {
  serveGoogle(fake);
  const { ports, surfaces } = await boot();
  await surfaces.bootstrap('picker');
  serveGoogle(fake, { accountId: 'perm-bob' });
  assert.equal((await surfaces.dispatch('picker', 'verify-picked', { sessionId: SESSION, fileId: FILE_ID })).error.code, 'account-changed');
  assert.equal(ports.state.has(PICKED_SPREADSHEETS_KEY), false);
});

test('hosted: a picked file that is not a spreadsheet is refused (not-a-spreadsheet) with the fixed message; nothing saved', async () => {
  serveGoogle(fake, { mimeType: 'application/vnd.google-apps.document' });
  const { ports, surfaces } = await boot();
  await surfaces.bootstrap('picker');
  const outcome = await surfaces.dispatch('picker', 'verify-picked', { sessionId: SESSION, fileId: FILE_ID });
  assert.deepEqual(outcome.error, { code: 'not-a-spreadsheet', message: 'The chosen file is not a Google Sheets spreadsheet. Choose a spreadsheet, or create a new one.', retryable: false });
  assert.equal(ports.state.has(PICKED_SPREADSHEETS_KEY), false);
});

// --- desktop native Picker ----------------------------------------------------------------------

test('desktop: start begins a reconnect for the Sheets scope set with exactly the native Picker start params; the frame gets no link or attempt id', async () => {
  serveGoogle(fake);
  const { ports, surfaces } = await boot({ publicConfig: {} });
  const outcome = await surfaces.dispatch('picker', 'start-system-picker');
  assert.deepEqual(ports.calls.begin, [{ connectionId: 'account', action: 'reconnect', scopeSetIds: ['sheets'], startParams: { ...DESKTOP_PICKER_START_PARAMS } }]);
  assert.deepEqual(outcome, { ok: true, result: { expiresAt: '2030-01-01T00:10:00.000Z' } });
  assert.deepEqual(ports.state.get('picker-attempt:picker'), { attemptId: 'attempt-1', accountId: 'perm-alice', expiresAt: Date.parse('2030-01-01T00:10:00Z') });
});

test('desktop: start is refused while Sheets is off (product-disabled), before any sign-in begins', async () => {
  const { ports, surfaces } = await boot({ publicConfig: {} });
  ports.state.set('products', {});
  assert.equal((await surfaces.dispatch('picker', 'start-system-picker')).error.code, 'product-disabled');
  assert.deepEqual(ports.calls.begin, []);
});

async function startDesktop() {
  serveGoogle(fake);
  const booted = await boot({ publicConfig: {}, hostKind: 'desktop' });
  await booted.surfaces.dispatch('picker', 'start-system-picker');
  return booted;
}

test('desktop: before the callback arrives the poll says waiting and changes nothing', async () => {
  const { ports, surfaces } = await startDesktop();
  assert.deepEqual(await surfaces.dispatch('picker', 'finish-system-picker'), { ok: true, result: { status: 'waiting' } });
  assert.equal(ports.state.has('picker-attempt:picker'), true);
  assert.equal(ports.state.has(PICKED_SPREADSHEETS_KEY), false);
});

test('desktop: a cancelled Picker (no picked_file_ids) reports cancelled and leaves the saved spreadsheets unchanged', async () => {
  const { ports, surfaces } = await startDesktop();
  ports.state.set(PICKED_SPREADSHEETS_KEY, [{ spreadsheetId: OTHER_FILE_ID, title: 'Old', url: 'x', accountId: 'perm-alice' }]);
  const before = settings(ports);
  ports.inbox.set('attempt-1', {});
  assert.deepEqual(await surfaces.dispatch('picker', 'finish-system-picker'), { ok: true, result: { status: 'cancelled' } });
  assert.equal(settings(ports), before);
  assert.equal(ports.state.has('picker-attempt:picker'), false);
});

test('desktop: a picked id is verified through Google before it is saved; a non-spreadsheet is refused and nothing saved', async () => {
  const { ports, surfaces } = await startDesktop();
  serveGoogle(fake, { mimeType: 'application/pdf' });
  ports.inbox.set('attempt-1', { picked_file_ids: FILE_ID });
  assert.equal((await surfaces.dispatch('picker', 'finish-system-picker')).error.code, 'not-a-spreadsheet');
  assert.equal(ports.state.has(PICKED_SPREADSHEETS_KEY), false);
});

test('desktop: a callback carrying more than one id is refused (invalid-selection); nothing saved', async () => {
  const { ports, surfaces } = await startDesktop();
  ports.inbox.set('attempt-1', { picked_file_ids: `${FILE_ID},${OTHER_FILE_ID}` });
  assert.equal((await surfaces.dispatch('picker', 'finish-system-picker')).error.code, 'invalid-selection');
  assert.equal(ports.state.has(PICKED_SPREADSHEETS_KEY), false);
});

test('desktop: the picked file must belong to the account the Picker was started for (account-changed)', async () => {
  const { ports, surfaces } = await startDesktop();
  serveGoogle(fake, { accountId: 'perm-bob' });
  ports.inbox.set('attempt-1', { picked_file_ids: FILE_ID });
  assert.equal((await surfaces.dispatch('picker', 'finish-system-picker')).error.code, 'account-changed');
  assert.equal(ports.state.has(PICKED_SPREADSHEETS_KEY), false);
});

test('desktop: an expired attempt reports expired, is forgotten, and never reads the callback inbox', async () => {
  const { ports, surfaces } = await startDesktop();
  ports.inbox.set('attempt-1', { picked_file_ids: FILE_ID });
  clock = Date.parse('2030-01-01T00:10:00Z');
  assert.deepEqual((await surfaces.dispatch('picker', 'finish-system-picker')).result, { status: 'expired' });
  assert.equal(ports.inbox.has('attempt-1'), true);
  assert.equal(ports.state.has(PICKED_SPREADSHEETS_KEY), false);
});

test('desktop: a verified pick is saved as metadata only and the attempt is consumed', async () => {
  const { ports, surfaces } = await startDesktop();
  ports.inbox.set('attempt-1', { picked_file_ids: FILE_ID });
  const outcome = await surfaces.dispatch('picker', 'finish-system-picker');
  assert.deepEqual(outcome.result, { status: 'selected', spreadsheet: { spreadsheetId: FILE_ID, title: 'Leads', url: `https://docs.google.com/spreadsheets/d/${FILE_ID}/edit` } });
  assert.deepEqual(ports.state.get(PICKED_SPREADSHEETS_KEY), [{ spreadsheetId: FILE_ID, title: 'Leads', url: `https://docs.google.com/spreadsheets/d/${FILE_ID}/edit`, accountId: 'perm-alice' }]);
  assert.deepEqual((await surfaces.dispatch('picker', 'finish-system-picker')).result, { status: 'none' });
});

// --- form destinations --------------------------------------------------------------------------

for (const formSlug of ['__proto__', 'Contact Form', '../x', '-lead']) {
  test(`destination: form name ${JSON.stringify(formSlug)} is refused (invalid-destination) before any Google request`, async () => {
    serveGoogle(fake);
    const { ports, surfaces } = await boot();
    const outcome = await surfaces.dispatch('form-destinations', 'save-destination', { formSlug, spreadsheetId: FILE_ID, sheetId: 7, confirmExternalRows: true });
    assert.equal(outcome.error.code, 'invalid-destination');
    assert.equal(googleRequests(), 0);
    assert.deepEqual(ports.bindings, []);
  });
}

test('destination: saving without confirming that rows stay in the spreadsheet is refused (confirm-external-rows); nothing saved', async () => {
  serveGoogle(fake);
  const { ports, surfaces } = await boot();
  assert.equal((await surfaces.dispatch('form-destinations', 'save-destination', { formSlug: 'contact', spreadsheetId: FILE_ID, sheetId: 7, confirmExternalRows: false })).error.code, 'confirm-external-rows');
  assert.deepEqual(ports.bindings, []);
});

test('destination: a pasted spreadsheet id the account was never granted is refused (file-not-granted); nothing saved', async () => {
  serveGoogle(fake, { fileStatus: 404 });
  const { ports, surfaces } = await boot();
  const outcome = await surfaces.dispatch('form-destinations', 'save-destination', { formSlug: 'contact', spreadsheetId: FILE_ID, sheetId: 7, confirmExternalRows: true });
  assert.equal(outcome.error.code, 'file-not-granted');
  assert.equal(outcome.error.message.includes(FILE_ID), false);
  assert.deepEqual(ports.bindings, []);
});

test('destination: a sheet id that is not a tab of the spreadsheet is refused (tab-not-found); nothing saved', async () => {
  serveGoogle(fake);
  const { ports, surfaces } = await boot();
  assert.equal((await surfaces.dispatch('form-destinations', 'save-destination', { formSlug: 'contact', spreadsheetId: FILE_ID, sheetId: 99, confirmExternalRows: true })).error.code, 'tab-not-found');
  assert.deepEqual(ports.bindings, []);
});

// --- account actions and products ---------------------------------------------------------------

test('products: turning Sheets on is a settings write only; it starts no sign-in (granting is the separate add-scopes step)', async () => {
  const { ports, surfaces } = await boot();
  ports.state.set('products', {});
  await surfaces.dispatch('connection', 'set-product', { productId: 'sheets', enabled: true });
  assert.deepEqual(ports.state.get('products'), { sheets: true });
  assert.deepEqual(ports.calls.begin, []);
});

test('products: turning Sheets off never disconnects or revokes the Google sign-in', async () => {
  const { ports, surfaces } = await boot();
  await surfaces.dispatch('connection', 'set-product', { productId: 'sheets', enabled: false });
  assert.deepEqual(ports.state.get('products'), { sheets: false });
  assert.equal(ports.calls.disconnect, 0);
});

test('products: a product id the catalog does not declare is refused by the schema (invalid-payload); settings unchanged', async () => {
  const { ports, surfaces } = await boot();
  const outcome = await surfaces.dispatch('connection', 'set-product', { productId: 'gmail', enabled: true });
  assert.equal(outcome.error.code, 'invalid-payload');
  assert.deepEqual(ports.state.get('products'), { sheets: true });
});

test('sign-in: the panel never returns the authorization link (the host page opens host-issued links only)', async () => {
  const { surfaces } = await boot();
  const outcome = await surfaces.dispatch('connection', 'sign-in', { action: 'connect' });
  assert.deepEqual(outcome, { ok: true, result: { expiresAt: '2030-01-01T00:10:00.000Z' } });
});

test('revoke: a pending Google revocation is reported as pending (never confirmed) with the account-access page', async () => {
  const { surfaces } = await boot({ revocation: 'pending' });
  const outcome = await surfaces.dispatch('connection', 'disconnect');
  assert.equal(outcome.result.revocation, 'pending');
  assert.equal(outcome.result.connection.status, 'revocation-pending');
  assert.equal(outcome.result.accountAccessUrl, 'https://myaccount.google.com/connections');
});

test('revoke wording: pending says "Disconnected locally; Google revocation pending" and never claims success; only confirmed says Google confirmed', () => {
  const pending = revocationMessage({ revocation: 'pending' });
  assert.equal(pending.startsWith(`${REVOCATION_PENDING_TEXT}.`), true);
  assert.equal(/confirmed that|revoked/i.test(pending), false);
  assert.equal(revocationMessage({ revocation: 'unexpected' }), pending);
  assert.equal(revocationMessage({ revocation: 'not-needed' }).includes('confirmed'), false);
  assert.match(revocationMessage({ revocation: 'confirmed' }), /Google confirmed/);
  const summary = connectionSummary({ connection: { status: 'revocation-pending' } });
  assert.equal(summary.heading, REVOCATION_PENDING_TEXT);
  assert.deepEqual(summary.buttons.map((entry) => entry.action), ['retry-revocation', 'connect']);
});

test('switch: a staged switch names the new account and offers confirm/cancel only; nothing changes until confirmed', () => {
  const summary = connectionSummary({ connection: { status: 'connected', accountLabel: 'alice@example.test', pendingSwitchAccountLabel: 'bob@example.test' } });
  assert.equal(summary.heading, 'Switch to bob@example.test?');
  assert.deepEqual(summary.buttons.map((entry) => entry.action), ['confirm-switch', 'cancel-switch']);
  assert.match(summary.detail, /Nothing changes until you confirm/);
  assert.match(summary.detail, /Form destinations stay with the account their spreadsheet was chosen with/);
  assert.match(summary.detail, /keeps the old account: its deliveries fail with "Reconnect required"/);
  assert.equal(/act as the new account, which may/.test(summary.detail), false);
});

test('failures: a host error without a safe code reaches the frame only as the generic action-failed, never its text', async () => {
  const { ports, surfaces } = await boot();
  ports.connections.status = async () => { throw new Error('vault row /srv/data/secrets.db locked'); };
  const outcome = await surfaces.dispatch('connection', 'status');
  assert.equal(outcome.error.code, 'action-failed');
  assert.equal(outcome.error.message.includes('secrets.db'), false);
});
