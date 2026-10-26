import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { ADAPTER_SLOT } from '@jini-ai/cookie-consent/plugins';
import type { ConsentState, RawContribution } from '@jini-ai/cookie-consent';
import { ADAPTER_FILE, POSTHOG_SDK_INTEGRITY, postHogConsentContribution, SDK_FILE } from '../analytics-posthog/consent.js';
import defaultAdapter, { createPostHogConsentAdapter, loadVerifiedSdk, POSTHOG_STORAGE, safePath, type LoaderDocument,
  type PostHogConsentConfig } from '../analytics-posthog/consent-adapter.js';

const key = ['phc', 'fixture', 'key'].join('_');
const base = { apiKey: key, host: 'https://collector.example', sessionReplay: false, siteId: 'site-1', path: '/_consent/posthog' };
const location = { origin: 'https://site.example', pathname: '/account', hostname: 'site.example' };
const state = {} as ConsentState;
type Settings = Record<string, any>;

function fakeSdk() {
  const inits: Settings[] = [], configs: Settings[] = [], identified: string[] = [];
  let stopped = 0, distinctId = 'anon-1';
  const client = { set_config(c: Settings) { configs.push(c); }, stopSessionRecording() { stopped++; },
    get_distinct_id: () => distinctId, identify(id: string) { identified.push(id); } };
  const sdk = { init(_token: string, settings: Settings, name: string) { inits.push({ ...settings, name }); settings.loaded(client); return client; } };
  return { sdk, client, inits, configs, identified, stopped: () => stopped, setId: (id: string) => { distinctId = id; } };
}

function adapterWith({ fail = false } = {}) {
  const f = fakeSdk();
  const loads: { src: string; integrity: string }[] = [];
  const adapter = createPostHogConsentAdapter({ ports: { location, loadSdk: async input => {
    loads.push(input);
    if (fail) throw new Error('integrity');
    return f.sdk;
  } } });
  return { ...f, adapter, loads };
}

const config = (overrides: Partial<PostHogConsentConfig> = {}): PostHogConsentConfig =>
  ({ ...postHogConsentContribution(base).adapter.config, ...overrides });

