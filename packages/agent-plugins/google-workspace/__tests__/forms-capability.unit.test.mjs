/** The real descriptor, capability session, handler and result schemas over in-memory host ports.
 * No listener or provider connection is needed to verify form discovery and refresh behavior. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { FILE_ID, bootSurfaces, createHostPorts } from './surface-harness.mjs';

const FORMS = [{ slug: 'contact', title: 'Contact us' }];

/** Fixed metadata only; an unexpected request fails rather than reaching any network. */
const fake = { async fetch({ url }) {
  const { hostname, pathname } = new URL(url);
  assert.ok(['www.googleapis.com', 'sheets.googleapis.com'].includes(hostname));
  const bodies = {
    '/drive/v3/about': { user: { permissionId: 'perm-alice', displayName: 'Alice' } },
    [`/drive/v3/files/${FILE_ID}`]: { id: FILE_ID, name: 'Leads', mimeType: 'application/vnd.google-apps.spreadsheet', trashed: false },
    [`/v4/spreadsheets/${FILE_ID}`]: { spreadsheetId: FILE_ID, properties: { title: 'Leads' }, sheets: [{ properties: { sheetId: 7, title: 'Leads', sheetType: 'GRID' } }] },
  };
  assert.ok(Object.hasOwn(bodies, pathname), `unexpected request: ${pathname}`);
  return new Response(JSON.stringify(bodies[pathname]), { headers: { 'content-type': 'application/json' } });
} };

test('list, save and remove preserve forms through the declared capability and result schemas', async () => {
  const ports = createHostPorts({ forms: FORMS });
  ports.state.set('products', { sheets: true });
  const surfaces = await bootSurfaces({ fake, ports });
  const listed = await surfaces.dispatch('form-destinations', 'list-destinations');
  const saved = await surfaces.dispatch('form-destinations', 'save-destination', { formSlug: 'contact', spreadsheetId: FILE_ID, sheetId: 7, confirmExternalRows: true });
  const removed = await surfaces.dispatch('form-destinations', 'remove-destination', { formSlug: 'contact' });
  for (const outcome of [listed, saved, removed]) {
    assert.equal(outcome.ok, true, JSON.stringify(outcome));
    assert.deepEqual(outcome.result.forms, FORMS);
  }
  assert.deepEqual(ports.bindings, []);
  assert.deepEqual(surfaces.errors, []);
});

test('a host without forms omits choices for the typed fallback', async () => {
  const ports = createHostPorts({ connected: false });
  const surfaces = await bootSurfaces({ fake, ports });
  const outcome = await surfaces.dispatch('form-destinations', 'list-destinations');
  assert.equal(outcome.ok, true);
  assert.equal(Object.hasOwn(outcome.result, 'forms'), false);
});

test('a forms permission refusal fails the action instead of returning a typed fallback', async () => {
  const ports = createHostPorts({ connected: false, forms: FORMS });
  ports.forms.list = async () => { throw Object.assign(new Error('Forms access denied.'), { code: 'forbidden' }); };
  const surfaces = await bootSurfaces({ fake, ports });
  const outcome = await surfaces.dispatch('form-destinations', 'list-destinations');
  assert.deepEqual(outcome, { ok: false, error: { code: 'forbidden', message: 'Forms access denied.', retryable: false } });
});
