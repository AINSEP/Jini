/**
 * @file Frame tests for `ui/connection-panel.mjs` in jsdom (`frame-harness.mjs`): what the panel
 * renders for each host answer, which declared action every button sends, the sign-in status poll
 * (mocked timers), the disconnect/revocation wording, and the trust rules (posts only declared
 * actions to the host origin for its mount, never renders server text as markup, ignores forged
 * answers).
 */
import assert from 'node:assert/strict';
import { afterEach, beforeEach, mock, test } from 'node:test';

import { DISCONNECT_CONFIRM_TEXT, REVOCATION_PENDING_TEXT } from '../ui/connection-view.mjs';
import {
  HOST_ORIGIN, MARKUP, MOUNT_ID, button, buttonLabels, createFrame, declaredActions, flush, refusal, screenText,
} from './frame-harness.mjs';

// The entry script starts itself on import, in whatever frame the globals name: give it one.
const boot = createFrame();
const { initConnectionPanel } = await import('../ui/connection-panel.mjs');

const ACCOUNT_ACCESS = 'https://myaccount.google.com/connections';
const CONTINUE_TEXT = 'Continue with the "Continue to sign-in" button the admin page shows above this panel. This panel updates when you are done.';
const EXPIRED_TEXT = 'The sign-in link expired. Start it again if you still want to change the connection.';
const NOW = Date.parse('2030-01-01T00:00:00Z');

/** A panel view in the `status` result shape declared in `tovu-admin-surfaces.json`. */
function panelView(optional = {}) {
  return {
    connection: { status: 'connected', grantedProducts: ['sheets'], accountLabel: 'Alice', ...optional.connection },
    products: optional.products ?? [{ id: 'sheets', label: 'Google Sheets', enabled: true, granted: true }],
    destinations: optional.destinations ?? [],
    accountAccessUrl: ACCOUNT_ACCESS,
    ...(optional.revocation ? { revocation: optional.revocation } : {}),
  };
}

let frame;
beforeEach(() => { mock.timers.enable({ apis: ['setTimeout', 'Date'], now: NOW }); });
afterEach(() => { mock.timers.reset(); frame?.close(); frame = undefined; });

/** A fresh panel whose host answers `status` with `view`, initialised and rendered. */
async function openPanel(view) {
  frame = createFrame();
  frame.respond.set('status', () => view);
  initConnectionPanel({ window: frame.window, document: frame.document });
  frame.init();
  await flush();
  return frame;
}

const notice = (target) => target.document.querySelector('.notice');

test('starts itself on load: asks for the status once the host init arrives, then renders the account', async () => {
  boot.respond.set('status', () => panelView());
  const before = boot.posted.length;
  boot.init();
  await flush();
  assert.deepEqual({ before, requests: boot.requests() }, { before: 0, requests: [{ action: 'status', payload: {} }] });
  assert.equal(boot.document.getElementById('account-heading').textContent, 'Connected as Alice');
  boot.close();
});

test('a failed first status shows the host sentence in place of the panel', async () => {
  frame = createFrame();
  frame.respond.set('status', () => { throw refusal('Google Workspace is not set up on this site.'); });
  initConnectionPanel({ window: frame.window, document: frame.document });
  frame.init();
  await flush();
  assert.equal(frame.document.getElementById('app').innerHTML, '<p class="notice" role="status">Google Workspace is not set up on this site.</p>');
});

test('Connect asks the host for a connect sign-in and says where to continue', async () => {
  await openPanel(panelView({ connection: { status: 'disconnected', grantedProducts: [], accountLabel: undefined } }));
  frame.respond.set('sign-in', () => ({ expiresAt: new Date(NOW + 600_000).toISOString() }));
  button(frame, 'Connect Google account').click();
  await flush();
  assert.deepEqual(frame.requests().at(-1), { action: 'sign-in', payload: { action: 'connect' } });
  assert.equal(notice(frame).textContent, CONTINUE_TEXT);
});

test('Switch account asks the host for a switch sign-in', async () => {
  await openPanel(panelView());
  frame.respond.set('sign-in', () => ({ expiresAt: new Date(NOW + 600_000).toISOString() }));
  button(frame, 'Switch account').click();
  await flush();
  assert.deepEqual(frame.requests().at(-1), { action: 'sign-in', payload: { action: 'switch' } });
});

test('Grant permission asks the host for an add-scopes sign-in (a separate step from turning the product on)', async () => {
  await openPanel(panelView({ products: [{ id: 'sheets', label: 'Google Sheets', enabled: true, granted: false }] }));
  frame.respond.set('sign-in', () => ({ expiresAt: new Date(NOW + 600_000).toISOString() }));
  button(frame, 'Grant permission').click();
  await flush();
  assert.deepEqual(frame.requests().at(-1), { action: 'sign-in', payload: { action: 'add-scopes' } });
});

