/**
 * @file The one vertical-slice proof for the plugin's admin surfaces (phase A, G13b), through the real
 * Jini handler host and dispatcher: the connection panel turns Sheets on, the Picker panel's hosted
 * bootstrap opens a session, the picked file is verified and saved, and the form-destination panel
 * saves a form → spreadsheet tab choice as its delivery binding, with the config the Sheets destination reads. Google is
 * the 127.0.0.1 fake.
 */
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

import { startFakeGoogle } from './fake-google-http.mjs';
import { FILE_ID, TOKEN, bootSurfaces, createHostPorts, serveGoogle } from './surface-harness.mjs';

let fake;
before(async () => { fake = await startFakeGoogle({ clients: {} }); });
after(async () => { await fake.close(); });

test('vertical slice: Sheets on → hosted Picker → verified selection → form destination saved as its delivery binding', async () => {
  serveGoogle(fake);
  const ports = createHostPorts({ publicConfig: { TOVU_GOOGLE_PICKER_BROWSER_KEY: 'browser-key-placeholder', TOVU_GOOGLE_PICKER_APP_ID: '123456789' } });
  const surfaces = await bootSurfaces({ fake, ports }, { randomId: () => 'session-0123456789abcdef' });

  const on = await surfaces.dispatch('connection', 'set-product', { productId: 'sheets', enabled: true });
  assert.deepEqual(on.result.products, [{ id: 'sheets', label: 'Google Sheets', enabled: true, granted: true }]);

  const bootstrap = await surfaces.bootstrap('picker');
  assert.deepEqual(bootstrap, { mode: 'hosted', accountLabel: 'alice@example.test', picker: { accessToken: TOKEN, developerKey: 'browser-key-placeholder', appId: '123456789', sessionId: 'session-0123456789abcdef' } });

  const picked = await surfaces.dispatch('picker', 'verify-picked', { sessionId: bootstrap.picker.sessionId, fileId: FILE_ID });
  assert.deepEqual(picked, { ok: true, result: { spreadsheet: { spreadsheetId: FILE_ID, title: 'Leads', url: `https://docs.google.com/spreadsheets/d/${FILE_ID}/edit` } } });

  const tabs = await surfaces.dispatch('form-destinations', 'list-tabs', { spreadsheetId: FILE_ID });
  assert.deepEqual(tabs.result.tabs, [{ sheetId: 0, title: 'Sheet1' }, { sheetId: 7, title: 'Leads' }]);

  const saved = await surfaces.dispatch('form-destinations', 'save-destination', { formSlug: 'contact', spreadsheetId: FILE_ID, sheetId: 7, confirmExternalRows: true });
  assert.equal(saved.ok, true);
  assert.deepEqual(saved.result.destinations, [{
    formSlug: 'contact', spreadsheetId: FILE_ID, title: 'Leads', url: `https://docs.google.com/spreadsheets/d/${FILE_ID}/edit`, sheetId: 7, tabTitle: 'Leads', sameAccount: true,
  }]);
  // The saved choice IS the delivery binding: the Sheets adapter's config, on this plugin's own connection.
  assert.deepEqual(ports.bindings, [{
    bindingId: 'binding-1', adapterId: 'google-sheets', connectionId: 'account', enabled: true, formIds: ['contact'],
    config: { spreadsheetId: FILE_ID, accountId: 'perm-alice', tabs: { contact: { sheetId: 7 } }, title: 'Leads', tabTitle: 'Leads' },
  }]);
  assert.deepEqual(saved.result.picked.map((entry) => entry.spreadsheetId), [FILE_ID]);

  const panel = await surfaces.dispatch('connection', 'status');
  assert.deepEqual(panel.result.destinations, [{ formSlug: 'contact', title: 'Leads', tabTitle: 'Leads' }]);
  assert.deepEqual(surfaces.errors, []);
});
