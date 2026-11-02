/**
 * @file Unit tests of the surface-side admin-surface protocol client (`ui/surface-client.mjs`), with
 * a fake parent window, a fake `listen`, and fake theme-root / size ports, so every trust rule in the
 * file's header is checked message by message. The frame tests drive the same client through jsdom.
 */
import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import { AdminSurfaceCallError, createAdminSurfaceClient } from '../ui/surface-client.mjs';

const ORIGIN = 'https://admin.example';
const base = { protocol: 'jini.admin-surface', version: 1 };

function harness(optional = {}) {
  const posted = [];
  const parent = { postMessage: (message, origin) => posted.push({ message, origin }) };
  let handler;
  let unsubscribed = 0;
  const listen = (h) => {
    handler = h;
    return () => { unsubscribed += 1; };
  };
  const client = createAdminSurfaceClient({ parent, listen }, { themeRoot: null, size: null, ...optional });
  const deliver = (data, { origin = ORIGIN, source = parent } = {}) => handler({ data, origin, source });
  const init = (extra = {}) => deliver({ ...base, kind: 'init', mountId: 'm1', ...extra });
  return { client, posted, deliver, init, parent, unsubscribedCount: () => unsubscribed };
}

function fakeRoot() {
  const props = new Map();
  const attrs = new Map();
  return {
    props, attrs,
    style: { setProperty: (n, v) => props.set(n, v), removeProperty: (n) => props.delete(n) },
    setAttribute: (n, v) => attrs.set(n, v),
  };
}

test('init is accepted only from the parent, only in protocol shape, only with a string mountId, and only once', async () => {
  const h = harness();
  h.deliver({ ...base, kind: 'init', mountId: 'evil' }, { source: {} });
  h.deliver(null);
  h.deliver('init');
  h.deliver({ ...base, version: 2, kind: 'init', mountId: 'x' });
  h.deliver({ ...base, kind: 'init', mountId: 7 });
  let settled = false;
  h.client.ready.then(() => { settled = true; });
  await Promise.resolve();
  assert.equal(settled, false);
  h.init({ bootstrap: { expiresAt: Number.MAX_SAFE_INTEGER, data: { first: true } } });
  await h.client.ready;
  h.deliver({ ...base, kind: 'init', mountId: 'm2', bootstrap: { expiresAt: Number.MAX_SAFE_INTEGER, data: { second: true } } }, { origin: 'https://other.example' });
  assert.deepEqual(h.client.bootstrap(), { first: true });
  void h.client.call({ action: 'a', payload: 1 }).catch(() => {});
  await Promise.resolve();
  assert.deepEqual(h.posted.at(-1).origin, ORIGIN);
  assert.equal(h.posted.at(-1).message.mountId, 'm1');
  h.client.close();
});

test('bootstrap: none, not an object, expired, a non-number expiry, and live data', () => {
  const now = 1_000;
  const cases = [[undefined, undefined], ['x', undefined], [{ expiresAt: 999, data: 1 }, undefined], [{ expiresAt: '2000', data: 1 }, undefined], [{ expiresAt: 2_000, data: { ok: 1 } }, { ok: 1 }]];
  for (const [bootstrap, expected] of cases) {
    const h = harness({ nowMs: () => now });
    assert.equal(h.client.bootstrap(), undefined);
    h.init(bootstrap === undefined ? {} : { bootstrap });
    assert.deepEqual(h.client.bootstrap(), expected);
  }
});

test('call: posts an action-request to the host origin and resolves with the matching response', async () => {
  const h = harness();
  h.init();
  const pending = h.client.call({ action: 'sheets.list', payload: { q: 1 } });
  await Promise.resolve();
  assert.deepEqual(h.posted[0], { origin: ORIGIN, message: { ...base, kind: 'action-request', mountId: 'm1', requestId: 'r1', action: 'sheets.list', payload: { q: 1 } } });
  h.deliver({ ...base, kind: 'action-response', mountId: 'm1', requestId: 'r1', ok: true, result: [1] });
  assert.deepEqual(await pending, [1]);
});

test('call made before init waits for it, and a refusal rejects with the host error', async () => {
  const h = harness();
  const pending = h.client.call({ action: 'x' });
  h.init();
  await h.client.ready;
  await Promise.resolve();
  assert.equal(h.posted.length, 1);
  h.deliver({ ...base, kind: 'action-response', mountId: 'm1', requestId: 'r1', ok: false, error: { code: 'denied', message: 'No.', retryable: false } });
  await assert.rejects(pending, (error) => error instanceof AdminSurfaceCallError && error.name === 'AdminSurfaceCallError' && error.code === 'denied' && error.message === 'No.' && error.retryable === false);
});