test('after a sign-in starts, the panel polls the status every 4 s until the connection changes, then shows it', async () => {
  await openPanel(panelView());
  frame.respond.set('sign-in', () => ({ expiresAt: new Date(NOW + 600_000).toISOString() }));
  button(frame, 'Reconnect').click();
  await flush();
  mock.timers.tick(3999);
  await flush();
  const beforeFirstPoll = frame.requests().length;
  mock.timers.tick(1);
  await flush();
  const afterUnchangedPoll = { count: frame.requests().length, heading: frame.document.getElementById('account-heading').textContent };
  frame.respond.set('status', () => panelView({ connection: { accountLabel: 'Bob' } }));
  mock.timers.tick(4000);
  await flush();
  assert.deepEqual({ beforeFirstPoll, afterUnchangedPoll }, { beforeFirstPoll: 2, afterUnchangedPoll: { count: 3, heading: 'Connected as Alice' } });
  assert.equal(frame.document.getElementById('account-heading').textContent, 'Connected as Bob');
});

test('once the sign-in finished, the "continue to sign-in" instruction is gone', async () => {
  await openPanel(panelView());
  frame.respond.set('sign-in', () => ({ expiresAt: new Date(NOW + 600_000).toISOString() }));
  button(frame, 'Reconnect').click();
  await flush();
  frame.respond.set('status', () => panelView({ connection: { accountLabel: 'Bob' } }));
  mock.timers.tick(4000);
  await flush();
  assert.equal(screenText(frame).includes(CONTINUE_TEXT), false);
  assert.equal(notice(frame), null);
});

test('a sign-in link that expires stops the polling and says it expired', async () => {
  await openPanel(panelView());
  frame.respond.set('sign-in', () => ({ expiresAt: new Date(NOW + 5000).toISOString() }));
  button(frame, 'Reconnect').click();
  await flush();
  mock.timers.tick(4000);
  await flush();
  mock.timers.tick(4000);
  await flush();
  const requestsAtExpiry = frame.requests().length;
  mock.timers.tick(40_000);
  await flush();
  assert.equal(notice(frame).textContent, EXPIRED_TEXT);
  assert.deepEqual({ requestsAtExpiry, later: frame.requests().length }, { requestsAtExpiry: 5, later: 5 });
});

test('Disconnect and revoke: a confirmed revocation reads as confirmed', async () => {
  await openPanel(panelView());
  frame.respond.set('disconnect', () => panelView({ connection: { status: 'disconnected', grantedProducts: [], accountLabel: undefined }, revocation: 'confirmed' }));
  button(frame, 'Disconnect and revoke').click();
  button(frame, 'Yes, disconnect and revoke').click();
  await flush();
  assert.deepEqual(frame.requests().at(-1), { action: 'disconnect', payload: {} });
  assert.equal(frame.document.querySelector('.confirm'), null);
  assert.equal(notice(frame).className, 'notice ok');
  assert.equal(notice(frame).textContent, 'Disconnected. Google confirmed that this site\'s access to the account was removed.');
});

test('Disconnect and revoke: a pending revocation never reads as revoked, and offers the Google Account page', async () => {
  await openPanel(panelView());
  frame.respond.set('disconnect', () => panelView({ connection: { status: 'revocation-pending', grantedProducts: [], accountLabel: undefined }, revocation: 'pending' }));
  button(frame, 'Disconnect and revoke').click();
  button(frame, 'Yes, disconnect and revoke').click();
  await flush();
  assert.equal(notice(frame).className, 'notice warn');
  assert.ok(notice(frame).textContent.startsWith(`${REVOCATION_PENDING_TEXT}.`));
  assert.equal(frame.document.getElementById('account-heading').textContent, REVOCATION_PENDING_TEXT);
  assert.deepEqual(buttonLabels(frame).slice(0, 3), ['Retry Google revocation', 'Connect again', 'Open Google Account page']);
  assert.equal(frame.document.querySelector('.url').textContent, ACCOUNT_ACCESS);
});

test('Disconnect and revoke asks first inside the panel and sends nothing until confirmed', async () => {
  await openPanel(panelView());
  button(frame, 'Disconnect and revoke').click();
  await flush();
  assert.equal(frame.document.querySelector('.confirm p').textContent, DISCONNECT_CONFIRM_TEXT);
  assert.deepEqual(frame.requests().map((request) => request.action), ['status']);
});

