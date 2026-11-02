/**
 * @file Frame tests for `ui/destination-panel.mjs` (form destinations) in jsdom: the saved list,
 * Remove, choosing a spreadsheet (a picked one, or the Picker flow), the tab chooser, the "rows stay
 * in the spreadsheet" confirmation and Save, plus the trust rules (declared actions only, to the
 * host origin for this mount; server text is text, never markup; the bootstrap token never reaches
 * the DOM; a cancelled Picker asks the server nothing).
 *
 * Google's Picker library is a stub (`frame-harness.mjs`); the frame loads it once per module life,
 * so the first hosted test loads it and later ones reuse it.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, mock, test } from 'node:test';

import { CANCELLED_TEXT, EXTERNAL_ROWS_NOTE, pickerIntro, pollText } from '../ui/picker-view.mjs';
import {
  HOST_ORIGIN, MARKUP, MOUNT_ID, PICKER_TOKEN, button, buttonLabels, createFakePickerApi, createFrame, declaredActions, flush,
  installGapi, pickerScripts, refusal, screenText,
} from './frame-harness.mjs';

// The entry script starts itself on import, in whatever frame the globals name: give it one.
const boot = createFrame();
const { initDestinationPanel } = await import('../ui/destination-panel.mjs');

const FILE_ID = '1AbC-dEf_ghIJklmnOPqrs';
const OTHER_ID = '1ZyX-wVu_tsRQponmLKjih';
const LEADS = Object.freeze({ spreadsheetId: FILE_ID, title: 'Leads', url: `https://docs.google.com/spreadsheets/d/${FILE_ID}/edit` });
const BUDGET = Object.freeze({ spreadsheetId: OTHER_ID, title: 'Budget', url: `https://docs.google.com/spreadsheets/d/${OTHER_ID}/edit` });
const TABS = Object.freeze([{ sheetId: 0, title: 'Sheet1' }, { sheetId: 42, title: 'Contact' }]);
const NOW = Date.parse('2030-01-01T00:00:00Z');
const HOSTED = Object.freeze({ mode: 'hosted', accountLabel: 'Alice', picker: Object.freeze({ accessToken: PICKER_TOKEN, developerKey: 'browser-key-placeholder', appId: '123456', sessionId: 'session-1' }) });
const SYSTEM = Object.freeze({ mode: 'system-browser', accountLabel: 'Alice' });
const pickerApi = createFakePickerApi();

/** A saved destination in the `list-destinations` result shape. */
function saved(optional = {}) {
  return { formSlug: 'contact', spreadsheetId: FILE_ID, title: 'Leads', url: LEADS.url, sheetId: 42, tabTitle: 'Contact', sameAccount: true, ...optional };
}

let frame;
beforeEach(() => { mock.timers.enable({ apis: ['setTimeout', 'Date'], now: NOW }); });
afterEach(() => { mock.timers.reset(); frame?.close(); frame = undefined; });

/** A fresh panel whose host answers `list-destinations` with `listed`, initialised with `bootstrap`. */
async function openPanel(bootstrap, listed = { destinations: [], picked: [] }) {
  frame = createFrame();
  frame.respond.set('list-destinations', typeof listed === 'function' ? listed : () => listed);
  initDestinationPanel({ window: frame.window, document: frame.document });
  frame.init(bootstrap === undefined ? {} : { bootstrap });
  await flush();
  return frame;
}

const statusLine = () => frame.document.querySelector('[role="status"]');
const selects = () => [...frame.document.querySelectorAll('select')];

/** Sets a control's value as a person would and fires its event. */
async function change(control, value, eventName = 'change') {
  control.value = value;
  control.dispatchEvent(new frame.window.Event(eventName));
  await flush();
}

/** Picks a spreadsheet from the picked list, answering `list-tabs` with `tabs`. */
async function choosePicked(spreadsheet, tabs = TABS) {
  frame.respond.set('list-tabs', () => ({ spreadsheet, tabs }));
  await change(selects()[0], spreadsheet.spreadsheetId);
}

test('starts itself on load: lists the saved destinations once the host init arrives', async () => {
  boot.respond.set('list-destinations', () => ({ destinations: [], picked: [] }));
  const before = boot.posted.length;
  boot.init({ bootstrap: SYSTEM });
  await flush();
  assert.deepEqual({ before, requests: boot.requests() }, { before: 0, requests: [{ action: 'list-destinations', payload: {} }] });
  assert.ok(screenText(boot).includes('No form sends to Google Sheets yet.'));
  boot.close();
});

