/**
 * @file Contract pins for the three admin-surface handler modules (`ui/*.handler.mjs`) through the
 * real Jini handler host and action dispatcher (payload and result schemas included): the account
 * switch actions, the connection view's optional fields, the scope set a sign-in asks for, the
 * destination list (with and without a usable account), removing a destination, the 50-destination
 * ceiling, odd tab answers from Google, the picked-file list (one entry per file, newest first, at
 * most 10) and the default Picker session id. Host ports are the typed in-memory ones of
 * `surface-harness.mjs`; Google is the local fake (throws for every non-Google host).
 */
import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';

import { MAX_FORM_DESTINATIONS } from '../lib/form-destination-settings.mjs';
import { PICKED_SPREADSHEETS_KEY, rememberPickedSpreadsheet } from '../lib/picker-flow.mjs';
import { startFakeGoogle } from './fake-google-http.mjs';
import { FILE_ID, OTHER_FILE_ID, bootSurfaces, createHostPorts, destinationBinding, serveGoogle } from './surface-harness.mjs';

const PICKER_CONFIG = { TOVU_GOOGLE_PICKER_BROWSER_KEY: 'browser-key-placeholder', TOVU_GOOGLE_PICKER_APP_ID: '123456789' };
const SAVED_VIEW = { spreadsheetId: FILE_ID, title: 'Leads', url: `https://docs.google.com/spreadsheets/d/${FILE_ID}/edit`, sheetId: 7, tabTitle: 'Leads' };

let fake;
before(async () => { fake = await startFakeGoogle({ clients: {} }); });
after(async () => { await fake.close(); });
beforeEach(() => { fake.reset(); });

async function boot(options = {}, optional = { randomId: () => 'session-0123456789abcdef' }) {
  const ports = createHostPorts({ publicConfig: PICKER_CONFIG, ...options });
  ports.state.set('products', { sheets: true });
  return { ports, surfaces: await bootSurfaces({ fake, ports }, optional) };
}

// --- connection panel ---------------------------------------------------------------------------

test('connection: a staged account switch is shown with the pending account label', async () => {
  const { ports, surfaces } = await boot();
  ports.connection.pendingSwitchAccountLabel = 'Bob';
  const { result } = await surfaces.dispatch('connection', 'status');
  assert.deepEqual(result.connection, { status: 'connected', grantedProducts: ['sheets'], accountLabel: 'Alice', pendingSwitchAccountLabel: 'Bob' });
});

test('connection: the status lists the form destinations a switch would affect, read from the delivery bindings', async () => {
  const { ports, surfaces } = await boot();
  ports.bindings.push(destinationBinding('contact', { tabTitle: 'Contact' }), { ...destinationBinding('signup'), adapterId: 'other-rows' });
  const { result } = await surfaces.dispatch('connection', 'status');
  assert.deepEqual(result.destinations, [{ formSlug: 'contact', title: 'Leads', tabTitle: 'Contact' }]);
});

test('connection: confirm-switch asks the host to confirm and answers with the new account', async () => {
  const { ports, surfaces } = await boot();
  ports.connection.pendingSwitchAccountLabel = 'Bob';
  const outcome = await surfaces.dispatch('connection', 'confirm-switch', { reassign: [] });
  assert.equal(ports.calls.confirmSwitch, 1);
  assert.deepEqual(outcome.result.connection, { status: 'connected', grantedProducts: ['sheets'], accountLabel: 'Bob' });
});

test('connection: confirm-switch with nothing ticked moves no destination and sends nothing to Google', async () => {
  const { ports, surfaces } = await boot();
  ports.connection.pendingSwitchAccountLabel = 'Bob';
  ports.bindings.push(destinationBinding('contact'));
  const outcome = await surfaces.dispatch('connection', 'confirm-switch', { reassign: [] });
  assert.deepEqual(outcome.result.reassignment, { moved: [], failed: [] });
  assert.deepEqual([ports.bindings[0].config.accountId, fake.requests.length], ['perm-alice', 0]);
});

