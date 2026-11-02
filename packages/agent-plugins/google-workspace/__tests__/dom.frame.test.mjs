/**
 * @file Unit tests for `ui/dom.mjs`, the browser helpers every panel builds its DOM with, run in a
 * jsdom frame (`frame-harness.mjs`): the host connection listens on the given frame window and posts
 * only to its parent at the host's origin, `h` turns strings into text (never markup), `busy`
 * disables a region's buttons for exactly one request, and the failure sentence falls back to a
 * fixed one.
 */
import assert from 'node:assert/strict';
import { afterEach, beforeEach, mock, test } from 'node:test';

import { busy, connectToHost, failureText, h, notice, show, tip, wait } from '../ui/dom.mjs';
import { HOST_ORIGIN, MARKUP, MOUNT_ID, createFrame, flush } from './frame-harness.mjs';

let frame;
beforeEach(() => { frame = createFrame(); });
afterEach(() => { mock.timers.reset(); mock.restoreAll(); frame.close(); });

test('connectToHost: the client learns the host from its parent window and posts there, to the host origin only', async () => {
  frame.respond.set('status', () => ({ ok: 'yes' }));
  const client = connectToHost({ window: frame.window });
  let ready = false;
  client.ready.then(() => { ready = true; });
  frame.init();
  await flush();
  assert.equal(ready, true);
  const answer = client.call({ action: 'status', payload: {} });
  await flush();
  assert.deepEqual(frame.posted.map((entry) => [entry.targetOrigin, entry.message.mountId, entry.message.action]), [[HOST_ORIGIN, MOUNT_ID, 'status']]);
  assert.deepEqual(await answer, { ok: 'yes' });
  client.close();
});

test('connectToHost: messages from any window other than the parent are ignored', async () => {
  const client = connectToHost({ window: frame.window });
  let ready = false;
  client.ready.then(() => { ready = true; });
  frame.deliver({ protocol: 'jini.admin-surface', version: 1, kind: 'init', mountId: MOUNT_ID }, { source: frame.window });
  await flush();
  assert.equal(ready, false);
  client.close();
});

test('connectToHost: closing the client removes exactly the message listener it added', () => {
  const added = mock.method(frame.window, 'addEventListener');
  const removed = mock.method(frame.window, 'removeEventListener');
  const client = connectToHost({ window: frame.window });
  client.close();
  assert.equal(added.mock.calls[0].arguments[0], 'message');
  assert.deepEqual(removed.mock.calls.map((call) => call.arguments), [added.mock.calls[0].arguments]);
});

test('h: string children become text nodes, never parsed markup', () => {
  const element = h('p', {}, [MARKUP]);
  assert.equal(element.textContent, MARKUP);
  assert.equal(element.querySelector('img'), null);
  assert.equal(element.childNodes[0].nodeType, frame.window.Node.TEXT_NODE);
});

test('h: string props become attributes, true becomes an empty attribute, false and undefined are left out', () => {
  const element = h('input', { type: 'checkbox', checked: true, disabled: false, title: undefined });
  assert.deepEqual(element.getAttributeNames().sort(), ['checked', 'type']);
  assert.equal(element.getAttribute('checked'), '');
  assert.equal(element.getAttribute('type'), 'checkbox');
});

test('h: an on<Event> function becomes a listener for that lower-case event, not an attribute', () => {
  let clicks = 0;
  const element = h('button', { onClick: () => { clicks += 1; } }, ['Go']);
  element.click();
  assert.equal(clicks, 1);
  assert.equal(element.hasAttribute('onClick'), false);
});

test('h: null and undefined children are skipped, nodes are appended in order', () => {
  const element = h('div', {}, [null, h('b', {}, ['x']), undefined, 'y']);
  assert.equal(element.innerHTML, '<b>x</b>y');
});

test('h: props and children default to none', () => {
  const element = h('hr');
  assert.equal(element.outerHTML, '<hr>');
});

test('show: replaces the region content and skips empty slots', () => {
  const root = frame.document.getElementById('app');
  root.append(h('p', {}, ['old']));
  show(root, null, h('p', {}, ['new']), undefined, false);
  assert.equal(root.innerHTML, '<p>new</p>');
});

test('failureText: the host or plugin sentence when the failure carries one', () => {
  assert.equal(failureText(new Error('Reconnect Google, then try again.')), 'Reconnect Google, then try again.');
});

test('failureText: a fixed sentence when the failure has no usable message', () => {
  for (const error of [undefined, null, {}, new Error(''), { message: 42 }]) {
    assert.equal(failureText(error), 'Something went wrong. Try again.');
  }
});

test('busy: every button in the region is disabled while the work runs, and enabled again after', async () => {
  const root = frame.document.getElementById('app');
  show(root, h('button', {}, ['A']), h('div', {}, [h('button', {}, ['B'])]));
  const buttons = [...root.querySelectorAll('button')];
  let during;
  const result = await busy(root, async () => { during = buttons.map((control) => control.disabled); return 'done'; });
  assert.deepEqual({ during, after: buttons.map((control) => control.disabled), result }, { during: [true, true], after: [false, false], result: 'done' });
});

test('busy: a failed work still re-enables the buttons and passes the failure on', async () => {
  const root = frame.document.getElementById('app');
  show(root, h('button', {}, ['A']));
  const control = root.querySelector('button');
  await assert.rejects(busy(root, async () => { throw new Error('host refused'); }), { message: 'host refused' });
  assert.equal(control.disabled, false);
});

test('wait: resolves only after the given milliseconds', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  let done = false;
  wait(3000).then(() => { done = true; });
  mock.timers.tick(2999);
  await flush();
  const early = done;
  mock.timers.tick(1);
  await flush();
  assert.deepEqual({ early, done }, { early: false, done: true });
});