test('without start data the panel says so and offers no Picker button (nothing it could open)', async () => {
  await openPanel(undefined);
  assert.equal(frame.document.querySelector('.intro').textContent, pickerIntro({ bootstrap: undefined }));
  assert.deepEqual(buttonLabels(frame), ['Save destination']);
});

test('an unavailable bootstrap offers no Picker button, but already-picked spreadsheets stay choosable', async () => {
  await openPanel({ mode: 'unavailable', reason: 'sheets-off', message: 'Turn Google Sheets on first.' }, { destinations: [], picked: [LEADS] });
  assert.equal(frame.document.querySelector('.intro').textContent, 'Turn Google Sheets on first.');
  assert.deepEqual({ buttons: buttonLabels(frame), options: [...selects()[0].options].map((option) => option.textContent) }, { buttons: ['Save destination'], options: ['Choose…', 'Leads'] });
});

test('with no picked spreadsheets there is no spreadsheet list, only the Picker button', async () => {
  await openPanel(SYSTEM);
  assert.deepEqual({ selects: selects().length, buttons: buttonLabels(frame) }, { selects: 0, buttons: ['Choose another spreadsheet', 'Save destination'] });
});

test('each saved destination shows its form, spreadsheet and tab, and no config to copy (the save is the binding)', async () => {
  await openPanel(SYSTEM, { destinations: [saved()], picked: [] });
  const item = frame.document.querySelector('li.card');
  assert.equal(item.querySelector('p').textContent, 'contact → Leads / Contact');
  assert.equal(item.querySelector('code'), null);
  assert.equal(item.querySelector('.notice'), null);
});

test('a destination chosen with another Google account says to choose its spreadsheet again', async () => {
  await openPanel(SYSTEM, { destinations: [saved({ sameAccount: false })], picked: [] });
  assert.equal(frame.document.querySelector('li .notice').textContent, 'Chosen with a different Google account than the one connected now. Choose its spreadsheet again.');
});

test('Remove sends remove-destination for that form and says the rows stay in the spreadsheet', async () => {
  await openPanel(SYSTEM, { destinations: [saved()], picked: [] });
  frame.respond.set('remove-destination', () => ({ destinations: [], picked: [] }));
  button(frame, 'Remove').click();
  await flush();
  assert.deepEqual(frame.requests().at(-1), { action: 'remove-destination', payload: { formSlug: 'contact' } });
  assert.equal(statusLine().textContent, `Removed contact. ${EXTERNAL_ROWS_NOTE}`);
  assert.ok(screenText(frame).includes('No form sends to Google Sheets yet.'));
});

test('choosing a picked spreadsheet loads its tabs (server-verified) and preselects the first tab', async () => {
  await openPanel(SYSTEM, { destinations: [], picked: [LEADS, BUDGET] });
  await choosePicked(BUDGET);
  assert.deepEqual(frame.requests().at(-1), { action: 'list-tabs', payload: { spreadsheetId: OTHER_ID } });
  const [sheet, tab] = selects();
  assert.deepEqual({ sheet: sheet.value, tabs: [...tab.options].map((option) => [option.value, option.textContent]), tab: tab.value }, {
    sheet: OTHER_ID, tabs: [['0', 'Sheet1'], ['42', 'Contact']], tab: '0',
  });
});

test('Save sends the trimmed form name, the spreadsheet, the chosen numeric tab id and the confirmation', async () => {
  await openPanel(SYSTEM, { destinations: [], picked: [LEADS] });
  await choosePicked(LEADS);
  await change(frame.document.querySelector('input[type="text"]'), '  contact ', 'input');
  await change(selects()[1], '42');
  frame.document.querySelector('input[type="checkbox"]').click();
  frame.respond.set('save-destination', () => ({ destinations: [saved()], picked: [LEADS] }));
  button(frame, 'Save destination').click();
  await flush();
  assert.deepEqual(frame.requests().at(-1), { action: 'save-destination', payload: { formSlug: 'contact', spreadsheetId: FILE_ID, sheetId: 42, confirmExternalRows: true } });
  assert.equal(statusLine().textContent, 'Saved: contact sends to Leads.');
});

test('the typed form name, chosen tab and confirmation survive a re-render', async () => {
  await openPanel(SYSTEM, { destinations: [], picked: [LEADS] });
  await choosePicked(LEADS);
  await change(frame.document.querySelector('input[type="text"]'), 'contact', 'input');
  await change(selects()[1], '42');
  frame.document.querySelector('input[type="checkbox"]').click();
  frame.respond.set('list-tabs', () => { throw refusal('Google did not answer. Try again.', { retryable: true }); });
  await change(selects()[0], FILE_ID);
  assert.deepEqual({
    status: statusLine().textContent, name: frame.document.querySelector('input[type="text"]').value,
    tab: selects()[1].value, confirmed: frame.document.querySelector('input[type="checkbox"]').checked,
  }, { status: 'Google did not answer. Try again.', name: 'contact', tab: '42', confirmed: true });
});

