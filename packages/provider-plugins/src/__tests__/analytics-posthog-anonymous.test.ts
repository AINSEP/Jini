// @vitest-environment jsdom
/** R2: instrument real browser storage and inspect actual provider requests, without loading an SDK. */
import { afterEach, expect, test, vi } from 'vitest';
import { createCookieConsent } from '@jini-ai/cookie-consent/client';
import { effective } from '@jini-ai/cookie-consent/policy';
import { createPostHogConsentAdapter } from '../analytics-posthog/consent-adapter.js';
import { postHogConsentContribution } from '../analytics-posthog/consent.js';

const input = { apiKey: 'phc_fixture_key', host: 'https://collector.example', sessionReplay: true, siteId: 'site-1', path: '/_consent/posthog' };
const anonymous = effective({ stored: null, policy: 'p1', region: 'opt-in', gpc: false, nowMs: 0 }, { anonymous: true });
const browser = globalThis as unknown as {
  Document: { prototype: { cookie: string } };
  Storage: { prototype: { setItem(key: string, value: string): void; removeItem(key: string): void } };
};
afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  for (const name of document.cookie.split('; ').map(part => part.split('=')[0])) document.cookie = `${name}=; Path=/; Max-Age=0`;
});

test('anonymous event writes no cookies or storage, loads no SDK, and contains no profile, geo, replay, form or visitor identity', async () => {
  const cookie = vi.spyOn(browser.Document.prototype, 'cookie', 'set');
  const storage = vi.spyOn(browser.Storage.prototype, 'setItem');
  const remove = vi.spyOn(browser.Storage.prototype, 'removeItem');
  const sdk = vi.fn(async () => ({ init: () => ({ set_config() {}, identify() {}, get_distinct_id: () => 'returning' }) }));
  const request = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response('1'));
  const adapter = createPostHogConsentAdapter({ ports: { loadSdk: sdk, request, location: { origin: 'https://site.example', pathname: '/user/private?email=a@b.example', hostname: 'site.example' } } });
  const ctl = new AbortController();
  const revoker = await adapter.grant({ config: postHogConsentContribution(input).adapter.config, state: anonymous, signal: ctl.signal });
  expect(request).toHaveBeenCalledOnce();
  const [url, init] = request.mock.calls[0]!;
  expect(url).toBe('/_consent/posthog/e/');
  expect(init).toMatchObject({ credentials: 'omit', referrerPolicy: 'no-referrer' });
  const sent = JSON.parse(String(init!.body));
  expect(sent.event).toBe('$pageview');
  expect(sent.properties).toEqual({ distinct_id: 'visitor:ephemeral', $process_person_profile: false, $geoip_disable: true, surface: 'site', site_id: 'site-1' });
  expect(sdk).not.toHaveBeenCalled();
  ctl.abort();
  expect(await revoker!.revoke!()).toBe(true);
  expect(cookie).not.toHaveBeenCalled();
  expect(storage).not.toHaveBeenCalled();
  expect(remove).not.toHaveBeenCalled();
});

test('withdrawn anonymous grant sends nothing', async () => {
  const request = vi.fn();
  const loadSdk = vi.fn();
  const adapter = createPostHogConsentAdapter({ ports: { loadSdk, request, location: { origin: '', pathname: '/', hostname: '' } } });
  const ctl = new AbortController(); ctl.abort();
  expect(await adapter.grant({ config: postHogConsentContribution(input).adapter.config, state: anonymous, signal: ctl.signal })).toBeNull();
  expect(request).not.toHaveBeenCalled();
  expect(loadSdk).not.toHaveBeenCalled();
});

test('server collector enforces anonymous level even against a stale full or hostile event', async () => {
  const request = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response('1'));
  const { http, adapter } = postHogConsentContribution(input, { request });
  const body = new TextEncoder().encode(JSON.stringify({ event: '$identify', properties: { distinct_id: 'returning-person', $set: { email: 'secret' }, $session_id: 'stable', $process_person_profile: true } }));
  const response = await http.handle({ method: 'POST', path: '/e/', body, contentType: 'application/json', analyticsLevel: 'anonymous' });
  expect(response.status).toBe(200);
  const [url, init] = request.mock.calls[0]!;
  expect(url).toBe('https://collector.example/e/?ip=0');
  const forwarded = JSON.parse(Buffer.from(init!.body as Uint8Array).toString());
  expect(forwarded.event).toBe('$pageview');
  expect(adapter.supportsAnonymous).toBe(true);
  expect(forwarded.properties).toEqual({ distinct_id: 'visitor:ephemeral', $process_person_profile: false, $geoip_disable: true, surface: 'site', site_id: 'site-1' });
  expect(await http.handle({ method: 'POST', path: '/s/', body, contentType: 'application/json', analyticsLevel: 'anonymous' })).toEqual({ status: 403, body: '' });
  expect(request).toHaveBeenCalledOnce();
});

