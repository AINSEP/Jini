/** R12b privacy tests against the BUILT browser artifact (`server/consent-adapter.mjs`), loaded in a private jsdom window.
 * The adapter ships as a separate module that cannot import the consent client, so the client hands it the storage
 * purge on every call; these tests prove each cleanup path runs through that handed purge. Node environment: the
 * build uses esbuild, which a jsdom test environment breaks (same split as `browser-provider-dom.ts`). */
import { JSDOM } from 'jsdom';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCookieConsent, purgeStorage } from '@jini-ai/cookie-consent/client';
import { effective } from '@jini-ai/cookie-consent/policy';
import type { ConsentAdapter, ConsentState, PurgeStorage } from '@jini-ai/cookie-consent';
import { buildProviderPlugin } from '../../scripts/build.js';
import { ADAPTER_FILE } from '../analytics-posthog/consent.js';
import { POSTHOG_STORAGE } from '../analytics-posthog/consent-adapter.js';

const packageRoot = fileURLToPath(new URL('../..', import.meta.url));
const anonymous: ConsentState = effective({ stored: null, policy: 'p1', region: 'opt-in', gpc: false, nowMs: 0 }, { anonymous: true });
const at = (analyticsLevel: ConsentState['analyticsLevel']): ConsentState => ({ ...anonymous, analyticsLevel });
/** What the fake SDK publishes about the client the adapter created. */
const page = globalThis as { __phClient?: { configs: Record<string, unknown>[] } };
const leftovers = ['ph_jini_site_site-1', '__ph_opt_in_out_key'];

let root: string;
let adapterFile: string;
let sdkFile: string;
let imports = 0;
beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'posthog-consent-artifact-'));
  const entry = await buildProviderPlugin({ packageRoot, id: 'analytics-posthog', destinationPackageRoot: packageRoot }, { outputRoot: path.join(root, 'out') });
  adapterFile = path.join(root, 'out', entry.path, 'server', ADAPTER_FILE);
  await readFile(adapterFile);
  // The SDK a granted adapter loads: a module whose default export records what the adapter configures.
  sdkFile = path.join(root, 'fake-sdk.mjs');
  await writeFile(sdkFile, `export default { init(_token, settings) { const c = { configs: [], set_config(next) { c.configs.push(next); }, get_distinct_id: () => 'a', identify() {}, stopSessionRecording() {} };
    globalThis.__phClient = c; settings.loaded(c); return c; } };`);
}, 120_000);
afterAll(async () => { await rm(root, { recursive: true, force: true }); });

let dom: JSDOM;
let requests: unknown[];
beforeEach(() => {
  dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', { url: 'https://site.example/account' });
  requests = [];
  for (const [name, value] of Object.entries({ window: dom.window, document: dom.window.document, location: dom.window.location, CustomEvent: dom.window.CustomEvent,
    fetch: vi.fn(async (...args: unknown[]) => { requests.push(args); return new Response('1'); }) })) vi.stubGlobal(name, value);
  // The browser verifies the SDK's SRI hash when it loads the script; here the load succeeds and import() reads the fake module.
  dom.window.document.head.append = ((node: { onload?: () => void }) => { queueMicrotask(() => node.onload?.()); }) as never;
});
afterEach(() => { vi.unstubAllGlobals(); delete page.__phClient; dom.window.close(); });

/** A fresh instance of the built module, so one test's page state never reaches the next. */
async function builtAdapter(): Promise<ConsentAdapter<Record<string, unknown>>> {
  const module = await import(`${pathToFileURL(adapterFile).href}?run=${++imports}`) as { default: ConsentAdapter<Record<string, unknown>> };
  return module.default;
}
const config = () => ({ apiKey: 'phc_fixture_key', host: '/_consent/posthog', sdk: pathToFileURL(sdkFile).href, integrity: 'sha256-unused', sessionReplay: false, siteId: 'site-1' });
const seed = () => { for (const name of [...leftovers, 'host_preference']) { dom.window.document.cookie = `${name}=1; Path=/`; dom.window.localStorage.setItem(name, '1'); } };
const remaining = () => ({ cookie: dom.window.document.cookie, local: Object.keys(dom.window.localStorage).sort() });
/** A purge that records its argument and still deletes, like the client's. */
function recordingPurge(): { purge: PurgeStorage; calls: Parameters<PurgeStorage>[0][] } {
  const calls: Parameters<PurgeStorage>[0][] = [];
  return { calls, purge: (required, optional = {}) => { calls.push(required); purgeStorage(required, optional); } };
}
const signal = () => new AbortController().signal;