test('a save with missing details says what is missing and sends nothing', async () => {
  await openPanel(SYSTEM);
  button(frame, 'Save destination').click();
  await flush();
  assert.equal(frame.requests().some((request) => request.action === 'save-destination'), false);
  assert.equal(statusLine().textContent, "Enter the form's short name.");
});

test('a host with forms offers site forms by title and saves the chosen slug', async () => {
  const listed = { destinations: [], picked: [LEADS], forms: [{ slug: 'contact', title: 'Contact us' }, { slug: 'support', title: 'Support request' }] };
  await openPanel(SYSTEM, listed);
  const form = () => frame.document.querySelector('select[name="formSlug"]');
  assert.equal(frame.document.querySelector('input[type="text"]'), null);
  assert.deepEqual([...form().options].map((option) => [option.value, option.textContent]), [['', 'Choose a form…'], ['contact', 'Contact us'], ['support', 'Support request']]);
  await change(form(), 'support');
  frame.respond.set('list-tabs', () => ({ spreadsheet: LEADS, tabs: TABS }));
  await change(selects()[1], FILE_ID);
  assert.equal(form().value, 'support', 'selection survives the tab-load render');
  frame.document.querySelector('input[type="checkbox"]').click();
  frame.respond.set('save-destination', () => ({ ...listed, destinations: [saved({ formSlug: 'support' })] }));
  button(frame, 'Save destination').click();
  await flush();
  assert.deepEqual(frame.requests().at(-1), { action: 'save-destination', payload: { formSlug: 'support', spreadsheetId: FILE_ID, sheetId: 0, confirmExternalRows: true } });
  assert.equal(form().value, 'support');
  assert.equal(frame.document.querySelector('input[type="text"]'), null, 'save keeps the picker');
});

test('an available forms capability with no forms never falls back to typing a slug', async () => {
  await openPanel(SYSTEM, { destinations: [], picked: [], forms: [] });
  const form = frame.document.querySelector('select[name="formSlug"]');
  assert.equal(form.disabled, true);
  assert.equal(form.options[0].textContent, 'No forms available');
  assert.equal(frame.document.querySelector('input[type="text"]'), null);
  button(frame, 'Save destination').click();
  await flush();
  assert.equal(statusLine().textContent, 'Choose a form.');
  assert.deepEqual(frame.requests(), [{ action: 'list-destinations', payload: {} }]);
});

test('failed initial discovery shows its failure without offering the typed fallback', async () => {
  await openPanel(SYSTEM, () => { throw refusal('You do not have permission to list forms.', { code: 'forbidden' }); });
  assert.equal(statusLine().textContent, 'You do not have permission to list forms.');
  assert.equal(frame.document.querySelector('input[type="text"]'), null);
  assert.equal(frame.document.querySelector('select[name="formSlug"]'), null);
  assert.equal(buttonLabels(frame).includes('Save destination'), false);
});

test('form titles are text, and Remove keeps the forms selector', async () => {
  const listed = { destinations: [saved()], picked: [], forms: [{ slug: 'contact', title: MARKUP }] };
  await openPanel(SYSTEM, listed);
  frame.respond.set('remove-destination', () => ({ ...listed, destinations: [] }));
  button(frame, 'Remove').click();
  await flush();
  assert.equal(frame.document.querySelector('img'), null);
  assert.equal(frame.document.querySelector('select[name="formSlug"]').options[1].textContent, MARKUP);
  assert.equal(frame.document.querySelector('input[type="text"]'), null);
});

test("the host's schema refusal (JSON paths) shows as plain words, not developer text", async () => {
  await openPanel(SYSTEM, { destinations: [saved()], picked: [LEADS] });
  frame.respond.set('remove-destination', () => { throw refusal("The request does not match the action's input: $.formSlug has the wrong length.", { code: 'invalid-payload' }); });
  button(frame, 'Remove').click();
  await flush();
  assert.equal(statusLine().textContent, 'Some details are missing or not valid. Check them and try again.');
});

