/**
 * @file Frame tests for `ui/picker-flow.mjs` ("Choose spreadsheet") in jsdom: the hosted JS Picker
 * (Google's script and `window.google.picker` are stubs from `frame-harness.mjs`; nothing loads) and
 * the desktop system-browser poll (mocked timers), against a fake surface client.
 *
 * Order matters in this file, on purpose: the frame loads Google's Picker library once and keeps it
 * for the frame's life (module state), so the two load-failure tests run before the first successful
 * load, and every later hosted test reuses that loaded library (one shared fake Picker API).
 */
import assert from 'node:assert/strict';
import { afterEach, beforeEach, mock, test } from 'node:test';

import { chooseSpreadsheet } from '../ui/picker-flow.mjs';
import { CANCELLED_TEXT, pollText } from '../ui/picker-view.mjs';
import {
  PICKER_SCRIPT, PICKER_TOKEN, SPREADSHEET_MIME_TYPE, createFakePickerApi, createFrame, flush, installGapi, pickerScripts,
} from './frame-harness.mjs';

const LOAD_FAILED = 'Google\'s file picker could not load (a blocked script, network, or browser setting). Allow apis.google.com and try again.';
const FILE_ID = '1AbC-dEf_ghIJklmnOPqrs';
const VERIFIED = Object.freeze({ spreadsheetId: FILE_ID, title: 'Leads (verified)', url: `https://docs.google.com/spreadsheets/d/${FILE_ID}/edit` });
const NOW = Date.parse('2030-01-01T00:00:00Z');
const HOSTED = Object.freeze({ mode: 'hosted', picker: Object.freeze({ accessToken: PICKER_TOKEN, developerKey: 'browser-key-placeholder', appId: '123456', sessionId: 'session-1' }) });
const SYSTEM = Object.freeze({ mode: 'system-browser' });
const pickerApi = createFakePickerApi();

/**
 * A fake of the surface client's `call` (`ui/surface-client.mjs`): answers each action from
 * `answers` (a value, or a function of the payload; a list is answered in order) and records calls.
 * @param {Record<string, unknown>} answers
 * @returns {{ calls: Array<{ action: string, payload: object }>, call: (input: { action: string, payload: object }) => Promise<unknown> }}
 */
function fakeClient(answers) {
  const calls = [];
  return {
    calls,
    async call({ action, payload }) {
      calls.push({ action, payload });
      const answer = answers[action];
      if (Array.isArray(answer)) return answer.shift();
      return typeof answer === 'function' ? answer(payload) : answer;
    },
  };
}

let frame;
beforeEach(() => { frame = createFrame(); mock.timers.enable({ apis: ['setTimeout', 'Date'], now: NOW }); });
afterEach(() => { mock.timers.reset(); frame.close(); });

/** Starts a hosted choice and settles until the Picker is built (loading the library if asked). */
async function openHosted(client, optional = {}) {
  const statuses = [];
  const result = chooseSpreadsheet({ client, bootstrap: HOSTED, onStatus: (text) => { statuses.push(text); } });
  // Observed here so a rejection during the settling below is not reported as unhandled; the test
  // still asserts on `result` itself.
  result.catch(() => {});
  await flush();
  if (optional.load) {
    installGapi({ window: frame.window, pickerApi }, { failLoad: optional.failLoad === 'gapi' });
    const [script] = pickerScripts(frame);
    if (optional.failLoad === 'script') script.onerror();
    else script.onload();
    await flush();
  }
  return { result, statuses };
}

test('hosted: a blocked Picker script rejects with the allow-apis.google.com sentence and asks the server nothing', async () => {
  const client = fakeClient({});
  const { result } = await openHosted(client, { load: true, failLoad: 'script' });
  await assert.rejects(result, { message: LOAD_FAILED });
  assert.deepEqual(client.calls, []);
});