test('connection: a ticked destination is checked with the new account, then saved with its account id; an unticked one keeps the old account', async () => {
  serveGoogle(fake, { accountId: 'perm-bob' });
  const { ports, surfaces } = await boot();
  ports.connection.pendingSwitchAccountLabel = 'Bob';
  ports.bindings.push(destinationBinding('contact', { title: 'Old title' }), destinationBinding('signup'));
  const outcome = await surfaces.dispatch('connection', 'confirm-switch', { reassign: ['contact'] });
  assert.deepEqual(outcome.result.reassignment, { moved: ['contact'], failed: [] });
  assert.deepEqual(ports.bindings.map((binding) => [binding.bindingId, binding.config.accountId, binding.config.title]), [['binding-contact', 'perm-bob', 'Leads'], ['binding-signup', 'perm-alice', 'Leads']]);
  assert.deepEqual(ports.bindings[0].config.tabs, { contact: { sheetId: 7 } });
  assert.deepEqual(fake.requests.map((request) => request.path), ['/drive/v3/about', `/drive/v3/files/${FILE_ID}`, `/v4/spreadsheets/${FILE_ID}`]);
});

test('connection: a destination ticked twice is moved once', async () => {
  serveGoogle(fake, { accountId: 'perm-bob' });
  const { ports, surfaces } = await boot();
  ports.connection.pendingSwitchAccountLabel = 'Bob';
  ports.bindings.push(destinationBinding('contact'));
  const outcome = await surfaces.dispatch('connection', 'confirm-switch', { reassign: ['contact', 'contact'] });
  assert.deepEqual(outcome.result.reassignment, { moved: ['contact'], failed: [] });
});

test('connection: reassigning enabled and disabled destinations preserves each binding state', async () => {
  serveGoogle(fake, { accountId: 'perm-bob' });
  const { ports, surfaces } = await boot();
  ports.connection.pendingSwitchAccountLabel = 'Bob';
  ports.bindings.push(destinationBinding('contact'), { ...destinationBinding('signup'), enabled: false });
  const outcome = await surfaces.dispatch('connection', 'confirm-switch', { reassign: ['signup', 'contact'] });
  assert.deepEqual(outcome.result.reassignment, { moved: ['signup', 'contact'], failed: [] });
  assert.deepEqual(ports.bindings.map((binding) => [binding.bindingId, binding.config.accountId, binding.enabled]), [
    ['binding-contact', 'perm-bob', true], ['binding-signup', 'perm-bob', false],
  ]);
});

test('connection: a ticked destination the new account cannot open is listed with the plugin message and left unchanged', async () => {
  serveGoogle(fake, { accountId: 'perm-bob', fileStatus: 404 });
  const { ports, surfaces } = await boot();
  ports.connection.pendingSwitchAccountLabel = 'Bob';
  ports.bindings.push(destinationBinding('contact'));
  const outcome = await surfaces.dispatch('connection', 'confirm-switch', { reassign: ['contact'] });
  assert.equal(outcome.ok, true);
  assert.deepEqual(outcome.result.reassignment.failed.map((entry) => [entry.formSlug, entry.code]), [['contact', 'file-not-granted']]);
  assert.equal(outcome.result.reassignment.failed[0].message.includes(FILE_ID), false);
  assert.deepEqual(ports.bindings[0], destinationBinding('contact'));
});

test('connection: a ticked form with no saved destination is listed as destination-not-found', async () => {
  serveGoogle(fake, { accountId: 'perm-bob' });
  const { ports, surfaces } = await boot();
  ports.connection.pendingSwitchAccountLabel = 'Bob';
  const outcome = await surfaces.dispatch('connection', 'confirm-switch', { reassign: ['signup'] });
  assert.deepEqual(outcome.result.reassignment, { moved: [], failed: [{ formSlug: 'signup', code: 'destination-not-found', message: 'This form destination is no longer saved. Reload the panel and check Form destinations.' }] });
});