test('responses from the wrong origin, mount, id, or in a malformed shape are ignored until the right one arrives', async () => {
  const h = harness();
  h.init();
  const pending = h.client.call({ action: 'x' });
  await Promise.resolve();
  const ok = { ...base, kind: 'action-response', mountId: 'm1', requestId: 'r1', ok: true, result: 'good' };
  h.deliver({ ...ok, result: 'wrong origin' }, { origin: 'https://evil.example' });
  h.deliver({ ...ok, mountId: 'm2', result: 'wrong mount' });
  h.deliver({ ...ok, requestId: 1 });
  h.deliver({ ...ok, requestId: 'r9' });
  const { result: _drop, ...noResult } = ok;
  h.deliver(noResult);
  h.deliver({ ...ok, ok: false, error: null, result: undefined });
  h.deliver({ ...ok, ok: false, error: { code: 'c', message: 'm', retryable: 'yes' } });
  h.deliver({ ...ok, ok: 'maybe' });
  h.deliver({ ...ok, kind: 'unknown-kind', result: 'unknown kind' });
  h.deliver(ok);
  assert.equal(await pending, 'good');
});

test('call: a host that never answers rejects with a retryable timeout', async () => {
  const h = harness({ timeoutMs: 5 });
  h.init();
  await assert.rejects(h.client.call({ action: 'x' }), { code: 'timeout', retryable: true, message: 'The host did not answer in time. Try again.' });
});

test('openLink posts open-link and resolves once the host accepts', async () => {
  const h = harness();
  h.init();
  const opened = h.client.openLink({ url: 'https://docs.google.com/x' });
  await Promise.resolve();
  assert.deepEqual(h.posted[0].message, { ...base, kind: 'open-link', mountId: 'm1', requestId: 'r1', url: 'https://docs.google.com/x' });
  h.deliver({ ...base, kind: 'action-response', mountId: 'm1', requestId: 'r1', ok: true, result: null });
  assert.equal(await opened, undefined);
});

test('close stops listening, stops the size source, and rejects every pending call as closed', async () => {
  let stopped = 0;
  const h = harness({ size: () => () => { stopped += 1; } });
  h.init();
  const a = h.client.call({ action: 'a' });
  const b = h.client.call({ action: 'b' });
  await Promise.resolve();
  h.client.close();
  for (const p of [a, b]) await assert.rejects(p, { code: 'closed', retryable: false });
  assert.equal(h.unsubscribedCount(), 1);
  assert.equal(stopped, 1);
});

test('close before init, with no size source, only unsubscribes', () => {
  const h = harness();
  h.client.close();
  assert.equal(h.unsubscribedCount(), 1);
});

test('theme: only --jini-* tokens with safe values apply; scheme and data attribute follow', () => {
  const root = fakeRoot();
  const h = harness({ themeRoot: root });
  h.init({ theme: { scheme: 'dark', tokens: {
    '--jini-bg': '#000', '--jini-fg': 'white', 'color': 'red', '--jini-bad': 'url(https://x)', '--jini-num': 5, '--jini-empty': '', '--jini-long': 'x'.repeat(201), '--jini-semi': 'a;b',
  } } });
  assert.deepEqual(Object.fromEntries(root.props), { '--jini-bg': '#000', '--jini-fg': 'white', 'color-scheme': 'dark' });
  assert.deepEqual(Object.fromEntries(root.attrs), { 'data-jini-scheme': 'dark' });
  assert.deepEqual(h.client.theme(), { scheme: 'dark', tokens: { '--jini-bg': '#000', '--jini-fg': 'white' } });

  // A later theme from the host replaces the set: a dropped token falls back to the surface's CSS.
  h.deliver({ ...base, kind: 'theme', mountId: 'm1', theme: { scheme: 'light', tokens: { '--jini-bg': '#fff' } } });
  assert.deepEqual(Object.fromEntries(root.props), { '--jini-bg': '#fff', 'color-scheme': 'light' });
  assert.equal(root.attrs.get('data-jini-scheme'), 'light');
});

test('theme: messages from another origin or mount, and values that are not a theme, change nothing', () => {
  const root = fakeRoot();
  const h = harness({ themeRoot: root });
  h.deliver({ ...base, kind: 'theme', mountId: 'm1', theme: { scheme: 'dark', tokens: { '--jini-a': '1' } } });
  assert.equal(h.client.theme(), undefined);
  h.init();
  assert.equal(h.client.theme(), undefined);
  h.deliver({ ...base, kind: 'theme', mountId: 'm1', theme: { scheme: 'dark', tokens: { '--jini-a': '1' } } }, { origin: 'https://evil.example' });
  h.deliver({ ...base, kind: 'theme', mountId: 'm2', theme: { scheme: 'dark', tokens: { '--jini-a': '1' } } });
  for (const theme of [null, 'dark', { scheme: 'sepia', tokens: {} }, { scheme: 'dark', tokens: null }, { scheme: 'dark', tokens: 'x' }]) {
    h.deliver({ ...base, kind: 'theme', mountId: 'm1', theme });
  }
  assert.equal(h.client.theme(), undefined);
  assert.equal(root.props.size, 0);
});