test('hosted: after a blocked script, choosing again adds the script again (the sentence says "try again"); a failure inside Google\'s loader rejects with the same sentence', async () => {
  const client = fakeClient({});
  const { result } = await openHosted(client);
  const scripts = pickerScripts(frame).length;
  assert.equal(scripts, 1);
  installGapi({ window: frame.window, pickerApi }, { failLoad: 'gapi' });
  pickerScripts(frame)[0].onload();
  await assert.rejects(result, { message: LOAD_FAILED });
});

test('hosted: after a failure inside Google\'s loader, the next choice loads the library again and the pick resolves', async () => {
  const client = fakeClient({ 'verify-picked': { spreadsheet: VERIFIED } });
  const { result } = await openHosted(client, { load: true });
  assert.deepEqual(pickerScripts(frame).map((script) => script.src), [PICKER_SCRIPT]);
  pickerApi.fire({ action: 'picked', docs: [{ id: FILE_ID }] });
  assert.deepEqual(await result, VERIFIED);
});

test('hosted: once loaded, later choices reuse the library (no second script)', async () => {
  const builds = pickerApi.builds.length;
  const { result } = await openHosted(fakeClient({}));
  const opened = { scripts: pickerScripts(frame).length, newBuilds: pickerApi.builds.length - builds };
  assert.deepEqual(opened, { scripts: 0, newBuilds: 1 });
  pickerApi.fire({ action: 'cancel' });
  assert.equal(await result, null);
});

test('hosted: the Picker opens with the bootstrap key, app id and short-lived token, spreadsheets only, visible', async () => {
  const { result } = await openHosted(fakeClient({}));
  const config = pickerApi.builds.at(-1);
  pickerApi.fire({ action: 'cancel' });
  await result;
  assert.deepEqual({
    developerKey: config.developerKey, appId: config.appId, oauthToken: config.oauthToken, visible: config.visible,
    views: config.views.map((view) => [view.viewId, view.mimeTypes]),
  }, {
    developerKey: 'browser-key-placeholder', appId: '123456', oauthToken: PICKER_TOKEN, visible: true,
    views: [['spreadsheets-view', SPREADSHEET_MIME_TYPE]],
  });
});

test('hosted: the picked file id is only a claim; it goes to verify-picked with the session, and the server answer is the result', async () => {
  const client = fakeClient({ 'verify-picked': { spreadsheet: VERIFIED } });
  const { result } = await openHosted(client);
  pickerApi.fire({ action: 'picked', docs: [{ id: FILE_ID, name: 'Leads (claimed by the frame)' }] });
  assert.deepEqual(await result, VERIFIED);
  assert.deepEqual(client.calls, [{ action: 'verify-picked', payload: { sessionId: 'session-1', fileId: FILE_ID } }]);
});

test('security: a hosted cancel resolves null and asks the server nothing', async () => {
  const client = fakeClient({});
  const { result, statuses } = await openHosted(client);
  pickerApi.fire({ action: 'cancel' });
  assert.equal(await result, null);
  assert.deepEqual({ calls: client.calls, statuses }, { calls: [], statuses: [] });
});

test('hosted: Picker events other than picked or cancel (such as loaded) leave the choice open', async () => {
  const client = fakeClient({ 'verify-picked': { spreadsheet: VERIFIED } });
  const { result } = await openHosted(client);
  let settled = false;
  result.then(() => { settled = true; });
  pickerApi.fire({ action: 'loaded' });
  await flush();
  const afterLoaded = settled;
  pickerApi.fire({ action: 'picked', docs: [{ id: FILE_ID }] });
  await result;
  assert.equal(afterLoaded, false);
});

test('hosted: a picked event without a usable document id resolves null and asks the server nothing', async () => {
  for (const data of [{ action: 'picked' }, { action: 'picked', docs: [] }, { action: 'picked', docs: [{ name: 'no id' }] }]) {
    const client = fakeClient({});
    const { result } = await openHosted(client);
    pickerApi.fire(data);
    assert.equal(await result, null, JSON.stringify(data));
    assert.deepEqual(client.calls, []);
  }
});

