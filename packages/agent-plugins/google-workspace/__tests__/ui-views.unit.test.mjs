/**
 * @file Unit pins for the panels' pure wording modules (`ui/connection-view.mjs`,
 * `ui/picker-view.mjs`): the heading, explanation and buttons per connection state, the product
 * rows that keep "on/off" apart from "Google granted the permission", and the Picker lines. The
 * wording is the honesty property here (never claim a revocation or a grant nobody confirmed), so
 * each state's text is pinned exactly where it carries that meaning.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { SWITCH_NOTE, connectionSummary, productRows, reassignmentMessage } from '../ui/connection-view.mjs';
import { CANCELLED_TEXT, EXTERNAL_ROWS_NOTE, pickerIntro, pollText, selectedText } from '../ui/picker-view.mjs';

const actions = (summary) => summary.buttons.map((entry) => entry.action);
const SHEETS = { id: 'sheets', label: 'Google Sheets' };

test('connection view: disconnected offers only Connect', () => {
  const summary = connectionSummary({ connection: { status: 'disconnected' } });
  assert.equal(summary.heading, 'Not connected');
  assert.deepEqual(actions(summary), ['connect']);
});

test('connection view: an unknown status reads as not connected, never as connected', () => {
  assert.equal(connectionSummary({ connection: { status: 'something-new' } }).heading, 'Not connected');
});

test('connection view: connected names the account and offers reconnect, switch and disconnect', () => {
  const summary = connectionSummary({ connection: { status: 'connected', accountLabel: 'alice@example.test' } });
  assert.equal(summary.heading, 'Connected as alice@example.test');
  assert.deepEqual(actions(summary), ['reconnect', 'switch', 'disconnect']);
});

test('connection view: connected without an account label still says connected, without inventing a name', () => {
  assert.equal(connectionSummary({ connection: { status: 'connected' } }).heading, 'Connected as a Google account');
});

test('connection view: reconnect-required says deliveries fail and are not re-sent after reconnecting, and offers reconnect or disconnect', () => {
  const summary = connectionSummary({ connection: { status: 'reconnect-required' } });
  assert.equal(summary.heading, 'Reconnect required');
  assert.match(summary.detail, /Form deliveries fail while it is like this and stay listed as failed; they are not sent again after you reconnect/);
  assert.deepEqual(actions(summary), ['reconnect', 'disconnect']);
});

test('connection view: a staged switch without a current label names the new account and asks before changing', () => {
  const summary = connectionSummary({ connection: { status: 'connected', pendingSwitchAccountLabel: 'bob@example.test' } });
  assert.equal(summary.heading, 'Switch to bob@example.test?');
  assert.equal(summary.detail, `Signed in now as the current account. Nothing changes until you confirm. ${SWITCH_NOTE}`);
  assert.deepEqual(summary.buttons, [{ action: 'confirm-switch', label: 'Use bob@example.test' }, { action: 'cancel-switch', label: 'Keep the current account' }]);
});

test('reassignment message: a switch with no destinations says only that the account switched', () => {
  assert.equal(reassignmentMessage({ reassignment: { moved: [], failed: [] }, destinations: [] }), 'Switched account.');
});

test('reassignment message: an unticked destination is named as still using the old account', () => {
  assert.equal(reassignmentMessage({ reassignment: { moved: [], failed: [] }, destinations: [{ formSlug: 'contact' }] }), 'Switched account. Still using the old account (deliveries fail until you choose the spreadsheet again in Form destinations): contact.');
});

test('product rows: off says deliveries are retried for about a day then fail (never "paused"), keeps the sign-in, with a turn-on toggle and no grant button', () => {
  const [row] = productRows({ products: [{ ...SHEETS, enabled: false, granted: true }], connection: { status: 'connected' } });
  assert.deepEqual(row, { id: 'sheets', label: 'Google Sheets', enabled: false, state: 'Not in use', note: 'Not in use. Turn it on to use Google Sheets in assistant tools and form deliveries. Turning it off later keeps the Google sign-in; deliveries already queued retry for about a day.', toggleLabel: 'Turn Google Sheets on', grant: false });
});

test('product rows: on while not connected asks to connect, with no grant button', () => {
  const [row] = productRows({ products: [{ ...SHEETS, enabled: true, granted: false }], connection: { status: 'disconnected' } });
  assert.deepEqual([row.note, row.toggleLabel, row.grant], ['On. Connect a Google account to use it.', 'Turn Google Sheets off', false]);
});

test('product rows: on and granted says Google granted it', () => {
  const [row] = productRows({ products: [{ ...SHEETS, enabled: true, granted: true }], connection: { status: 'connected' } });
  assert.deepEqual([row.note, row.grant], ['On. Google has granted the permission it needs.', false]);
});

test('product rows: on but not granted says so and offers the separate grant sign-in', () => {
  const [row] = productRows({ products: [{ ...SHEETS, enabled: true, granted: false }], connection: { status: 'connected' } });
  assert.deepEqual([row.note, row.grant], ['On, but Google has not granted its permission yet. Grant it to use this product.', true]);
});

test('picker view: the intro per bootstrap mode, including no start data in time', () => {
  assert.equal(pickerIntro({ bootstrap: undefined }), 'The panel did not receive its start data in time. Close it and open it again.');
  assert.equal(pickerIntro({ bootstrap: { mode: 'unavailable', message: 'Turn it on.' } }), 'Turn it on.');
  assert.equal(pickerIntro({ bootstrap: { mode: 'unavailable' } }), 'Google Sheets is not ready. Check the Google Workspace connection panel.');
  assert.equal(pickerIntro({ bootstrap: { mode: 'hosted' } }), 'Choose a Google Sheets spreadsheet. This site gets access to that one file only.');
  assert.match(pickerIntro({ bootstrap: { mode: 'system-browser' } }), /file picker opens in your browser/);
});

test('picker view: each poll outcome has its line and an unknown one reads as no picker open', () => {
  assert.match(pollText({ status: 'waiting' }), /Continue to sign-in/);
  assert.match(pollText({ status: 'expired' }), /expired before a spreadsheet was chosen/);
  assert.equal(pollText({ status: 'cancelled' }), CANCELLED_TEXT);
  assert.equal(pollText({ status: 'none' }), 'No file picker is open. Start again.');
  assert.equal(pollText({ status: 'later' }), 'No file picker is open. Start again.');
});

test('picker view: a selection is named by its title, and the external-rows note says local deletes leave rows', () => {
  assert.equal(selectedText({ spreadsheet: { title: 'Leads' } }), 'Chosen: Leads.');
  assert.match(EXTERNAL_ROWS_NOTE, /does not delete them/);
});
