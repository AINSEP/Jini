import assert from 'node:assert/strict';
import { test, vi } from 'vitest';
import { InMemorySettingsRepo } from '@jini-ai/core/settings';
import { SITE_CONSENT_DEFAULTS, SITE_CONSENT_NAMESPACE } from '../config.js';
import { createSiteConsentConfig, createSiteConsentReadiness, resolveSiteConsentActivation, SITE_CONSENT_OFF } from '../settings.js';

/**
 * @file Characterization of site consent readiness moved from the host: definitions register before
 * the optional privacy repair, a repair failure goes ONLY to the host's required reporter (never the
 * console) without blocking readiness, and an unset ledger resolves to the product default.
 */

const clock = { nowMs: () => Date.parse('2026-10-09T12:00:00.000Z'), nowIso: () => '2026-10-09T12:00:00.000Z' };

function ledgerDeps() {
  const settingsRepo = new InMemorySettingsRepo();
  let counter = 0;
  return { settingsRepo, clock, ids: { newId: () => `consent-test-${++counter}` }, principals: { findActiveById: async ({ id }: { id: string }) => ({ id }) } };
}

test('readiness without a repair registers the definitions and reports nothing', async () => {
  const deps = ledgerDeps();
  await createSiteConsentReadiness({ ...deps, after: Promise.resolve(), systemPrincipalId: 'system-test' });
  assert.ok(await deps.settingsRepo.findActiveDefinition({ namespace: SITE_CONSENT_NAMESPACE, key: 'enabled', workspaceId: null }));
  assert.deepEqual(await resolveSiteConsentActivation({ settingsRepo: deps.settingsRepo, workspaceId: 'site-a' }), { enabled: SITE_CONSENT_DEFAULTS.enabled, source: 'default' });
});

test('a repair failure reaches only the injected reporter, does not block readiness, and retries next open', async () => {
  const deps = ledgerDeps();
  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const failure = new Error('privacy bootstrap failed');
  const reported: unknown[] = [];
  let attempts = 0;
  const repair = {
    ensurePrivacyDefaults: async () => {
      assert.ok(await deps.settingsRepo.findActiveDefinition({ namespace: SITE_CONSENT_NAMESPACE, key: 'privacyPolicyUrl', workspaceId: null }));
      if (++attempts === 1) throw failure;
    },
    reportPrivacyDefaultsFailure: ({ error }: { error: unknown }) => { reported.push(error); },
  };
  try {
    await createSiteConsentReadiness({ ...deps, after: Promise.resolve(), systemPrincipalId: 'system-test' }, repair);
    assert.deepEqual(reported, [failure]);
    const expected = SITE_CONSENT_DEFAULTS.enabled ? { ...SITE_CONSENT_DEFAULTS, reopen: 'link' } : { ...SITE_CONSENT_OFF, reopen: 'link' };
    assert.deepEqual(await createSiteConsentConfig({ settingsRepo: deps.settingsRepo, workspaceId: 'site-a' }).get(), expected);
    await createSiteConsentReadiness({ ...deps, after: Promise.resolve(), systemPrincipalId: 'system-test' }, repair);
    assert.equal(attempts, 2);
    assert.deepEqual(reported, [failure]);
    assert.equal(consoleError.mock.calls.length, 0);
  } finally {
    consoleError.mockRestore();
  }
});