test('hosted: a refused verification rejects with the server refusal (nothing is chosen)', async () => {
  const client = fakeClient({ 'verify-picked': () => { throw new Error('That file is not a spreadsheet this site can open. Choose it again.'); } });
  const { result } = await openHosted(client);
  pickerApi.fire({ action: 'picked', docs: [{ id: FILE_ID }] });
  await assert.rejects(result, { message: 'That file is not a spreadsheet this site can open. Choose it again.' });
});

/** Starts a system-browser choice; `ticks` advance the 3 s poll one step each. */
async function systemChoice(client, optional = {}) {
  const statuses = [];
  const result = chooseSpreadsheet({ client, bootstrap: SYSTEM, onStatus: (text) => { statuses.push(text); }, ...optional });
  await flush();
  return { result, statuses };
}

async function poll() {
  mock.timers.tick(3000);
  await flush();
}

test('system browser: starts the sign-in, says to continue in the browser, polls every 3 s and resolves the verified selection', async () => {
  const client = fakeClient({
    'start-system-picker': { expiresAt: new Date(NOW + 600_000).toISOString() },
    'finish-system-picker': [{ status: 'waiting' }, { status: 'selected', spreadsheet: VERIFIED }],
  });
  const { result, statuses } = await systemChoice(client);
  const beforePoll = client.calls.length;
  await poll();
  await poll();
  assert.deepEqual(await result, VERIFIED);
  assert.deepEqual({ beforePoll, actions: client.calls.map((call) => call.action), statuses }, {
    beforePoll: 1, actions: ['start-system-picker', 'finish-system-picker', 'finish-system-picker'], statuses: [pollText({ status: 'waiting' })],
  });
});

test('system browser: a final cancelled, none or expired answer shows its sentence and resolves null', async () => {
  for (const status of ['cancelled', 'none', 'expired']) {
    const client = fakeClient({ 'start-system-picker': { expiresAt: new Date(Date.now() + 600_000).toISOString() }, 'finish-system-picker': { status } });
    const { result, statuses } = await systemChoice(client);
    await poll();
    assert.equal(await result, null);
    assert.deepEqual(statuses.slice(1), [pollText({ status })], status);
  }
});

test('system browser: polling stops one poll after the link expires and says it expired', async () => {
  const client = fakeClient({ 'start-system-picker': { expiresAt: new Date(NOW + 3000).toISOString() }, 'finish-system-picker': { status: 'waiting' } });
  const { result, statuses } = await systemChoice(client);
  let settled = false;
  result.then(() => { settled = true; });
  await poll();
  await poll();
  assert.deepEqual({ settled, finishes: client.calls.filter((call) => call.action === 'finish-system-picker').length, last: statuses.at(-1) }, { settled: true, finishes: 2, last: pollText({ status: 'expired' }) });
  assert.equal(await result, null);
});

test('system browser: when the person stops waiting, polling stops and the panel says nothing was chosen', async () => {
  let stop = false;
  const client = fakeClient({ 'start-system-picker': { expiresAt: new Date(NOW + 600_000).toISOString() }, 'finish-system-picker': { status: 'waiting' } });
  const { result, statuses } = await systemChoice(client, { stopped: () => stop });
  await poll();
  stop = true;
  await poll();
  assert.equal(await result, null);
  assert.deepEqual({ finishes: client.calls.filter((call) => call.action === 'finish-system-picker').length, last: statuses.at(-1) }, { finishes: 2, last: CANCELLED_TEXT });
});

test('system browser: a person who stops before the first poll gets no poll at all', async () => {
  const client = fakeClient({ 'start-system-picker': { expiresAt: new Date(NOW + 600_000).toISOString() } });
  const { result, statuses } = await systemChoice(client, { stopped: () => true });
  assert.equal(await result, null);
  assert.deepEqual({ actions: client.calls.map((call) => call.action), last: statuses.at(-1) }, { actions: ['start-system-picker'], last: CANCELLED_TEXT });
});