test('guarantee: the declared save-destination input refuses an empty spreadsheet id, so a successful save always had a chosen spreadsheet', () => {
  const surfaces = JSON.parse(readFileSync(new URL('../tovu-admin-surfaces.json', import.meta.url), 'utf8')).surfaces;
  const save = surfaces.find((surface) => surface.id === 'form-destinations').actions.find((action) => action.name === 'save-destination');
  assert.deepEqual({ required: save.input.required.includes('spreadsheetId'), minLength: save.input.properties.spreadsheetId.minLength }, { required: true, minLength: 1 });
});

test('a spreadsheet the server reports without tabs shows an empty tab list and saves tab id 0 for the server to re-verify', async () => {
  await openPanel(SYSTEM, { destinations: [], picked: [LEADS] });
  await choosePicked(LEADS, []);
  await change(frame.document.querySelector('input[type="text"]'), 'contact', 'input');
  frame.document.querySelector('input[type="checkbox"]').click();
  frame.respond.set('save-destination', () => { throw refusal('That tab no longer exists. Choose a tab again.'); });
  button(frame, 'Save destination').click();
  await flush();
  assert.equal(selects()[1].options.length, 0);
  assert.equal(frame.requests().at(-1).payload.sheetId, 0);
});

test('Choose another spreadsheet (system browser): shows the browser step, then loads the verified pick and its tabs', async () => {
  await openPanel(SYSTEM);
  frame.respond.set('start-system-picker', () => ({ expiresAt: new Date(NOW + 600_000).toISOString() }));
  frame.respond.set('finish-system-picker', () => ({ status: 'selected', spreadsheet: LEADS }));
  frame.respond.set('list-tabs', () => ({ spreadsheet: LEADS, tabs: TABS }));
  frame.respond.set('list-destinations', () => ({ destinations: [], picked: [LEADS] }));
  button(frame, 'Choose another spreadsheet').click();
  await flush();
  const waiting = statusLine().textContent;
  mock.timers.tick(3000);
  await flush();
  assert.equal(waiting, pollText({ status: 'waiting' }));
  assert.deepEqual(frame.requests().map((request) => request.action), ['list-destinations', 'start-system-picker', 'finish-system-picker', 'list-tabs', 'list-destinations']);
  assert.deepEqual({ status: statusLine(), sheet: selects()[0].value, tabs: selects()[1].options.length }, { status: null, sheet: FILE_ID, tabs: 2 });
});

test('a Picker run that ends without a choice says nothing was chosen and saves nothing', async () => {
  await openPanel(SYSTEM);
  frame.respond.set('start-system-picker', () => ({ expiresAt: new Date(NOW + 600_000).toISOString() }));
  frame.respond.set('finish-system-picker', () => ({ status: 'cancelled' }));
  button(frame, 'Choose another spreadsheet').click();
  await flush();
  mock.timers.tick(3000);
  await flush();
  assert.equal(statusLine().textContent, CANCELLED_TEXT);
  assert.deepEqual(frame.requests().map((request) => request.action), ['list-destinations', 'start-system-picker', 'finish-system-picker']);
});

test('security: a hosted Picker cancel asks the server nothing', async () => {
  await openPanel(HOSTED);
  button(frame, 'Choose another spreadsheet').click();
  await flush();
  const [script] = pickerScripts(frame);
  installGapi({ window: frame.window, pickerApi });
  script.onload();
  await flush();
  pickerApi.fire({ action: 'cancel' });
  await flush();
  assert.equal(statusLine().textContent, CANCELLED_TEXT);
  assert.deepEqual(frame.requests().map((request) => request.action), ['list-destinations']);
});

test('security: a hosted pick is verified by the server, and the bootstrap token never reaches the DOM or a message', async () => {
  await openPanel(HOSTED);
  frame.respond.set('verify-picked', () => ({ spreadsheet: LEADS }));
  frame.respond.set('list-tabs', () => ({ spreadsheet: LEADS, tabs: TABS }));
  button(frame, 'Choose another spreadsheet').click();
  await flush();
  pickerApi.fire({ action: 'picked', docs: [{ id: FILE_ID }] });
  await flush();
  assert.deepEqual(frame.requests().slice(1, 3), [{ action: 'verify-picked', payload: { sessionId: 'session-1', fileId: FILE_ID } }, { action: 'list-tabs', payload: { spreadsheetId: FILE_ID } }]);
  assert.equal(pickerApi.builds.at(-1).oauthToken, PICKER_TOKEN);
  assert.equal(frame.document.documentElement.outerHTML.includes(PICKER_TOKEN), false);
  assert.equal(frame.posted.some((entry) => JSON.stringify(entry.message).includes(PICKER_TOKEN)), false);
});