test('connection: when the new account cannot be read every ticked destination is listed and none moves', async () => {
  const { ports, surfaces } = await boot();
  ports.state.set('products', { sheets: false });
  ports.connection.pendingSwitchAccountLabel = 'Bob';
  ports.bindings.push(destinationBinding('contact'), destinationBinding('signup'));
  const outcome = await surfaces.dispatch('connection', 'confirm-switch', { reassign: ['contact', 'signup'] });
  assert.deepEqual(outcome.result.reassignment.failed.map((entry) => [entry.formSlug, entry.code]), [['contact', 'product-disabled'], ['signup', 'product-disabled']]);
  assert.deepEqual([ports.bindings.map((binding) => binding.config.accountId), fake.requests.length], [['perm-alice', 'perm-alice'], 0]);
});

test('connection: a host failure while saving a moved destination is listed with the fixed sentence, never the host text', async () => {
  serveGoogle(fake, { accountId: 'perm-bob' });
  const { ports, surfaces } = await boot();
  ports.connection.pendingSwitchAccountLabel = 'Bob';
  ports.bindings.push(destinationBinding('contact'));
  ports.deliveryBindings.save = async () => { throw new Error('settings row /srv/data/settings.db locked'); };
  const outcome = await surfaces.dispatch('connection', 'confirm-switch', { reassign: ['contact'] });
  assert.deepEqual(outcome.result.reassignment.failed, [{ formSlug: 'contact', code: 'reassign-failed', message: 'This site could not check this spreadsheet with the new account. Choose its spreadsheet again in Form destinations.' }]);
});

test('security: a stored destination whose spreadsheet id is not a Drive id is refused before any request names it', async () => {
  serveGoogle(fake, { accountId: 'perm-bob' });
  const { ports, surfaces } = await boot();
  ports.connection.pendingSwitchAccountLabel = 'Bob';
  ports.bindings.push(destinationBinding('contact', { spreadsheetId: '../../drive/v3/about' }));
  const outcome = await surfaces.dispatch('connection', 'confirm-switch', { reassign: ['contact'] });
  assert.deepEqual(outcome.result.reassignment.failed.map((entry) => entry.code), ['invalid-selection']);
  assert.deepEqual(fake.requests.map((request) => request.path), ['/drive/v3/about']);
  assert.equal(ports.bindings[0].config.accountId, 'perm-alice');
});

test('security: confirm-switch without an explicit reassign choice is refused by the schema and nothing is confirmed', async () => {
  const { ports, surfaces } = await boot();
  ports.connection.pendingSwitchAccountLabel = 'Bob';
  const outcome = await surfaces.dispatch('connection', 'confirm-switch');
  assert.deepEqual([outcome.ok, outcome.error.code], [false, 'invalid-payload']);
  assert.equal(ports.calls.confirmSwitch, 0);
});

test('security: a refused switch moves no destination', async () => {
  serveGoogle(fake, { accountId: 'perm-bob' });
  const { ports, surfaces } = await boot();
  ports.bindings.push(destinationBinding('contact'));
  ports.connections.confirmSwitch = async () => { throw Object.assign(new Error('No account switch is waiting.'), { code: 'no-pending-switch' }); };
  const outcome = await surfaces.dispatch('connection', 'confirm-switch', { reassign: ['contact'] });
  assert.equal(outcome.error.code, 'no-pending-switch');
  assert.deepEqual([ports.bindings[0].config.accountId, fake.requests.length], ['perm-alice', 0]);
});

test('connection: cancel-switch asks the host to cancel and keeps the current account', async () => {
  const { ports, surfaces } = await boot();
  ports.connection.pendingSwitchAccountLabel = 'Bob';
  const outcome = await surfaces.dispatch('connection', 'cancel-switch');
  assert.equal(ports.calls.cancelSwitch, 1);
  assert.deepEqual(outcome.result.connection, { status: 'connected', grantedProducts: ['sheets'], accountLabel: 'Alice' });
});

