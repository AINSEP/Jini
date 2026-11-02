/**
 * @file Unit tests for `lib/form-destination-settings.mjs` on its own, with a typed in-memory
 * `deliveryBindings` port: reading keeps only this plugin's Sheets bindings even when the port lists
 * another adapter's (the surface tests cannot show that: Jini's session already drops undeclared
 * adapters), and saving sends exactly the binding the Sheets destination reads.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { SHEETS_ADAPTER_ID, readFormDestinations, saveFormDestination } from '../lib/form-destination-settings.mjs';
import { FILE_ID, destinationBinding } from './surface-harness.mjs';

/** @returns {import('@jini-ai/agent-plugins/admin-surfaces').AdminSurfaceDeliveryBindings & { saved: object[] }} */
function port(listed) {
  const saved = [];
  return {
    saved,
    async list() { return listed; },
    async save(draft) { saved.push(draft); return { bindingId: 'b-new', ...draft }; },
    async remove() { throw new Error('remove is not used by this test'); },
  };
}

test('read: another adapter\'s binding is left out, however it is shaped; the Sheets one kept', async () => {
  const sheets = destinationBinding('contact');
  const destinations = await readFormDestinations({ deliveryBindings: port([sheets, { ...destinationBinding('signup'), bindingId: 'other', adapterId: 'other-rows' }]) });
  assert.deepEqual(Object.keys(destinations), ['contact']);
  assert.equal(destinations.contact.bindingId, 'binding-contact');
});

test('save: a new destination is one Sheets binding for that one form on the account connection, with no binding id', async () => {
  const deliveryBindings = port([]);
  await saveFormDestination({ deliveryBindings, formSlug: 'contact', destination: { spreadsheetId: FILE_ID, title: 'Leads', sheetId: 7, tabTitle: 'Leads', accountId: 'perm-alice' } });
  const { bindingId: _assigned, ...expected } = destinationBinding('contact');
  assert.deepEqual(deliveryBindings.saved, [expected]);
  assert.equal(expected.adapterId, SHEETS_ADAPTER_ID);
});

test('save: an existing destination is saved under its binding id', async () => {
  const deliveryBindings = port([]);
  await saveFormDestination({ deliveryBindings, formSlug: 'contact', destination: { spreadsheetId: FILE_ID, title: 'Leads', sheetId: 7, tabTitle: 'Leads', accountId: 'perm-alice' } }, { bindingId: 'binding-contact' });
  assert.deepEqual(deliveryBindings.saved, [destinationBinding('contact')]);
});