test('theme: at most 100 tokens are considered, and with no theme root the theme is still recorded', () => {
  const tokens = Object.fromEntries(Array.from({ length: 120 }, (_, i) => [`--jini-t${i}`, `${i}`]));
  const h = harness();
  h.init({ theme: { scheme: 'light', tokens } });
  assert.equal(Object.keys(h.client.theme().tokens).length, 100);
  assert.equal(h.client.theme().tokens['--jini-t99'], '99');
  assert.equal('--jini-t100' in h.client.theme().tokens, false);
});

test('height: reported to the host origin once per change, never a non-finite value', () => {
  let report;
  const h = harness({ size: (onHeight) => { report = onHeight; return () => {}; } });
  assert.equal(report, undefined);
  h.init();
  report(120);
  report(120);
  report(Number.NaN);
  report(Number.POSITIVE_INFINITY);
  report(140);
  assert.deepEqual(h.posted.map((p) => [p.origin, p.message.kind, p.message.height, p.message.mountId]), [[ORIGIN, 'resize', 120, 'm1'], [ORIGIN, 'resize', 140, 'm1']]);
});

// ---- the browser defaults (document root and size source), with globals installed per test ----

const saved = {};
function install(globals) {
  for (const [name, value] of Object.entries(globals)) {
    saved[name] = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  }
}
afterEach(() => {
  for (const [name, descriptor] of Object.entries(saved)) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else delete globalThis[name];
    delete saved[name];
  }
});

function defaultsHarness() {
  const posted = [];
  const parent = { postMessage: (message) => posted.push(message) };
  let handler;
  const client = createAdminSurfaceClient({ parent, listen: (h) => { handler = h; return () => {}; } });
  handler({ source: parent, origin: ORIGIN, data: { ...base, kind: 'init', mountId: 'm1', theme: { scheme: 'dark', tokens: { '--jini-x': '1' } } } });
  return { client, posted };
}

test('defaults without a document: no theme root and no size source, the theme is still recorded', () => {
  install({ document: undefined });
  const { client, posted } = defaultsHarness();
  assert.deepEqual(client.theme(), { scheme: 'dark', tokens: { '--jini-x': '1' } });
  assert.deepEqual(posted, []);
});

test('defaults with a document but no observers: themes the root element, reports no height', () => {
  const root = fakeRoot();
  install({ document: { documentElement: root, body: {} }, ResizeObserver: undefined });
  const { posted } = defaultsHarness();
  assert.equal(root.props.get('--jini-x'), '1');
  assert.deepEqual(posted, []);
  install({ document: { body: {} }, ResizeObserver: class {}, MutationObserver: undefined });
  assert.deepEqual(defaultsHarness().posted, []);
  install({ document: {} });
  assert.deepEqual(defaultsHarness().posted, []);
});

test('defaults with a full DOM: measures body height plus margins, re-measures on observers and events, and close tears it all down', () => {
  const observers = [];
  class FakeObserver {
    constructor(callback) { this.callback = callback; this.observed = []; this.disconnected = false; observers.push(this); }
    observe(target, options) { this.observed.push([target, options]); }
    disconnect() { this.disconnected = true; }
  }
  const listeners = new Map();
  const body = {
    scrollHeight: 100,
    getBoundingClientRect: () => ({ height: 100.4 }),
    addEventListener: (type, fn) => listeners.set(type, fn),
    removeEventListener: (type, fn) => { if (listeners.get(type) === fn) listeners.delete(type); },
  };
  let margins = { marginTop: '8px', marginBottom: '' };
  install({ document: { documentElement: null, body }, ResizeObserver: FakeObserver, MutationObserver: FakeObserver, getComputedStyle: () => margins });
  const { client, posted } = defaultsHarness();
  assert.deepEqual(posted.map((m) => m.height), [109]);
  assert.deepEqual(observers[1].observed[0][1], { subtree: true, childList: true, attributes: true, characterData: true });
  body.scrollHeight = 200;
  observers[0].callback();
  margins = { marginTop: '', marginBottom: '4px' };
  observers[1].callback();
  listeners.get('mouseover')();
  body.scrollHeight = 300;
  listeners.get('focusin')();
  assert.deepEqual(posted.map((m) => m.height), [109, 208, 204, 304]);
  client.close();
  assert.deepEqual(observers.map((o) => o.disconnected), [true, true]);
  assert.equal(listeners.size, 0);
});
