/**
 * @file Frame tests for `ui/picker.mjs` (the "Choose spreadsheet" panel) in jsdom: the intro per
 * bootstrap mode, the Choose / Stop waiting buttons, the status line after a pick, cancel, stop or
 * failure, the list of chosen spreadsheets, and the trust rules (declared actions only, to the host
 * origin for this mount; the bootstrap's access token goes only to the Picker builder, never into the
 * DOM; server text is text, never markup; a cancel asks the server nothing).
 *
 * Google's Picker library is a stub (`frame-harness.mjs`); the frame loads it once per module life,
 * so the first hosted test loads it and later ones reuse it.
 */
import assert from 'node:assert/strict';
import { afterEach, beforeEach, mock, test } from 'node:test';

import { CANCELLED_TEXT, pickerIntro, pollText } from '../ui/picker-view.mjs';
import {
  HOST_ORIGIN, MARKUP, MOUNT_ID, PICKER_TOKEN, button, buttonLabels, createFakePickerApi, createFrame, declaredActions, flush,
  installGapi, pickerScripts, refusal, screenText,
} from './frame-harness.mjs';

// The entry script starts itself on import, in whatever frame the globals name: give it one.
const boot = createFrame();
const { initPickerPanel } = await import('../ui/picker.mjs');

const FILE_ID = '1AbC-dEf_ghIJklmnOPqrs';
const LEADS = Object.freeze({ spreadsheetId: FILE_ID, title: 'Leads', url: `https://docs.google.com/spreadsheets/d/${FILE_ID}/edit` });
const NOW = Date.parse('2030-01-01T00:00:00Z');
const HOSTED = Object.freeze({ mode: 'hosted', accountLabel: 'Alice', picker: Object.freeze({ accessToken: PICKER_TOKEN, developerKey: 'browser-key-placeholder', appId: '123456', sessionId: 'session-1' }) });
const SYSTEM = Object.freeze({ mode: 'system-browser', accountLabel: 'Alice' });
const pickerApi = createFakePickerApi();

let frame;
beforeEach(() => { mock.timers.enable({ apis: ['setTimeout', 'Date'], now: NOW }); });
afterEach(() => { mock.timers.reset(); frame?.close(); frame = undefined; });

/** A fresh panel whose host answers `list-picked` with `picked`, initialised with `bootstrap`. */
async function openPanel(bootstrap, picked = []) {
  frame = createFrame();
  frame.respond.set('list-picked', () => ({ spreadsheets: picked }));
  initPickerPanel({ window: frame.window, document: frame.document });
  frame.init(bootstrap === undefined ? {} : { bootstrap });
  await flush();
  return frame;
}

/** Clicks Choose in a hosted panel and settles until the (stub) Picker is open. */
async function openHostedPicker() {
  button(frame, 'Choose spreadsheet').click();
  await flush();
  const [script] = pickerScripts(frame);
  if (script !== undefined) {
    installGapi({ window: frame.window, pickerApi });
    script.onload();
    await flush();
  }
}

const statusLine = () => frame.document.querySelector('[role="status"]');

test('starts itself on load: lists the chosen spreadsheets once the host init arrives (no start data: no Choose button)', async () => {
  boot.respond.set('list-picked', () => ({ spreadsheets: [] }));
  const before = boot.posted.length;
  boot.init();
  await flush();
  assert.deepEqual({ before, requests: boot.requests() }, { before: 0, requests: [{ action: 'list-picked', payload: {} }] });
  assert.equal(boot.document.querySelector('.notice').textContent, pickerIntro({ bootstrap: undefined }));
  assert.deepEqual(buttonLabels(boot), []);
  assert.ok(screenText(boot).includes('None yet.'));
  boot.close();
});

test('an unavailable bootstrap shows why and offers no Choose button', async () => {
  await openPanel({ mode: 'unavailable', reason: 'not-connected', message: 'Connect a Google account first.' });
  assert.equal(frame.document.querySelector('.notice').textContent, 'Connect a Google account first.');
  assert.deepEqual(buttonLabels(frame), []);
});

test('a ready bootstrap shows the intro and the Choose button', async () => {
  await openPanel(SYSTEM);
  assert.equal(frame.document.querySelector('.intro').textContent, pickerIntro({ bootstrap: SYSTEM }));
  assert.deepEqual(buttonLabels(frame), ['Choose spreadsheet']);
});

test('the chosen spreadsheets are listed with their title and id', async () => {
  await openPanel(SYSTEM, [LEADS]);
  assert.deepEqual([...frame.document.querySelectorAll('li')].map((item) => [item.querySelector('strong').textContent, item.querySelector('code').textContent]), [['Leads', FILE_ID]]);
});

