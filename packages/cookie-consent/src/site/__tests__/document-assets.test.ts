import { JSDOM } from 'jsdom';
import { expect, it, vi } from 'vitest';
import type { DeclaredScript } from '@jini-ai/core/contracts/site/cookie-consent';
import { documentPlugins, siteConsentDocumentAssets, siteConsentExportAssets, staticConsentLoaderScript } from '../document-assets.js';
import { SITE_CONSENT_DEFAULTS } from '../config.js';

const policy = { ...SITE_CONSENT_DEFAULTS, enabled: true, policyVersion: 'p42', regionMode: 'opt-in' as const };
const declarations: DeclaredScript[] = [{ src: '/plugin.js', consent: ['analytics'] }, { src: '/necessary.js' }];
const theme: DeclaredScript[] = [{ src: '/theme.js' }, { src: '/metrics.js', consent: ['analytics'] }];
const bridge = { kind: 'consent-bridge', id: 'prefs', src: '/prefs.mjs' };

function documentInput() {
  return {
    readPolicy: async () => policy, readDeclarations: vi.fn(async () => declarations), scripts: theme,
    preview: () => false, exporting: () => false, hasConsent: true, plugins: vi.fn(async ({ live }: { live: boolean }) => live ? [bridge] : []),
    clientSrc: '/consent/client.js', extensionSrc: '/consent/extensions.js', loaderSrc: '/consent/loader.js', endpoint: '/consent',
  };
}

function inspect({ head, body }: { head: string; body: string }) {
  const { window } = new JSDOM(`<!doctype html><html><head>${head}</head><body>${body}</body></html>`);
  try {
    const doc = window.document;
    const config = doc.querySelector('#jini-consent-config');
    return {
      scripts: Array.from(doc.querySelectorAll('script[src]'), (tag) => tag.getAttribute('src')),
      config: config ? JSON.parse(config.textContent ?? '') : null,
      settings: doc.querySelector('[data-consent-open].jini-consent-settings')?.getAttribute('href'),
    };
  } finally { window.close(); }
}

it.each(['preview', 'missing-policy', 'unmounted'] as const)('serves only unconditional scripts for %s documents', async (scenario) => {
  const base = documentInput();
  const output = await siteConsentDocumentAssets({ ...base, preview: () => scenario === 'preview',
    readPolicy: async () => scenario === 'missing-policy' ? null : policy, hasConsent: scenario !== 'unmounted' });
  expect(inspect(output)).toEqual({ scripts: ['/theme.js', '/necessary.js'], config: null, settings: undefined });
  expect(output.body).toBe('');
  expect(base.plugins).not.toHaveBeenCalled();
});

it('lets an explicit off publication emit all declared scripts with no consent runtime in both document modes', async () => {
  const input = { ...documentInput(), readPolicy: async () => ({ ...policy, bannerMode: 'off' as const }) };
  const expected = { scripts: ['/theme.js', '/metrics.js', '/plugin.js', '/necessary.js'], config: null, settings: undefined };
  expect(inspect(await siteConsentDocumentAssets(input))).toEqual(expected);
  expect(inspect(await siteConsentDocumentAssets({ ...input, static: true }))).toEqual(expected);
  expect(input.plugins).not.toHaveBeenCalled();
});

it('serves an enabled static shell with just the loader and emits nothing without a usable policy', async () => {
  const input = { ...documentInput(), static: true as const };
  expect(await siteConsentDocumentAssets(input)).toEqual({
    head: '<script src="/consent/loader.js" defer data-jini-consent-loader></script>', body: '',
  });
  expect(await siteConsentDocumentAssets({ ...input, readPolicy: async () => null })).toEqual({ head: '', body: '' });
  expect(await siteConsentDocumentAssets({ ...input, preview: () => true })).toEqual({ head: '', body: '' });
  expect(input.readDeclarations).not.toHaveBeenCalled();
  expect(input.plugins).not.toHaveBeenCalled();
});