test('security: form names, titles and tab titles from the server are shown as text, never markup', async () => {
  await openPanel(SYSTEM, { destinations: [saved({ formSlug: MARKUP, title: MARKUP, tabTitle: MARKUP })], picked: [{ ...LEADS, title: MARKUP }] });
  await choosePicked(LEADS, [{ sheetId: 0, title: MARKUP }]);
  assert.equal(frame.document.querySelector('img'), null);
  assert.equal(frame.document.querySelector('li.card p strong').textContent, MARKUP);
  assert.equal(selects()[1].options[0].textContent, MARKUP);
});

test('security: everything the panel posts is a declared form-destinations action, to the host origin, for its mount', async () => {
  await openPanel(SYSTEM, { destinations: [saved()], picked: [LEADS] });
  frame.respond.set('remove-destination', () => ({ destinations: [saved()], picked: [LEADS] }));
  frame.respond.set('save-destination', () => ({ destinations: [saved()], picked: [LEADS] }));
  frame.respond.set('start-system-picker', () => ({ expiresAt: new Date(NOW + 600_000).toISOString() }));
  frame.respond.set('finish-system-picker', () => ({ status: 'cancelled' }));
  await choosePicked(LEADS);
  button(frame, 'Remove').click();
  await flush();
  await change(frame.document.querySelector('input[type="text"]'), 'contact', 'input');
  frame.document.querySelector('input[type="checkbox"]').click();
  button(frame, 'Save destination').click();
  await flush();
  button(frame, 'Choose another spreadsheet').click();
  await flush();
  mock.timers.tick(3000);
  await flush();
  const declared = declaredActions({ surfaceId: 'form-destinations' });
  assert.deepEqual(frame.requests().map((request) => request.action), ['list-destinations', 'list-tabs', 'remove-destination', 'save-destination', 'start-system-picker', 'finish-system-picker']);
  assert.equal(frame.posted.every((entry) => entry.message.kind === 'action-request' && declared.includes(entry.message.action)), true);
  assert.equal(frame.posted.every((entry) => entry.targetOrigin === HOST_ORIGIN && entry.message.mountId === MOUNT_ID), true);
});

test('a step the host calls retryable offers Try again, which re-runs that step', async () => {
  await openPanel(SYSTEM, { destinations: [], picked: [LEADS] });
  let asked = 0;
  frame.respond.set('list-tabs', () => {
    asked += 1;
    if (asked === 1) throw refusal('Google did not answer. Try again.', { retryable: true });
    return { spreadsheet: LEADS, tabs: TABS };
  });
  await change(selects()[0], FILE_ID);
  assert.equal(statusLine().textContent, 'Google did not answer. Try again.');
  button(frame, 'Try again').click();
  await flush();
  assert.equal(asked, 2);
  assert.deepEqual([...selects()[1].options].map((o) => o.textContent), ['Sheet1', 'Contact']);
});

test('a save with a form list but no form chosen asks for a form; with a typed name but no spreadsheet asks for one', async () => {
  await openPanel(SYSTEM, { destinations: [], picked: [], forms: [{ slug: 'contact', title: 'Contact us' }] });
  button(frame, 'Save destination').click();
  await flush();
  assert.equal(statusLine().textContent, 'Choose a form.');
  frame.close();

  await openPanel(SYSTEM);
  await change(frame.document.querySelector('input[type="text"]'), 'contact', 'input');
  button(frame, 'Save destination').click();
  await flush();
  assert.equal(statusLine().textContent, 'Choose a spreadsheet.');
  assert.equal(frame.requests().some((request) => request.action === 'save-destination'), false);
});

test('a save without the rows confirmation asks for it; a spreadsheet with no tabs saves to sheet 0', async () => {
  await openPanel(SYSTEM, { destinations: [], picked: [LEADS] });
  await choosePicked(LEADS, []);
  await change(frame.document.querySelector('input[type="text"]'), 'contact', 'input');
  button(frame, 'Save destination').click();
  await flush();
  assert.equal(statusLine().textContent, 'Tick the box to confirm rows stay in the spreadsheet.');
  assert.equal(frame.requests().some((request) => request.action === 'save-destination'), false);
  frame.document.querySelector('input[type="checkbox"]').click();
  frame.respond.set('save-destination', () => ({ destinations: [saved({ sheetId: 0, tabTitle: 'Sheet1' })], picked: [LEADS] }));
  button(frame, 'Save destination').click();
  await flush();
  assert.deepEqual(frame.requests().at(-1), { action: 'save-destination', payload: { formSlug: 'contact', spreadsheetId: FILE_ID, sheetId: 0, confirmExternalRows: true } });
});