test('Cancel on the disconnect question removes it and sends nothing', async () => {
  await openPanel(panelView());
  button(frame, 'Disconnect and revoke').click();
  button(frame, 'Cancel').click();
  await flush();
  assert.equal(frame.document.querySelector('.confirm'), null);
  assert.deepEqual(frame.requests().map((request) => request.action), ['status']);
});

test('Retry Google revocation sends disconnect again', async () => {
  await openPanel(panelView({ connection: { status: 'revocation-pending', grantedProducts: [], accountLabel: undefined } }));
  frame.respond.set('disconnect', () => panelView({ connection: { status: 'disconnected', grantedProducts: [], accountLabel: undefined }, revocation: 'confirmed' }));
  button(frame, 'Retry Google revocation').click();
  await flush();
  assert.deepEqual(frame.requests().at(-1), { action: 'disconnect', payload: {} });
  assert.equal(frame.document.getElementById('account-heading').textContent, 'Not connected');
});

test('Open Google Account page asks the host to open exactly the account-access address', async () => {
  await openPanel(panelView({ connection: { status: 'revocation-pending', grantedProducts: [], accountLabel: undefined } }));
  frame.respond.set('open-link', () => null);
  button(frame, 'Open Google Account page').click();
  await flush();
  const links = frame.posted.filter((entry) => entry.message.kind === 'open-link');
  assert.deepEqual(links.map((entry) => [entry.message.url, entry.targetOrigin]), [[ACCOUNT_ACCESS, HOST_ORIGIN]]);
  assert.equal(notice(frame), null);
});

test('a link the host refuses shows the host sentence and keeps the panel', async () => {
  await openPanel(panelView({ connection: { status: 'revocation-pending', grantedProducts: [], accountLabel: undefined } }));
  frame.respond.set('open-link', () => { throw refusal('This link cannot open from here.'); });
  button(frame, 'Open Google Account page').click();
  await flush();
  assert.equal(notice(frame).textContent, 'This link cannot open from here.');
  assert.equal(frame.document.getElementById('account-heading').textContent, REVOCATION_PENDING_TEXT);
});

test('a staged switch names the new account and lists the form destinations that would move', async () => {
  await openPanel(panelView({
    connection: { pendingSwitchAccountLabel: 'Bob' },
    destinations: [{ formSlug: 'contact', title: 'Leads', tabTitle: 'Contact' }],
  }));
  assert.equal(frame.document.getElementById('account-heading').textContent, 'Switch to Bob?');
  const boxes = [...frame.document.querySelectorAll('input[name="reassign"]')];
  assert.deepEqual(boxes.map((box) => [box.value, box.checked, box.closest('label').textContent]), [['contact', false, 'contact: Leads / Contact']]);
});

test('confirming a switch sends only the ticked destinations, then says what moved, what did not and what kept the old account', async () => {
  await openPanel(panelView({
    connection: { pendingSwitchAccountLabel: 'Bob' },
    destinations: [{ formSlug: 'contact', title: 'Leads', tabTitle: 'Contact' }, { formSlug: 'signup', title: 'Leads', tabTitle: 'Signup' }, { formSlug: 'survey', title: 'Polls', tabTitle: 'Survey' }],
  }));
  frame.respond.set('confirm-switch', () => ({ ...panelView({ connection: { accountLabel: 'Bob' } }), reassignment: { moved: ['contact'], failed: [{ formSlug: 'signup', code: 'file-not-granted', message: 'This site cannot open this file.' }] } }));
  const [contact, signup] = frame.document.querySelectorAll('input[name="reassign"]');
  contact.checked = true;
  signup.checked = true;
  button(frame, 'Use Bob').click();
  await flush();
  assert.deepEqual(frame.requests().at(-1), { action: 'confirm-switch', payload: { reassign: ['contact', 'signup'] } });
  assert.equal(notice(frame).textContent, 'Switched account. Now delivering as the new account: contact. Not moved, signup: This site cannot open this file. Still using the old account (deliveries fail until you choose the spreadsheet again in Form destinations): signup, survey.');
  assert.equal(notice(frame).className, 'notice warn');
});

test('a switch where every ticked destination moved reads as a success', async () => {
  await openPanel(panelView({ connection: { pendingSwitchAccountLabel: 'Bob' }, destinations: [{ formSlug: 'contact', title: 'Leads', tabTitle: 'Contact' }] }));
  frame.respond.set('confirm-switch', () => ({ ...panelView({ connection: { accountLabel: 'Bob' } }), reassignment: { moved: ['contact'], failed: [] } }));
  frame.document.querySelector('input[name="reassign"]').checked = true;
  button(frame, 'Use Bob').click();
  await flush();
  assert.deepEqual([notice(frame).textContent, notice(frame).className], ['Switched account. Now delivering as the new account: contact.', 'notice ok']);
});

