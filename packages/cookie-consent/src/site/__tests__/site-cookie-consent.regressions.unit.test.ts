import { expect, it, vi } from 'vitest';
import type { ConsentConfig } from '@jini-ai/core/contracts/site/cookie-consent';
import { readVisitorConsent } from '../http.js';
import { refreshDocumentState, type DocumentState } from '../document-state.js';
import { siteConsentDocumentAssets } from '../document-assets.js';

const config: ConsentConfig = { enabled: false, regionMode: 'opt-in', policyVersion: 'p', privacyPolicyUrl: '/privacy', title: '', message: '', acceptLabel: '', rejectLabel: '', preferencesLabel: '' };

it('does not read the cookie getter when the banner is off', async () => {
  const cookie = vi.fn(() => 'cookie');
  const state = await readVisitorConsent({ readSnapshot: async () => config, snapshotUnavailable: () => false, readPolicy: async () => config,
    facts: () => ({ get cookieHeader() { return cookie(); }, secGpc: null, dnt: null, nowMs: 0 }) });
  expect(state.analyticsLevel).toBe('anonymous');
  expect(cookie).not.toHaveBeenCalled();
});

it('shares a pending document refresh across two app builds', async () => {
  let finish!: (config: ConsentConfig) => void;
  const readPolicy = vi.fn(() => new Promise<ConsentConfig>(resolve => { finish = resolve; }));
  const state: DocumentState = { scripts: Promise.resolve([]), nextReadAt: Infinity, now: () => 1000, schedule: () => () => {} };
  const required = { state, readPolicy, readDeclarations: async () => ({ scripts: [] }), policyFailure: () => {}, declarationFailure: () => {} };
  const first = refreshDocumentState(required);
  const second = refreshDocumentState(required);
  expect(first).toBe(second);
  expect(readPolicy).toHaveBeenCalledTimes(1);
  expect(state.nextReadAt).toBe(61000);
  finish(config);
  await first;
  expect(state.policy).toBe(config);
});

it('selects preview and off-mode assets without the consent runtime', async () => {
  const scripts = [{ src: '/necessary.js' }, { src: '/optional.js', consent: ['analytics'] as const }];
  const required: Parameters<typeof siteConsentDocumentAssets>[0] = {
    scripts: [], readPolicy: async () => config, readDeclarations: async () => scripts, hasConsent: true,
    preview: () => true, exporting: () => false, plugins: async () => [], clientSrc: undefined,
    extensionSrc: '/extensions.js', loaderSrc: '/loader.js', endpoint: '/consent',
  };
  const preview = await siteConsentDocumentAssets(required);
  expect(preview.head).toContain('/necessary.js');
  expect(preview.head).not.toContain('/optional.js');
  const off = await siteConsentDocumentAssets({ ...required, preview: () => false });
  expect(off.head).toContain('/necessary.js');
  expect(off.head).toContain('/optional.js');
  expect(off.body).toBe('');
});