describe('postHogConsentContribution (server)', () => {
  it('refuses private keys, credential hosts and unsafe mount paths before producing browser config', () => {
    expect(() => postHogConsentContribution({ ...base, apiKey: ['phx', 'private'].join('_') })).toThrow('project key starting with phc_');
    for (const host of ['https://user:pw@collector.example', 'https://collector.example/?q=1', 'https://collector.example/#h', 'ftp://collector.example', 'not a url']) {
      expect(() => postHogConsentContribution({ ...base, host })).toThrow('without credentials');
    }
    for (const path of ['', 'relative', '/a/../b', '//evil.example', '/a?x=1', '/a/']) {
      expect(() => postHogConsentContribution({ ...base, path })).toThrow('plain absolute path');
    }
  });

  it('describes a lazy analytics adapter the consent registry accepts, with public config only', () => {
    const { adapter, http } = postHogConsentContribution(base);
    expect(adapter).toEqual({ id: 'posthog', kind: 'consent-adapter', category: 'analytics', src: '/_consent/posthog/consent-adapter.mjs',
      storage: POSTHOG_STORAGE, config: { apiKey: key, host: '/_consent/posthog', sdk: '/_consent/posthog/sdk-1.260.2.js',
        integrity: POSTHOG_SDK_INTEGRITY, sessionReplay: false, siteId: 'site-1' } });
    expect(http.path).toBe('/_consent/posthog');
    expect(ADAPTER_SLOT.accept({ contribution: adapter as unknown as RawContribution })).toBe(adapter);
    expect(postHogConsentContribution({ ...base, siteId: undefined }).adapter.config).not.toHaveProperty('siteId');
  });

  it('serves the pinned SDK immutable and the adapter revalidated; nothing else is a GET', async () => {
    const asked: string[] = [];
    const { http } = postHogConsentContribution(base, { loadAsset: async name => { asked.push(name); return `/*${name}*/`; } });
    const get = (path: string) => http.handle({ method: 'GET', path, body: new Uint8Array(), contentType: '' });
    expect(await get('/sdk-1.260.2.js')).toEqual({ status: 200, body: `/*${SDK_FILE}*/`, contentType: 'text/javascript; charset=utf-8', cacheControl: 'public, max-age=31536000, immutable' });
    expect(await get(`/${ADAPTER_FILE}`)).toMatchObject({ status: 200, body: `/*${ADAPTER_FILE}*/`, cacheControl: 'no-cache' });
    expect(await get('/sdk-1.0.0.js')).toEqual({ status: 404, body: '' });
    expect(await http.handle({ method: 'PUT', path: '/e/', body: new Uint8Array(), contentType: '' })).toEqual({ status: 404, body: '' });
    expect(asked).toEqual([SDK_FILE, ADAPTER_FILE]);
  });

  it('forwards only fixed collector paths, with ip=0 and no visitor headers; upstream failure is a 502', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    let ok = true;
    const request = (async (url: string, init: RequestInit) => { calls.push({ url, init }); return new Response(ok ? 'x' : '', { status: ok ? 200 : 500 }); }) as typeof fetch;
    const { http } = postHogConsentContribution({ ...base, host: 'https://collector.example/' }, { request });
    const post = (path: string) => http.handle({ method: 'POST', path, body: new TextEncoder().encode('{}'), contentType: 'application/json' });
    expect(await post('/decide/')).toEqual({ status: 404, body: '' });
    expect(calls).toEqual([]);
    expect(await post('/e/')).toEqual({ status: 200, body: '1' });
    expect(calls[0]!.url).toBe('https://collector.example/e/?ip=0');
    expect(calls[0]!.init).toMatchObject({ method: 'POST', headers: { 'content-type': 'application/json' }, redirect: 'error' });
    ok = false;
    expect(await post('/batch')).toEqual({ status: 502, body: '' });
  });

  it('reads its assets from beside the bundled server module by default', async () => {
    const { http } = postHogConsentContribution(base);
    await expect(http.handle({ method: 'GET', path: `/${ADAPTER_FILE}`, body: new Uint8Array(), contentType: '' }))
      .rejects.toMatchObject({ code: 'ENOENT', path: expect.stringMatching(/analytics-posthog\/consent-adapter\.mjs$/) });
  });

  it('pins the exact installed posthog-js file the build copies', async () => {
    const file = createRequire(import.meta.url).resolve('posthog-js/dist/module.full.no-external.js');
    const digest = createHash('sha256').update(await readFile(file)).digest('base64');
    expect(`sha256-${digest}`).toBe(POSTHOG_SDK_INTEGRITY);
  });
});

