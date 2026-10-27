// @vitest-environment jsdom
/** Owner decisions R2/R3, 2026-10-26: real render/client/server boundaries, no vendor assumptions. */
import { afterEach, expect, test, vi } from 'vitest';
import { boot, browserPorts } from '../client/index.js';
import { renderBanner } from '../render/index.js';
import { readConsent, handleReceipt } from '../server/index.js';
import type { ConsentState } from '../contract.js';

const client = { contract: 1 as const, policy: 'p1', regionMode: 'auto' as const };
afterEach(() => {
  vi.restoreAllMocks();
  delete window.jiniConsent;
  delete window.jiniConsentQueue;
  Object.defineProperty(navigator, 'doNotTrack', { value: undefined, configurable: true });
  Object.defineProperty(navigator, 'globalPrivacyControl', { value: undefined, configurable: true });
  document.head.innerHTML = '';
  document.body.innerHTML = '';
});

function page({ gpc = false, dnt = '0' } = {}) {
  Object.defineProperty(navigator, 'doNotTrack', { value: dnt, configurable: true });
  Object.defineProperty(navigator, 'globalPrivacyControl', { value: gpc, configurable: true });
  const out = renderBanner({ mode: 'off', client, copy: {} }, { clientSrc: '/client.js', evidence: { mode: 'durable', endpoint: '/_consent' } });
  document.head.innerHTML = out.head;
  document.body.innerHTML = '<script type="text/plain" data-consent-category="analytics" id="raw">window.rawRan=true</script>';
  const grant = vi.fn((_input: { state: ConsentState }) => ({ revoke: () => true }));
  const unsafe = vi.fn();
  window.jiniConsentQueue = [
    { id: 'safe', kind: 'consent-adapter', category: 'analytics', supportsAnonymous: true, grant },
    { id: 'unsafe', kind: 'consent-adapter', category: 'analytics', grant: unsafe },
    { id: 'marketing', kind: 'consent-adapter', category: 'marketing', supportsAnonymous: true, grant: unsafe },
  ];
  const cookieWrite = vi.spyOn(Document.prototype, 'cookie', 'set');
  const cookieRead = vi.spyOn(Document.prototype, 'cookie', 'get');
  const storageWrite = vi.spyOn(Storage.prototype, 'setItem');
  const storageRemove = vi.spyOn(Storage.prototype, 'removeItem');
  const network = vi.fn();
  const api = boot(window, { ports: { ...browserPorts(window), fetch: network } });
  return { api, grant, unsafe, cookieWrite, cookieRead, storageWrite, storageRemove, network };
}

test('off boots anonymous adapters without controls, persistence, raw tags or receipts, even after accept', async () => {
  const events: ConsentState[] = [];
  document.addEventListener('jini:consent', event => events.push((event as CustomEvent<ConsentState>).detail), { once: true });
  const f = page();
  expect(f.api!.get().allowed.analytics).toBe(false);
  expect(events[0]).toMatchObject({ allowed: { analytics: false }, analyticsLevel: 'anonymous' });
  const listener = vi.fn();
  f.api!.subscribe({ listener });
  await new Promise(r => setTimeout(r, 0));
  expect(f.unsafe).not.toHaveBeenCalled();
  expect(f.api, 'off still emits a client config').toBeDefined();
  await f.api!.set({ action: 'accept' });
  await new Promise(r => setTimeout(r, 0));
  expect(f.api!.get().analyticsLevel).toBe('anonymous');
  expect(listener).toHaveBeenCalledWith(expect.objectContaining({ allowed: expect.objectContaining({ analytics: false }), analyticsLevel: 'anonymous' }));
  expect(f.grant).toHaveBeenCalledOnce();
  expect(f.grant.mock.calls[0]![0].state.analyticsLevel).toBe('anonymous');
  expect(f.unsafe).not.toHaveBeenCalled();
  expect(document.querySelector('#raw')!.getAttribute('type')).toBe('text/plain');
  expect(document.querySelector('#jini-consent')).toBeNull();
  expect(f.cookieWrite).not.toHaveBeenCalled();
  expect(f.cookieRead).not.toHaveBeenCalled();
  expect(f.storageWrite).not.toHaveBeenCalled();
  expect(f.storageRemove).not.toHaveBeenCalled();
  expect(f.network).not.toHaveBeenCalled();
});

for (const signal of [{ gpc: true }, { dnt: '1' }]) test(`off + ${Object.keys(signal)[0]} runs no analytics`, async () => {
  const f = page(signal);
  expect(f.api).toBeDefined();
  await f.api!.set({ action: 'accept' });
  await new Promise(r => setTimeout(r, 0));
  expect(f.api!.get().analyticsLevel).toBe('none');
  expect(f.grant).not.toHaveBeenCalled();
  expect(f.unsafe).not.toHaveBeenCalled();
  expect(f.network).not.toHaveBeenCalled();
  expect(f.cookieWrite).not.toHaveBeenCalled();
  expect(f.storageWrite).not.toHaveBeenCalled();
});

test('DNT browser boundary clamps a US no-choice grant just like GPC', () => {
  Object.defineProperty(navigator, 'doNotTrack', { value: '1', configurable: true });
  expect(browserPorts(window).gpc()).toBe(true);
});