// ---- toggletips, notices and focus-keeping re-renders ----

function key(frameWindow, target, value) {
  const event = new frameWindow.KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true });
  target.dispatchEvent(event);
  return event;
}

test('tip: an "i" trigger described by its own explanation; click and Enter/Space toggle it, Escape closes it, other keys do nothing', () => {
  const wrapper = tip('About Products', 'What products do.', { bodyClass: 'intro' });
  frame.document.body.append(wrapper);
  const [icon, body] = wrapper.children;
  assert.equal(icon.getAttribute('aria-label'), 'About Products');
  assert.equal(icon.getAttribute('aria-describedby'), body.id);
  assert.equal(body.className, 'tip-body intro');
  assert.equal(body.textContent, 'What products do.');
  assert.equal(tip('A', 'b').children[1].className, 'tip-body');
  assert.notEqual(tip('A', 'b').children[1].id, body.id);

  icon.click();
  assert.equal(wrapper.classList.contains('open'), true);
  assert.equal(icon.getAttribute('aria-expanded'), 'true');
  const ignored = key(frame.window, icon, 'a');
  assert.equal(ignored.defaultPrevented, false);
  assert.equal(wrapper.classList.contains('open'), true);
  assert.equal(key(frame.window, icon, 'Enter').defaultPrevented, true);
  assert.equal(wrapper.classList.contains('open'), false);
  key(frame.window, icon, ' ');
  assert.equal(icon.getAttribute('aria-expanded'), 'true');
  key(frame.window, icon, 'Escape');
  key(frame.window, icon, 'Escape');
  assert.equal(wrapper.classList.contains('open'), false);
  assert.equal(icon.getAttribute('aria-expanded'), 'false');
});

test('tip: a tap elsewhere closes an open tip, a tap inside keeps it; the document is wired once', () => {
  const added = mock.method(frame.document, 'addEventListener');
  connectToHost({ window: frame.window }).close();
  connectToHost({ window: frame.window }).close();
  assert.equal(added.mock.calls.filter((call) => call.arguments[0] === 'click').length, 1);
  const wrapper = tip('About', 'Text');
  const outside = h('p', {}, ['elsewhere']);
  frame.document.body.append(wrapper, outside);
  wrapper.firstChild.click();
  wrapper.children[1].click();
  assert.equal(wrapper.classList.contains('open'), true);
  outside.click();
  assert.equal(wrapper.classList.contains('open'), false);
  assert.equal(wrapper.firstChild.getAttribute('aria-expanded'), 'false');
});

test('notice: error tone is the plain notice; other tones add their class; retry adds a Try again button in the same box', () => {
  const plain = notice({ text: 'Failed.' });
  assert.equal(plain.outerHTML, '<p class="notice" role="status">Failed.</p>');
  assert.equal(notice({ text: 'Done', tone: 'ok' }).className, 'notice ok');
  let retried = 0;
  const group = notice({ text: 'Offline', tone: 'warn', retry: () => { retried += 1; } });
  assert.equal(group.className, 'notice-group warn');
  assert.equal(group.children[0].className, 'notice warn');
  group.querySelector('button').click();
  assert.equal(group.querySelector('button').textContent, 'Try again');
  assert.equal(retried, 1);
});

test('show: keeps focus on the same control across a re-render, matched by id, else by tag and name', () => {
  const root = frame.document.getElementById('app');
  show(root, h('button', { id: 'save' }, ['Save']), h('button', {}, ['Cancel']));
  root.querySelector('#save').focus();
  show(root, h('button', {}, ['First']), h('button', { id: 'save' }, ['Save now']));
  assert.equal(frame.document.activeElement.id, 'save');
  root.querySelectorAll('button')[0].focus();
  show(root, h('button', { 'aria-label': 'Other' }, ['x']), h('button', {}, ['First']));
  assert.equal(frame.document.activeElement.textContent, 'First');
  frame.document.activeElement.blur();
  root.replaceChildren(h('span', { 'aria-label': 'Labelled', tabindex: '0' }, ['x']));
  root.firstChild.focus();
  show(root, h('button', {}, ['Labelled']), h('span', { 'aria-label': 'Labelled', tabindex: '0' }, ['y']));
  assert.equal(frame.document.activeElement.tagName, 'SPAN');
});

test('show: focus moves to the first control when the focused one is gone, and is left alone when nothing in the region had it', () => {
  const root = frame.document.getElementById('app');
  show(root, h('button', {}, ['Gone']));
  root.firstChild.focus();
  show(root, h('p', {}, ['text']), h('a', { href: '#x' }, ['Link']), h('button', {}, ['Next']));
  assert.equal(frame.document.activeElement.textContent, 'Link');
  show(root, h('p', {}, ['no controls']));
  assert.equal(frame.document.activeElement, frame.document.body);
  const outside = h('button', {}, ['Outside']);
  frame.document.body.append(outside);
  outside.focus();
  show(root, h('button', {}, ['Inside']));
  assert.equal(frame.document.activeElement, outside);
  root.tabIndex = 0;
  root.focus();
  show(root, h('button', {}, ['Inside']));
  assert.equal(frame.document.activeElement, root);
});

test('busy then show: the focused button disabled during the work regains focus in the new content', async () => {
  const root = frame.document.getElementById('app');
  show(root, h('button', {}, ['Send']));
  root.firstChild.focus();
  await busy(root, async () => {
    show(root, h('button', {}, ['Back']), h('button', {}, ['Send']));
  });
  assert.equal(frame.document.activeElement.textContent, 'Send');
  assert.equal(root.pendingFocus, null);
});