test('connection: a host refusal of confirm-switch reaches the panel with its code and message', async () => {
  const { ports, surfaces } = await boot();
  ports.connections.confirmSwitch = async () => { throw Object.assign(new Error('No account switch is waiting.'), { code: 'no-pending-switch' }); };
  const outcome = await surfaces.dispatch('connection', 'confirm-switch', { reassign: [] });
  assert.deepEqual([outcome.ok, outcome.error.code, outcome.error.message], [false, 'no-pending-switch', 'No account switch is waiting.']);
});

test('connection: sign-in asks for a product that is on but not yet granted, and for one granted but now off', async () => {
  const on = await boot({ granted: [] });
  await on.surfaces.dispatch('connection', 'sign-in', { action: 'reconnect' });
  assert.deepEqual(on.ports.calls.begin[0].scopeSetIds, ['sheets']);
  const grantedOff = await boot({ granted: ['sheets'] });
  grantedOff.ports.state.set('products', { sheets: false });
  await grantedOff.surfaces.dispatch('connection', 'sign-in', { action: 'reconnect' });
  assert.deepEqual(grantedOff.ports.calls.begin[0].scopeSetIds, ['sheets']);
});

test('connection: sign-in with no product on and none granted asks for the base sign-in only', async () => {
  const { ports, surfaces } = await boot({ granted: [] });
  ports.state.set('products', {});
  await surfaces.dispatch('connection', 'sign-in', { action: 'connect' });
  assert.deepEqual(ports.calls.begin[0].scopeSetIds, []);
});

// --- destinations panel -------------------------------------------------------------------------

test('destinations: list shows each saved destination binding and whether it is on the connected account', async () => {
  serveGoogle(fake);
  const { ports, surfaces } = await boot();
  ports.bindings.push(destinationBinding('contact'), destinationBinding('signup', { accountId: 'perm-bob' }));
  const { result } = await surfaces.dispatch('form-destinations', 'list-destinations');
  assert.deepEqual(result.destinations, [
    { formSlug: 'contact', ...SAVED_VIEW, sameAccount: true },
    { formSlug: 'signup', ...SAVED_VIEW, sameAccount: false },
  ]);
  assert.deepEqual(result.picked, []);
});

test('destinations: a binding of another adapter, of several forms, or with a config in another shape is not listed (and left alone)', async () => {
  serveGoogle(fake);
  const { ports, surfaces } = await boot();
  const contact = destinationBinding('contact');
  const foreign = [
    { ...contact, bindingId: 'other-adapter', adapterId: 'other-rows' },
    { ...contact, bindingId: 'two-forms', formIds: ['contact', 'signup'] },
    { ...contact, bindingId: 'every-form', formIds: undefined, allForms: true },
    { ...contact, bindingId: 'bad-slug', formIds: ['Not A Slug'] },
    { ...contact, bindingId: 'no-tab', config: { ...contact.config, tabs: {} } },
    { ...contact, bindingId: 'no-title', config: { ...contact.config, title: 7 } },
  ];
  ports.bindings.push(...foreign);
  assert.deepEqual((await surfaces.dispatch('form-destinations', 'list-destinations')).result.destinations, []);
  assert.equal((await surfaces.dispatch('form-destinations', 'remove-destination', { formSlug: 'contact' })).ok, true);
  assert.deepEqual(ports.bindings.map((binding) => binding.bindingId), foreign.map((binding) => binding.bindingId));
});

test('destinations: while Google needs a reconnect, list still shows destinations, says nothing about accounts, and sends nothing to Google', async () => {
  const { ports, surfaces } = await boot();
  ports.connection.status = 'reconnect-required';
  ports.bindings.push(destinationBinding('contact'));
  const { result } = await surfaces.dispatch('form-destinations', 'list-destinations');
  assert.equal(result.destinations.length, 1);
  assert.equal('sameAccount' in result.destinations[0], false);
  assert.equal(fake.requests.length, 0);
});

test('destinations: the Picker bootstrap reports reconnect-required while Google needs a reconnect', async () => {
  const { ports, surfaces } = await boot();
  ports.connection.status = 'reconnect-required';
  const bootstrap = await surfaces.bootstrap('form-destinations');
  assert.deepEqual([bootstrap.mode, bootstrap.reason], ['unavailable', 'reconnect-required']);
});