describe('PostHog consent adapter (browser module)', () => {
  it('the default export is a live analytics adapter the consent registry accepts', () => {
    expect(ADAPTER_SLOT.accept({ contribution: defaultAdapter as unknown as RawContribution })).toBe(defaultAdapter);
    expect(defaultAdapter).toMatchObject({ id: 'posthog', kind: 'consent-adapter', category: 'analytics', storage: POSTHOG_STORAGE });
  });

  it('grant loads the pinned SDK with its digest and starts one named instance with privacy settings', async () => {
    const f = adapterWith();
    const revoker = await f.adapter.grant({ config: config(), state, signal: new AbortController().signal });
    expect(revoker).not.toBeNull();
    expect(f.loads).toEqual([{ src: '/_consent/posthog/sdk-1.260.2.js', integrity: POSTHOG_SDK_INTEGRITY }]);
    expect(f.inits).toHaveLength(1);
    expect(f.inits[0]).toMatchObject({ name: 'jini_consent', api_host: '/_consent/posthog', persistence: 'localStorage+cookie',
      persistence_name: 'jini_site_site-1', person_profiles: 'identified_only', disable_session_recording: true, request_batching: false,
      mask_all_text: true, mask_all_element_attributes: true, disable_external_dependency_loading: true, ip: false });
    expect(f.identified).toEqual(['visitor:anon-1']);
  });

  it('runs nothing when the SDK fails its integrity check or the choice is withdrawn mid-download', async () => {
    const failed = adapterWith({ fail: true });
    expect(await failed.adapter.grant({ config: config(), state, signal: new AbortController().signal })).toBeNull();
    expect(failed.inits).toEqual([]);
    const ctl = new AbortController();
    const withdrawn = adapterWith();
    const pending = withdrawn.adapter.grant({ config: config(), state, signal: ctl.signal });
    ctl.abort();
    expect(await pending).toBeNull();
    expect(withdrawn.inits).toEqual([]);
  });

  it('revoke stops replay, disables persistence and drops events; it asks for a reload only when replay may have run', async () => {
    const f = adapterWith();
    const revoker = await f.adapter.grant({ config: config(), state, signal: new AbortController().signal });
    expect(await revoker!.revoke!()).toBe(true);
    expect(f.stopped()).toBe(1);
    const retired = f.configs.at(-1)!;
    expect(retired).toMatchObject({ disable_persistence: true, autocapture: false, capture_pageview: false, disable_session_recording: true });
    expect(retired.before_send({ event: 'x' })).toBeNull();
    const replay = adapterWith();
    const replayed = await replay.adapter.grant({ config: config({ sessionReplay: true }), state, signal: new AbortController().signal });
    expect(replay.inits[0]!.disable_session_recording).toBe(false);
    expect(await replayed!.revoke!()).toBe(false);
  });

  it('a second grant in the same page re-applies settings to the same instance, so events flow again', async () => {
    const f = adapterWith();
    const first = new AbortController();
    const revoker = await f.adapter.grant({ config: config(), state, signal: first.signal });
    first.abort();
    await revoker!.revoke!();
    const second = await f.adapter.grant({ config: config(), state, signal: new AbortController().signal });
    expect(second).not.toBeNull();
    expect(f.inits).toHaveLength(1);
    const reapplied = f.configs.at(-1)!;
    expect(reapplied).toMatchObject({ disable_persistence: false, api_host: '/_consent/posthog' });
    expect(reapplied.before_send({ event: '$pageview', properties: {} })).not.toBeNull();
  });

  it('before_send keeps an allow-list, redacts paths and DOM content, and drops events once withdrawn', async () => {
    const f = adapterWith();
    const ctl = new AbortController();
    await f.adapter.grant({ config: config(), state, signal: ctl.signal });
    const beforeSend = f.inits[0]!.before_send;
    const sent = beforeSend({ event: '$autocapture', properties: { distinct_id: 'visitor:1', $browser: 'Firefox', email: 'a@b.example',
      $current_url: 'https://site.example/account?token=secret', $referrer: 'https://elsewhere.example',
      $elements_chain: 'a.private-class:nth-child(2)nth-of-type(1);div#id-pii;;123bad',
      $elements: [{ tag_name: 'a', nth_child: 2, nth_of_type: 0, $el_text: 'Jane Doe', attr__href: '/x' }, { tag_name: '1bad' }, {}, null] } });
    expect(sent.properties).toEqual({ distinct_id: 'visitor:1', $browser: 'Firefox', $process_person_profile: true, $pathname: '/account',
      $current_url: 'https://site.example/account', $host: 'site.example', $elements_chain: 'a:nth-child(2);div',
      $elements: [{ tag_name: 'a', nth_child: 2 }], site_id: 'site-1', surface: 'site' });
    expect(beforeSend({ event: '$identify', properties: { $set: { email: 'a@b.example' } } }).properties.$set).toEqual({});
    expect(beforeSend({ event: '$pageview' }).properties.$pathname).toBe('/account');
    ctl.abort();
    expect(beforeSend({ event: '$pageview', properties: {} })).toBeNull();
  });

  it('identifies a returning visitor once, keeps an existing prefix, and never after a withdrawal', async () => {
    const f = adapterWith();
    f.setId('visitor:returning');
    const ctl = new AbortController();
    await f.adapter.grant({ config: { ...config(), siteId: undefined } as unknown as PostHogConsentConfig, state, signal: ctl.signal });
    expect(f.identified).toEqual(['visitor:returning']);
    expect(f.inits[0]!.persistence_name).toBe('jini_site_site');
    expect(f.inits[0]!.before_send({ event: 'x', properties: {} }).properties).not.toHaveProperty('site_id');
    ctl.abort();
    f.inits[0]!.loaded(f.client);
    expect(f.identified).toEqual(['visitor:returning']);
  });

  it('safePath redacts emails, long tokens and undecodable segments', () => {
    expect(safePath({ path: '/u/a%40b.example/0123456789abcdef0123456789abcdef/%E0%A4%A/ok' })).toBe('/u/:redacted/:redacted/:redacted/ok');
    expect(safePath({ path: '' })).toBe('/');
  });
});