test('a staged switch with no form destinations shows no destination list', async () => {
  await openPanel(panelView({ connection: { pendingSwitchAccountLabel: 'Bob' }, products: [] }));
  assert.equal(frame.document.querySelectorAll('li, fieldset').length, 0);
});

test('a destination list is shown only while a switch is staged', async () => {
  await openPanel(panelView({ destinations: [{ formSlug: 'contact', title: 'Leads', tabTitle: 'Contact' }], products: [] }));
  assert.equal(frame.document.querySelectorAll('li, fieldset').length, 0);
});

test('Use <account> confirms the staged switch and shows the result', async () => {
  await openPanel(panelView({ connection: { pendingSwitchAccountLabel: 'Bob' } }));
  frame.respond.set('confirm-switch', () => ({ ...panelView({ connection: { accountLabel: 'Bob' } }), reassignment: { moved: [], failed: [] } }));
  button(frame, 'Use Bob').click();
  await flush();
  assert.deepEqual(frame.requests().at(-1), { action: 'confirm-switch', payload: { reassign: [] } });
  assert.equal(frame.document.getElementById('account-heading').textContent, 'Connected as Bob');
});

test('Keep the current account cancels the staged switch', async () => {
  await openPanel(panelView({ connection: { pendingSwitchAccountLabel: 'Bob' } }));
  frame.respond.set('cancel-switch', () => panelView());
  button(frame, 'Keep the current account').click();
  await flush();
  assert.deepEqual(frame.requests().at(-1), { action: 'cancel-switch', payload: {} });
  assert.equal(frame.document.getElementById('account-heading').textContent, 'Connected as Alice');
});

test('the product toggle sends set-product with the opposite state and shows the answer', async () => {
  await openPanel(panelView());
  const toggle = button(frame, 'Turn Google Sheets off');
  frame.respond.set('set-product', () => panelView({ products: [{ id: 'sheets', label: 'Google Sheets', enabled: false, granted: true }] }));
  const pressedBefore = toggle.getAttribute('aria-pressed');
  toggle.click();
  await flush();
  assert.deepEqual(frame.requests().at(-1), { action: 'set-product', payload: { productId: 'sheets', enabled: false } });
  assert.deepEqual({ pressedBefore, pressedAfter: button(frame, 'Turn Google Sheets on').getAttribute('aria-pressed') }, { pressedBefore: 'true', pressedAfter: 'false' });
});

test('a refused action shows the host sentence above the last panel view', async () => {
  await openPanel(panelView());
  frame.respond.set('set-product', () => { throw refusal('Reconnect Google, then try again.'); });
  button(frame, 'Turn Google Sheets off').click();
  await flush();
  assert.equal(notice(frame).textContent, 'Reconnect Google, then try again.');
  assert.equal(notice(frame).getAttribute('role'), 'status');
  assert.equal(frame.document.getElementById('account-heading').textContent, 'Connected as Alice');
});

test('while an action is in flight every button is disabled, so a second click sends nothing', async () => {
  await openPanel(panelView());
  button(frame, 'Disconnect and revoke').click();
  button(frame, 'Yes, disconnect and revoke').click();
  await flush();
  const disabled = [...frame.document.querySelectorAll('button')].map((control) => control.disabled);
  button(frame, 'Yes, disconnect and revoke').click();
  await flush();
  assert.equal(disabled.every(Boolean), true);
  assert.deepEqual(frame.requests().map((request) => request.action), ['status', 'disconnect']);
});

test('security: account labels and destination titles from the server are shown as text, never markup', async () => {
  await openPanel(panelView({
    connection: { accountLabel: MARKUP, pendingSwitchAccountLabel: MARKUP },
    destinations: [{ formSlug: MARKUP, title: MARKUP, tabTitle: MARKUP }],
  }));
  assert.equal(frame.document.querySelector('img'), null);
  assert.equal(frame.document.getElementById('account-heading').textContent, `Switch to ${MARKUP}?`);
  assert.equal(globalThis.__pwned, undefined);
});