test('destinations: remove deletes only that form\'s binding and answers with the rest', async () => {
  serveGoogle(fake);
  const { ports, surfaces } = await boot();
  ports.bindings.push(destinationBinding('contact'), destinationBinding('signup'));
  const { result } = await surfaces.dispatch('form-destinations', 'remove-destination', { formSlug: 'contact' });
  assert.deepEqual(result.destinations.map((entry) => entry.formSlug), ['signup']);
  assert.deepEqual(ports.bindings.map((binding) => binding.bindingId), ['binding-signup']);
});

test('destinations: removing a form with no destination leaves the others unchanged', async () => {
  serveGoogle(fake);
  const { ports, surfaces } = await boot();
  ports.bindings.push(destinationBinding('signup'));
  assert.equal((await surfaces.dispatch('form-destinations', 'remove-destination', { formSlug: 'contact' })).ok, true);
  assert.deepEqual(ports.bindings, [destinationBinding('signup')]);
});

const fullHouse = () => Array.from({ length: MAX_FORM_DESTINATIONS }, (_, index) => destinationBinding(`form-${index}`));

test('destinations: a 51st form is refused (too-many-destinations) and nothing is saved', async () => {
  serveGoogle(fake);
  const { ports, surfaces } = await boot();
  ports.bindings.push(...fullHouse());
  const outcome = await surfaces.dispatch('form-destinations', 'save-destination', { formSlug: 'contact', spreadsheetId: FILE_ID, sheetId: 7, confirmExternalRows: true });
  assert.equal(outcome.error.code, 'too-many-destinations');
  assert.equal(ports.bindings.length, MAX_FORM_DESTINATIONS);
});

test('destinations: at the ceiling, a form that already has a destination can still change it', async () => {
  serveGoogle(fake);
  const { ports, surfaces } = await boot();
  ports.bindings.push(...fullHouse());
  const outcome = await surfaces.dispatch('form-destinations', 'save-destination', { formSlug: 'form-3', spreadsheetId: FILE_ID, sheetId: 0, confirmExternalRows: true });
  assert.equal(outcome.ok, true);
  // The form's existing binding is replaced in place (same id), not added beside it.
  assert.equal(ports.bindings.length, MAX_FORM_DESTINATIONS);
  assert.deepEqual(ports.bindings[3], { ...destinationBinding('form-3', { sheetId: 0, tabTitle: 'Sheet1' }) });
});

test('destinations: explicitly saving a disabled destination still enables its existing binding', async () => {
  serveGoogle(fake);
  const { ports, surfaces } = await boot();
  ports.bindings.push({ ...destinationBinding('contact'), enabled: false });
  const outcome = await surfaces.dispatch('form-destinations', 'save-destination', { formSlug: 'contact', spreadsheetId: FILE_ID, sheetId: 7, confirmExternalRows: true });
  assert.equal(outcome.ok, true);
  assert.deepEqual(ports.bindings, [destinationBinding('contact')]);
});

test('destinations: list-tabs keeps grid tabs only (a tab with no type counts as a grid) and gives an untitled tab an empty title', async () => {
  serveGoogle(fake);
  fake.route({ method: 'GET', path: `/v4/spreadsheets/${FILE_ID}` }, (_req, _body, url) => [200, url.searchParams.get('fields')?.startsWith('sheets')
    ? { sheets: [{ properties: { sheetId: 0, title: 'Grid', sheetType: 'GRID' } }, { properties: { sheetId: 1, title: 'Chart', sheetType: 'OBJECT' } }, { properties: { sheetId: 2 } }, null, { properties: { sheetId: 'x' } }] }
    : { spreadsheetId: FILE_ID, properties: { title: 'Leads' } }]);
  const { surfaces } = await boot();
  const { result } = await surfaces.dispatch('form-destinations', 'list-tabs', { spreadsheetId: FILE_ID });
  assert.deepEqual(result.tabs, [{ sheetId: 0, title: 'Grid' }, { sheetId: 2, title: '' }]);
});