test('server: off is anonymous; GPC/DNT deny it, US defaults remain, EU/UK/unknown stay strict', () => {
  const read = (cookieHeader: string, options = {}) => readConsent({ cookieHeader, ...client }, options);
  expect(read('', { anonymous: true })).toMatchObject({ allowed: { analytics: false }, analyticsLevel: 'anonymous' });
  for (const options of [{ secGpc: '1' }, { dnt: '1' }]) {
    expect(read('jini_region=us', { ...options, anonymous: true }).allowed.analytics).toBe(false);
    expect(read('jini_region=us', options).allowed.analytics).toBe(false);
  }
  expect(read('jini_region=us').allowed.analytics).toBe(true);
  for (const cookie of ['', 'jini_region=de', 'jini_region=gb']) expect(read(cookie).allowed.analytics).toBe(false);
});

test('US no-choice + DNT is denied on the server', () => {
  expect(readConsent({ cookieHeader: 'jini_region=us', ...client }, { dnt: '1' }).allowed.analytics).toBe(false);
});

test('DNT on receipt requests cannot mint an analytics grant', async () => {
  const saved: { choices: ConsentState['choices'] }[] = [];
  const request = new Request('https://site.example/_consent', { method: 'POST', headers: { origin: 'https://site.example', 'content-type': 'application/json', dnt: '1' }, body: JSON.stringify({ policy: 'p1', action: 'accept' }) });
  const response = await handleReceipt({ request, ports: { store: { save: async ({ record }) => { saved.push(record); } }, policy: () => 'p1', ids: () => 'receipt_test_0123456789', now: Date.now } });
  expect(response.status).toBe(201);
  expect(saved[0]!.choices.analytics).toBe(false);
  expect(saved[0]!.choices.marketing).toBe(false);
});

test('browser US no-choice DNT blocks adapters and raw tags, and Accept cannot lift it', async () => {
  document.cookie = 'jini_region=us; Path=/';
  Object.defineProperty(navigator, 'doNotTrack', { value: '1', configurable: true });
  document.head.innerHTML = renderBanner({ mode: 'headless', client, copy: {} }).head;
  document.body.innerHTML = '<script type="text/plain" data-consent-category="analytics" id="raw">window.rawRan=true</script>';
  const grant = vi.fn();
  window.jiniConsentQueue = [{ id: 'stats', kind: 'consent-adapter', category: 'analytics', grant }];
  const api = boot(window, { ports: { ...browserPorts(window), fetch: vi.fn() } })!;
  expect(api.get().region).toBe('opt-out');
  expect(api.get().allowed.analytics).toBe(false);
  await api.set({ action: 'accept' });
  await new Promise(r => setTimeout(r, 0));
  expect(grant).not.toHaveBeenCalled();
  expect(document.querySelector('#raw')!.getAttribute('type')).toBe('text/plain');
  document.cookie = 'jini_region=; Path=/; Max-Age=0';
  document.cookie = 'jini_choices=; Path=/; Max-Age=0';
});

test('off ignores a previous durable grant or pending receipt without rewriting or retrying it', async () => {
  const stored = { v: 1, p: 'p1', c: { functional: true, analytics: true, marketing: true }, t: Date.now(), a: 'accept', q: 1 };
  document.cookie = 'jini_choices=' + encodeURIComponent(JSON.stringify(stored)) + '; Path=/';
  const f = page();
  await new Promise(r => setTimeout(r, 0));
  expect(f.api).toBeDefined();
  expect(f.api!.get()).toMatchObject({ analyticsLevel: 'anonymous', receipt: 'none', action: null });
  expect(f.cookieWrite).not.toHaveBeenCalled();
  expect(f.network).not.toHaveBeenCalled();
  vi.restoreAllMocks();
  document.cookie = 'jini_choices=; Path=/; Max-Age=0';
});

for (const gpc of [false, true]) test(`off lazy adapters receive the current level for cleanup (privacy signal ${gpc})`, async () => {
  Object.defineProperty(navigator, 'globalPrivacyControl', { value: gpc, configurable: true });
  document.head.innerHTML = renderBanner({ mode: 'off', client, copy: {} }).head;
  const grant = vi.fn(() => ({ revoke: () => true }));
  const onState = vi.fn();
  const importModule = vi.fn(async () => ({ default: { id: 'safe', kind: 'consent-adapter' as const, category: 'analytics' as const, supportsAnonymous: true as const, grant, onState } }));
  window.jiniConsentQueue = [{ id: 'safe', kind: 'consent-adapter', category: 'analytics', supportsAnonymous: true, src: '/adapter.js' }];
  const api = boot(window, { ports: { ...browserPorts(window), importModule, fetch: vi.fn() } })!;
  await new Promise(r => setTimeout(r, 0));
  expect(importModule).toHaveBeenCalledOnce();
  expect(onState).toHaveBeenCalledWith({ state: api.get() });
  expect(api.get().allowed.analytics).toBe(false);
  expect(grant).toHaveBeenCalledTimes(gpc ? 0 : 1);
});