test('hosted: a pick is verified by the server, named in the status line, and the list is refreshed', async () => {
  await openPanel(HOSTED);
  await openHostedPicker();
  frame.respond.set('verify-picked', () => ({ spreadsheet: LEADS }));
  frame.respond.set('list-picked', () => ({ spreadsheets: [LEADS] }));
  pickerApi.fire({ action: 'picked', docs: [{ id: FILE_ID }] });
  await flush();
  assert.deepEqual(frame.requests().map((request) => request.action), ['list-picked', 'verify-picked', 'list-picked']);
  assert.equal(statusLine().textContent, 'Chosen: Leads.');
  assert.equal(frame.document.querySelector('li strong').textContent, 'Leads');
  assert.equal(button(frame, 'Choose spreadsheet').disabled, false);
});

test('hosted: while the Picker is open the Choose button is disabled and there is no Stop waiting button', async () => {
  await openPanel(HOSTED);
  await openHostedPicker();
  const state = { disabled: button(frame, 'Choose spreadsheet').disabled, labels: buttonLabels(frame) };
  pickerApi.fire({ action: 'cancel' });
  await flush();
  assert.deepEqual(state, { disabled: true, labels: ['Choose spreadsheet'] });
});

test('security: a hosted cancel asks the server nothing and says the saved settings did not change', async () => {
  await openPanel(HOSTED);
  await openHostedPicker();
  pickerApi.fire({ action: 'cancel' });
  await flush();
  assert.deepEqual(frame.requests().map((request) => request.action), ['list-picked', 'list-picked']);
  assert.equal(statusLine().textContent, CANCELLED_TEXT);
});

test('system browser: Choose starts the sign-in, shows the browser step and a Stop waiting button, then shows the verified pick', async () => {
  await openPanel(SYSTEM);
  frame.respond.set('start-system-picker', () => ({ expiresAt: new Date(NOW + 600_000).toISOString() }));
  frame.respond.set('finish-system-picker', () => ({ status: 'selected', spreadsheet: LEADS }));
  button(frame, 'Choose spreadsheet').click();
  await flush();
  const waiting = { status: statusLine().textContent, labels: buttonLabels(frame), chooseDisabled: button(frame, 'Choose spreadsheet').disabled };
  mock.timers.tick(3000);
  await flush();
  assert.deepEqual(waiting, { status: pollText({ status: 'waiting' }), labels: ['Choose spreadsheet', 'Stop waiting'], chooseDisabled: true });
  assert.deepEqual({ status: statusLine().textContent, labels: buttonLabels(frame) }, { status: 'Chosen: Leads.', labels: ['Choose spreadsheet'] });
});

test('system browser: Stop waiting stops the poll and says nothing was chosen', async () => {
  await openPanel(SYSTEM);
  frame.respond.set('start-system-picker', () => ({ expiresAt: new Date(NOW + 600_000).toISOString() }));
  frame.respond.set('finish-system-picker', () => ({ status: 'waiting' }));
  button(frame, 'Choose spreadsheet').click();
  await flush();
  button(frame, 'Stop waiting').click();
  const stopping = statusLine().textContent;
  mock.timers.tick(3000);
  await flush();
  mock.timers.tick(30_000);
  await flush();
  assert.equal(stopping, 'Stopping…');
  assert.equal(statusLine().textContent, CANCELLED_TEXT);
  assert.deepEqual(frame.requests().map((request) => request.action), ['list-picked', 'start-system-picker', 'finish-system-picker', 'list-picked']);
});

test('system browser: an expired link keeps its own sentence (not the generic cancel line)', async () => {
  await openPanel(SYSTEM);
  frame.respond.set('start-system-picker', () => ({ expiresAt: new Date(NOW + 600_000).toISOString() }));
  frame.respond.set('finish-system-picker', () => ({ status: 'expired' }));
  button(frame, 'Choose spreadsheet').click();
  await flush();
  mock.timers.tick(3000);
  await flush();
  assert.equal(statusLine().textContent, pollText({ status: 'expired' }));
});

test('a refused choice shows the host sentence and leaves Choose usable', async () => {
  await openPanel(SYSTEM);
  frame.respond.set('start-system-picker', () => { throw refusal('Grant the Google Sheets permission first.'); });
  button(frame, 'Choose spreadsheet').click();
  await flush();
  assert.equal(statusLine().textContent, 'Grant the Google Sheets permission first.');
  assert.equal(button(frame, 'Choose spreadsheet').disabled, false);
});