test('destinations: list-tabs of an answer with no tab list returns no tabs', async () => {
  serveGoogle(fake);
  fake.route({ method: 'GET', path: `/v4/spreadsheets/${FILE_ID}` }, (_req, _body, url) => [200, url.searchParams.get('fields')?.startsWith('sheets') ? {} : { spreadsheetId: FILE_ID, properties: { title: 'Leads' } }]);
  const { surfaces } = await boot();
  assert.deepEqual((await surfaces.dispatch('form-destinations', 'list-tabs', { spreadsheetId: FILE_ID })).result.tabs, []);
});

// --- picked files -------------------------------------------------------------------------------

/** A plugin-state store typed as the `{ get, set }` port `rememberPickedSpreadsheet` takes. */
function memoryState() {
  const values = new Map();
  return { values, async get({ key }) { return values.get(key) ?? null; }, async set({ key, value }) { values.set(key, value); } };
}
const picked = (spreadsheetId, title = spreadsheetId) => ({ spreadsheetId, title, url: `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`, accountId: 'perm-alice' });

test('picked files: picking a file again moves it to the top instead of listing it twice', async () => {
  const state = memoryState();
  await rememberPickedSpreadsheet({ state, spreadsheet: picked(FILE_ID, 'Old title') });
  await rememberPickedSpreadsheet({ state, spreadsheet: picked(OTHER_FILE_ID) });
  await rememberPickedSpreadsheet({ state, spreadsheet: picked(FILE_ID, 'New title') });
  assert.deepEqual(state.values.get(PICKED_SPREADSHEETS_KEY).map((entry) => [entry.spreadsheetId, entry.title]), [[FILE_ID, 'New title'], [OTHER_FILE_ID, OTHER_FILE_ID]]);
});

test('picked files: at most 10 are kept, newest first', async () => {
  const state = memoryState();
  for (let index = 0; index < 12; index += 1) await rememberPickedSpreadsheet({ state, spreadsheet: picked(`sheet-number-${String(index).padStart(2, '0')}`) });
  const ids = state.values.get(PICKED_SPREADSHEETS_KEY).map((entry) => entry.spreadsheetId);
  assert.equal(ids.length, 10);
  assert.deepEqual([ids[0], ids[9]], ['sheet-number-11', 'sheet-number-02']);
});

test('picker: without an injected id source, a hosted session id is a random UUID', async () => {
  serveGoogle(fake);
  const { ports, surfaces } = await boot({}, {});
  const bootstrap = await surfaces.bootstrap('picker');
  assert.match(bootstrap.picker.sessionId, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(ports.state.get('picker-session:picker').id, bootstrap.picker.sessionId);
});

test('destinations (F11): a host binding with neither formIds nor allForms fails closed and is never treated as every form', async () => {
  serveGoogle(fake);
  const { ports, surfaces } = await boot();
  const invalid = { ...destinationBinding('contact'), formIds: undefined };
  ports.bindings.push(invalid);
  const outcome = await surfaces.dispatch('form-destinations', 'list-destinations');
  assert.equal(outcome.ok, false);
  assert.equal(ports.bindings.length, 1);
  assert.equal(ports.bindings[0].allForms, undefined, 'the panel never widens a malformed host binding');
});


test('surface tokens (F7): bootstrap without a signed-in principal cannot mint a Picker access token', async () => {
  serveGoogle(fake);
  const ports = createHostPorts({ publicConfig: { TOVU_GOOGLE_PICKER_BROWSER_KEY: 'browser-key-placeholder', TOVU_GOOGLE_PICKER_APP_ID: '123456789' } });
  ports.state.set('products', { sheets: true });
  const surfaces = await bootSurfaces({ fake, ports }, { principalId: null });
  await assert.rejects(surfaces.bootstrap('picker'));
  assert.equal(ports.calls.getAccessToken, 0, 'Jini refuses before the host token port runs');
});