test('security: everything the panel posts is a declared connection action or a declared-origin link, to the host origin, for its mount', async () => {
  await openPanel(panelView({ connection: { pendingSwitchAccountLabel: 'Bob' } }));
  const view = panelView({ connection: { status: 'revocation-pending', grantedProducts: [], accountLabel: undefined }, products: [{ id: 'sheets', label: 'Google Sheets', enabled: true, granted: false }], revocation: 'pending' });
  for (const action of ['status', 'confirm-switch', 'cancel-switch', 'disconnect', 'set-product']) frame.respond.set(action, () => view);
  frame.respond.set('confirm-switch', () => ({ ...view, reassignment: { moved: [], failed: [] } }));
  frame.respond.set('sign-in', () => ({ expiresAt: new Date(NOW).toISOString() }));
  frame.respond.set('open-link', () => null);
  for (const label of ['Use Bob', 'Retry Google revocation', 'Turn Google Sheets off', 'Connect again', 'Open Google Account page']) {
    button(frame, label).click();
    await flush();
  }
  const declared = declaredActions({ surfaceId: 'connection' });
  const sent = frame.posted.map((entry) => entry.message);
  assert.deepEqual([...new Set(sent.map((message) => message.action ?? message.kind))], ['status', 'confirm-switch', 'disconnect', 'set-product', 'sign-in', 'open-link']);
  assert.equal(sent.filter((message) => message.kind === 'action-request').every((message) => declared.includes(message.action)), true);
  assert.equal(sent.filter((message) => message.kind === 'open-link').every((message) => message.url.startsWith('https://myaccount.google.com/')), true);
  assert.equal(frame.posted.every((entry) => entry.targetOrigin === HOST_ORIGIN && entry.message.mountId === MOUNT_ID), true);
  assert.equal(new Set(sent.map((message) => message.requestId)).size, sent.length);
});

test('security: an answer forged from another origin is ignored; only the host answer for that request renders', async () => {
  frame = createFrame();
  initConnectionPanel({ window: frame.window, document: frame.document });
  frame.init();
  await flush();
  const [request] = frame.posted;
  const forged = { protocol: 'jini.admin-surface', version: 1, kind: 'action-response', mountId: MOUNT_ID, requestId: request.message.requestId, ok: true, result: panelView({ connection: { accountLabel: 'Mallory' } }) };
  frame.deliver(forged, { origin: 'https://evil.test' });
  await flush();
  const afterForgery = frame.document.getElementById('app').childElementCount;
  frame.answer(request.message, { result: panelView() });
  await flush();
  assert.equal(afterForgery, 0);
  assert.equal(frame.document.getElementById('account-heading').textContent, 'Connected as Alice');
});

test('security: a sign-in answer carrying a link renders nothing of it (the admin page above opens sign-ins)', async () => {
  await openPanel(panelView());
  const link = 'https://accounts.google.com/o/oauth2/v2/auth?state=s1';
  frame.respond.set('sign-in', () => ({ expiresAt: new Date(NOW + 600_000).toISOString(), authorizationUrl: link }));
  button(frame, 'Reconnect').click();
  await flush();
  assert.equal(frame.document.documentElement.outerHTML.includes('accounts.google.com'), false);
});

test('a first status the host calls retryable offers Try again, which asks for the status again and renders it', async () => {
  frame = createFrame();
  let asked = 0;
  frame.respond.set('status', () => {
    asked += 1;
    if (asked === 1) throw refusal('The host did not answer in time. Try again.', { code: 'timeout', retryable: true });
    return panelView();
  });
  initConnectionPanel({ window: frame.window, document: frame.document });
  frame.init();
  await flush();
  assert.equal(notice(frame).textContent, 'The host did not answer in time. Try again.');
  button(frame, 'Try again').click();
  await flush();
  assert.equal(asked, 2);
  assert.equal(frame.document.getElementById('account-heading').textContent, 'Connected as Alice');
});

test('a refused action the host calls retryable offers Try again, which re-sends exactly that action', async () => {
  await openPanel(panelView());
  let sent = 0;
  frame.respond.set('set-product', () => {
    sent += 1;
    if (sent === 1) throw refusal('Google did not answer. Try again.', { retryable: true });
    return panelView({ products: [{ id: 'sheets', label: 'Google Sheets', enabled: false, granted: true }] });
  });
  button(frame, 'Turn Google Sheets off').click();
  await flush();
  assert.equal(notice(frame).textContent, 'Google did not answer. Try again.');
  button(frame, 'Try again').click();
  await flush();
  assert.deepEqual(frame.requests().filter((r) => r.action === 'set-product'), [
    { action: 'set-product', payload: { productId: 'sheets', enabled: false } },
    { action: 'set-product', payload: { productId: 'sheets', enabled: false } },
  ]);
  assert.equal(button(frame, 'Turn Google Sheets on').getAttribute('aria-pressed'), 'false');
});