test('a list that fails to refresh after a choice shows the host sentence and leaves Choose usable', async () => {
  await openPanel(SYSTEM);
  frame.respond.set('start-system-picker', () => ({ expiresAt: new Date(NOW + 600_000).toISOString() }));
  frame.respond.set('finish-system-picker', () => ({ status: 'selected', spreadsheet: LEADS }));
  frame.respond.set('list-picked', () => { throw refusal('The host did not answer in time. Try again.', { code: 'timeout', retryable: true }); });
  button(frame, 'Choose spreadsheet').click();
  await flush();
  mock.timers.tick(3000);
  await flush();
  assert.equal(statusLine().textContent, 'The host did not answer in time. Try again.');
  assert.equal(button(frame, 'Choose spreadsheet').disabled, false);
});

test('a first list that fails shows the host sentence', async () => {
  frame = createFrame();
  frame.respond.set('list-picked', () => { throw refusal('Reconnect Google, then open this panel again.'); });
  initPickerPanel({ window: frame.window, document: frame.document });
  frame.init({ bootstrap: SYSTEM });
  await flush();
  assert.equal(frame.document.getElementById('app').innerHTML, '<p class="notice" role="status">Reconnect Google, then open this panel again.</p>');
});

test('security: the bootstrap access token goes to the Picker builder only, never into the DOM', async () => {
  await openPanel(HOSTED, [LEADS]);
  await openHostedPicker();
  const builtWith = pickerApi.builds.at(-1).oauthToken;
  frame.respond.set('verify-picked', () => ({ spreadsheet: LEADS }));
  pickerApi.fire({ action: 'picked', docs: [{ id: FILE_ID }] });
  await flush();
  assert.equal(builtWith, PICKER_TOKEN);
  assert.equal(frame.document.documentElement.outerHTML.includes(PICKER_TOKEN), false);
  assert.equal(frame.posted.some((entry) => JSON.stringify(entry.message).includes(PICKER_TOKEN)), false);
});

test('security: spreadsheet titles and ids from the server are shown as text, never markup', async () => {
  await openPanel(SYSTEM, [{ spreadsheetId: MARKUP, title: MARKUP, url: LEADS.url }]);
  frame.respond.set('start-system-picker', () => ({ expiresAt: new Date(NOW + 600_000).toISOString() }));
  frame.respond.set('finish-system-picker', () => ({ status: 'selected', spreadsheet: { ...LEADS, title: MARKUP } }));
  button(frame, 'Choose spreadsheet').click();
  await flush();
  mock.timers.tick(3000);
  await flush();
  assert.equal(frame.document.querySelector('img'), null);
  assert.equal(statusLine().textContent, `Chosen: ${MARKUP}.`);
  assert.equal(frame.document.querySelector('li code').textContent, MARKUP);
});

test('security: everything the panel posts is a declared picker action, to the host origin, for its mount', async () => {
  await openPanel(SYSTEM);
  frame.respond.set('start-system-picker', () => ({ expiresAt: new Date(NOW + 600_000).toISOString() }));
  frame.respond.set('finish-system-picker', () => ({ status: 'selected', spreadsheet: LEADS }));
  button(frame, 'Choose spreadsheet').click();
  await flush();
  mock.timers.tick(3000);
  await flush();
  const declared = declaredActions({ surfaceId: 'picker' });
  assert.deepEqual(frame.posted.map((entry) => entry.message.kind), ['action-request', 'action-request', 'action-request', 'action-request']);
  assert.equal(frame.requests().every((request) => declared.includes(request.action)), true);
  assert.equal(frame.posted.every((entry) => entry.targetOrigin === HOST_ORIGIN && entry.message.mountId === MOUNT_ID), true);
});

test('a first list the host calls retryable offers Try again, which lists again', async () => {
  frame = createFrame();
  let asked = 0;
  frame.respond.set('list-picked', () => {
    asked += 1;
    if (asked === 1) throw refusal('The host did not answer in time. Try again.', { code: 'timeout', retryable: true });
    return { spreadsheets: [] };
  });
  initPickerPanel({ window: frame.window, document: frame.document });
  frame.init({ bootstrap: SYSTEM });
  await flush();
  assert.equal(frame.document.querySelector('.notice').textContent, 'The host did not answer in time. Try again.');
  button(frame, 'Try again').click();
  await flush();
  assert.equal(asked, 2);
  assert.equal(frame.document.querySelector('.notice-group'), null);
  assert.equal(button(frame, 'Choose spreadsheet').disabled, false);
});