it('uses durable evidence and context only live and leaves conditional scripts inert in both modes', async () => {
  const input = documentInput();
  const live = inspect(await siteConsentDocumentAssets(input));
  expect(live.scripts).toEqual(['/theme.js', '/necessary.js', '/consent/client.js', '/consent/extensions.js']);
  expect(live.config).toMatchObject({ policy: 'p42', context: '/consent/context', evidence: { mode: 'durable', endpoint: '/consent' },
    scripts: [{ src: '/metrics.js', consent: ['analytics'] }, { src: '/plugin.js', consent: ['analytics'] }] });
  expect(live.settings).toBe('#privacy-choices');
  const exported = inspect(await siteConsentDocumentAssets({ ...input, exporting: () => true, clientSrc: undefined }));
  expect(exported.scripts).toEqual(['/theme.js', '/necessary.js']);
  expect(exported.config).toMatchObject({ policy: 'p42', evidence: { mode: 'local' } });
  expect(exported.config).not.toHaveProperty('context');
  expect(exported.config).not.toHaveProperty('plugins');
  expect(input.plugins.mock.calls).toEqual([[{ live: true }], [{ live: false }]]);
});

it('lists just the local export dependencies and refuses an enabled export without a consent owner', async () => {
  const input = {
    readDeclarations: async (): Promise<DeclaredScript[]> => [...declarations, { src: 'https://cdn.example/remote.js' }],
    client: () => ({ src: '/consent/client.js' }), extensionSrc: '/consent/extensions.js', hasConsent: () => true,
  };
  expect(await siteConsentExportAssets({ ...input, readPolicy: async () => null })).toEqual(['/necessary.js']);
  expect(await siteConsentExportAssets({ ...input, readPolicy: async () => ({ ...policy, enabled: false }) })).toEqual(['/plugin.js', '/necessary.js']);
  const enabled = { ...input, readPolicy: async () => policy };
  expect(await siteConsentExportAssets(enabled)).toEqual(['/consent/client.js', '/consent/extensions.js', '/plugin.js', '/necessary.js']);
  expect(await siteConsentExportAssets({ ...enabled, client: () => undefined })).toEqual(['/consent/extensions.js', '/plugin.js', '/necessary.js']);
  await expect(siteConsentExportAssets({ ...enabled, hasConsent: () => false })).rejects.toThrow('cookie consent export has no consent configuration');
});

it.each([false, true])('installs settings once and rebases only consent-owned URLs when exporting=%s', (exporting) => {
  const source = staticConsentLoaderScript({
    head: '<script type="application/json" id="jini-consent-config">{"scripts":[{"src":"/stats.js"},{"src":"https://cdn.example/track.js"}]}</script><script src="/consent/client.js" defer></script>',
    body: '<a data-consent-open href="/privacy">Settings</a>', exporting,
  });
  const dom = new JSDOM('<a id="authored" href="/about">About</a>', { url: 'https://site.example/export/', runScripts: 'outside-only' });
  try {
    const { document } = dom.window;
    const current = document.createElement('script');
    current.src = '/export/consent/loader.js';
    Object.defineProperty(document, 'currentScript', { value: current });
    dom.window.eval(source);
    dom.window.eval(source);
    const prefix = exporting ? '/export' : '';
    expect(document.querySelectorAll('#jini-consent-config')).toHaveLength(1);
    expect(JSON.parse(document.querySelector('#jini-consent-config')!.textContent ?? '')).toEqual({
      scripts: [{ src: `${prefix}/stats.js` }, { src: 'https://cdn.example/track.js' }],
    });
    expect(document.querySelector('[data-consent-open]')?.getAttribute('href')).toBe(`${prefix}/privacy`);
    expect(document.querySelector('#authored')?.getAttribute('href')).toBe('/about');
    expect(Array.from(document.querySelectorAll('script[src]'), (script) => script.getAttribute('src'))).toEqual([`${prefix}/consent/client.js`]);
  } finally { dom.window.close(); }
});

it('combines live plugins with opt-in diagnostics but never reads plugins for an export', async () => {
  const adapter = { id: 'statistics', kind: 'consent-adapter', category: 'analytics' };
  const diag = { id: 'diagnostic', kind: 'consent-adapter', category: 'functional' };
  const input = { adapters: vi.fn(() => [adapter]), browserPlugins: vi.fn(async () => [bridge]),
    diagnosticsEnabled: vi.fn(async () => false), diagnostics: vi.fn(() => diag) };
  expect(await documentPlugins({ ...input, live: false })).toEqual([]);
  expect(input.adapters).not.toHaveBeenCalled();
  expect(input.browserPlugins).not.toHaveBeenCalled();
  expect(input.diagnosticsEnabled).not.toHaveBeenCalled();
  expect(await documentPlugins({ ...input, live: true })).toEqual([adapter, bridge]);
  expect(input.diagnostics).not.toHaveBeenCalled();
  input.diagnosticsEnabled.mockResolvedValueOnce(true);
  expect(await documentPlugins({ ...input, live: true })).toEqual([adapter, bridge, diag]);
});