describe('the built consent adapter cleans through the purge the client hands it', () => {
  it('initial state off: this provider\'s cookies and local keys are purged, host keys stay, and no SDK client starts', async () => {
    seed();
    const { purge, calls } = recordingPurge();
    (await builtAdapter()).onState!({ state: at('none'), purge });
    expect(calls).toEqual([{ doc: dom.window.document, storage: POSTHOG_STORAGE }]);
    expect(remaining()).toEqual({ cookie: 'host_preference=1', local: ['host_preference'] });
    expect(page.__phClient).toBeUndefined();
    expect(dom.window.document.head.querySelector('script')).toBeNull();
  });

  it('full to anonymous: purged once with the same prefixes as before; full itself purges nothing', async () => {
    const adapter = await builtAdapter();
    const { purge, calls } = recordingPurge();
    seed();
    adapter.onState!({ state: at('full'), purge });
    expect(calls).toEqual([]);
    expect(remaining().local).toContain('ph_jini_site_site-1');
    adapter.onState!({ state: at('anonymous'), purge });
    expect(calls).toEqual([{ doc: dom.window.document, storage: { cookies: ['ph_', '__ph'], local: ['ph_', '__ph'] } }]);
    expect(remaining()).toEqual({ cookie: 'host_preference=1', local: ['host_preference'] });
  });

  it('a document that refuses cookie access never blocks the cleanup call', async () => {
    const adapter = await builtAdapter();
    const refuse = vi.fn(() => { throw new dom.window.DOMException('sandboxed', 'SecurityError'); });
    expect(() => adapter.onState!({ state: at('none'), purge: refuse })).not.toThrow();
    expect(refuse).toHaveBeenCalledOnce();
  });

  for (const level of ['anonymous', 'none'] as const) it(`grant at ${level}: the purge in GrantInput runs once with this provider's prefixes before grant returns`, async () => {
    seed();
    const { purge, calls } = recordingPurge();
    const revoker = await (await builtAdapter()).grant({ config: config(), state: at(level), signal: signal(), purge });
    expect(calls).toEqual([{ doc: dom.window.document, storage: POSTHOG_STORAGE }]);
    expect(remaining()).toEqual({ cookie: 'host_preference=1', local: ['host_preference'] });
    expect(revoker === null).toBe(level === 'none');
    expect(requests).toHaveLength(level === 'anonymous' ? 1 : 0);
  });

  it('revocation: the consent client purges the provider\'s storage after the adapter stops its SDK client', async () => {
    const adapter = await builtAdapter();
    const api = createCookieConsent({ config: { contract: 1, policy: 'p1', regionMode: 'opt-in', banner: 'headless',
      plugins: [{ id: 'posthog', kind: 'consent-adapter', category: 'analytics', supportsAnonymous: true, src: '/adapter.js', storage: POSTHOG_STORAGE, config: config() }] },
    ports: { doc: dom.window.document, gpc: () => false, fetch: vi.fn(), now: () => 1_800_000_000_000, reload: vi.fn(), importModule: async () => ({ default: adapter }) } });
    await api.set({ action: 'accept' });
    await vi.waitFor(() => expect(page.__phClient).toBeDefined());
    dom.window.document.cookie = 'ph_jini_site_site-1=1; Path=/';
    dom.window.localStorage.setItem('ph_jini_site_site-1', '1');
    await api.set({ action: 'reject' });
    await vi.waitFor(() => expect(remaining().local).toEqual([]));
    expect(remaining().cookie).not.toContain('ph_');
    expect(page.__phClient?.configs.at(-1)).toMatchObject({ disable_persistence: true, autocapture: false });
  });
});