for (const analyticsLevel of ['anonymous', 'none'] as const) test(`${analyticsLevel} removes leftover provider identity without touching host storage`, async () => {
  for (const name of ['ph_jini_site_site-1', 'ph_old_posthog', '__ph_opt_in_out_key', 'host_preference']) {
    document.cookie = `${name}=returning; Path=/`;
    localStorage.setItem(name, 'returning');
  }
  const loadSdk = vi.fn();
  const request = vi.fn(async () => new Response('1'));
  const write = vi.spyOn(Storage.prototype, 'setItem');
  const adapter = createPostHogConsentAdapter({ ports: { doc: document, loadSdk, request, location: { origin: location.origin, pathname: '/', hostname: location.hostname } } });
  const state = { ...anonymous, analyticsLevel };
  adapter.onState?.({ state });
  if (analyticsLevel === 'anonymous') await adapter.grant({ config: postHogConsentContribution(input).adapter.config, state, signal: new AbortController().signal });
  expect(localStorage.getItem('ph_jini_site_site-1')).toBeNull();
  expect(localStorage.getItem('ph_old_posthog')).toBeNull();
  expect(localStorage.getItem('__ph_opt_in_out_key')).toBeNull();
  expect(document.cookie).toBe('host_preference=returning');
  expect(localStorage.getItem('host_preference')).toBe('returning');
  expect(write).not.toHaveBeenCalled();
  expect(loadSdk).not.toHaveBeenCalled();
  expect(request).toHaveBeenCalledTimes(analyticsLevel === 'anonymous' ? 1 : 0);
});

for (const gpc of [false, true]) test(`off lazy provider cleans earlier identity end to end (privacy signal ${gpc})`, async () => {
  document.cookie = 'ph_jini_site_site-1=returning; Path=/';
  localStorage.setItem('ph_jini_site_site-1', 'returning');
  const request = vi.fn(async () => new Response('1'));
  const loadSdk = vi.fn();
  const adapter = createPostHogConsentAdapter({ ports: { doc: document, loadSdk, request, location } });
  const contribution = postHogConsentContribution(input).adapter;
  const api = createCookieConsent({ config: { contract: 1, banner: 'off', policy: 'p1', regionMode: 'auto', plugins: [contribution] },
    ports: { doc: document, gpc: () => gpc, fetch: vi.fn(), now: () => 0, reload: vi.fn(), importModule: async () => ({ default: adapter }) },
  });
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(api.get().allowed.analytics).toBe(false);
  expect(api.get().analyticsLevel).toBe(gpc ? 'none' : 'anonymous');
  expect(document.cookie).toBe('');
  expect(localStorage.getItem('ph_jini_site_site-1')).toBeNull();
  expect(request).toHaveBeenCalledTimes(gpc ? 0 : 1);
  expect(loadSdk).not.toHaveBeenCalled();
});

test('full level preserves returning identity while none never grants an SDK or sends an event', async () => {
  document.cookie = 'ph_jini_site_site-1=returning; Path=/';
  localStorage.setItem('ph_jini_site_site-1', 'returning');
  const init = vi.fn(() => ({ set_config() {}, identify() {}, get_distinct_id: () => 'returning' }));
  const loadSdk = vi.fn(async () => ({ init }));
  const request = vi.fn();
  const adapter = createPostHogConsentAdapter({ ports: { doc: document, loadSdk, request, location } });
  const config = postHogConsentContribution(input).adapter.config;
  const signal = new AbortController().signal;
  await adapter.grant({ config, signal, state: { ...anonymous, analyticsLevel: 'full' } });
  expect(loadSdk).toHaveBeenCalledOnce();
  expect(init).toHaveBeenCalledOnce();
  expect(document.cookie).toBe('ph_jini_site_site-1=returning');
  expect(localStorage.getItem('ph_jini_site_site-1')).toBe('returning');
  expect(await adapter.grant({ config, signal, state: { ...anonymous, analyticsLevel: 'none' } })).toBeNull();
  expect(loadSdk).toHaveBeenCalledOnce();
  expect(request).not.toHaveBeenCalled();
  expect(document.cookie).toBe('');
  expect(localStorage.getItem('ph_jini_site_site-1')).toBeNull();
});