describe('loadVerifiedSdk', () => {
  function fakeDoc() {
    const appended: Record<string, any>[] = [];
    const doc: LoaderDocument = { createElement: () => ({ type: '', src: '', integrity: '', onload: null, onerror: null }),
      head: { append: node => { appended.push(node); } } };
    return { doc, appended };
  }

  it('runs the SDK through a module script with SRI, then imports that same verified URL', async () => {
    const { doc, appended } = fakeDoc();
    const imported: string[] = [];
    const sdk = { init: () => { throw new Error('unused'); } };
    const loading = loadVerifiedSdk({ src: '/p/sdk.js', integrity: POSTHOG_SDK_INTEGRITY, doc }, { importModule: async url => { imported.push(url); return { default: sdk }; } });
    expect(appended[0]).toMatchObject({ type: 'module', src: '/p/sdk.js', integrity: POSTHOG_SDK_INTEGRITY });
    expect(imported).toEqual([]);
    appended[0]!.onload();
    expect(await loading).toBe(sdk);
    expect(imported).toEqual(['/p/sdk.js']);
  });

  it('rejects without importing when the browser refuses the bytes', async () => {
    const { doc, appended } = fakeDoc();
    let imported = false;
    const loading = loadVerifiedSdk({ src: '/p/sdk.js', integrity: 'sha256-x', doc }, { importModule: async () => { imported = true; return { default: {} as never }; } });
    appended[0]!.onerror();
    await expect(loading).rejects.toThrow('integrity');
    expect(imported).toBe(false);
  });
});

describe('default browser ports', () => {
  it('load through document and import(), and read the live location', async () => {
    const page = globalThis as unknown as Record<string, unknown>;
    const appended: Record<string, any>[] = [];
    page.document = { createElement: () => ({ type: '', src: '', integrity: '', onload: null, onerror: null }), head: { append: (node: Record<string, any>) => { appended.push(node); queueMicrotask(() => node.onload()); } } };
    page.location = location;
    try {
      const fakeModule = 'export default { init: (_t, settings) => { globalThis.__phSettings = settings; return { set_config() {}, get_distinct_id: () => "a", identify() {} }; } };';
      const sdk = `data:text/javascript,${encodeURIComponent(fakeModule)}`;
      const revoker = await defaultAdapter.grant({ config: config({ sdk }), state, signal: new AbortController().signal });
      expect(revoker).not.toBeNull();
      expect(appended[0]).toMatchObject({ type: 'module', integrity: POSTHOG_SDK_INTEGRITY });
      const settings = page.__phSettings as Settings;
      expect(settings.before_send({ event: 'x', properties: {} }).properties.$host).toBe('site.example');
    } finally {
      delete page.document; delete page.location; delete page.__phSettings;
    }
  });
});
