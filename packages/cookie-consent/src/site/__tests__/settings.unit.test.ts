import assert from 'node:assert/strict';
import { expect, test, vi } from 'vitest';
import { InMemorySettingsRepo, type SettingValueRecord } from '@jini-ai/core/settings';
import { SITE_CONSENT_DEFAULTS, SITE_CONSENT_NAMESPACE } from '../config.js';
import { createSiteConsentConfig, createSiteConsentReadiness, readSiteConsentAuthoringSettings, resolveSiteConsentActivation, SITE_CONSENT_OFF } from '../settings.js';

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

async function configuredLedger() {
  const deps = ledgerDeps();
  const workspaceId = 'site-settings';
  await createSiteConsentReadiness({ ...deps, after: Promise.resolve(), systemPrincipalId: 'system-test' });
  async function write(key: string, valueJson: SettingValueRecord['valueJson']) {
    const definition = await deps.settingsRepo.findActiveDefinition({ namespace: SITE_CONSENT_NAMESPACE, key, workspaceId: null });
    if (!definition) throw new Error(`No definition for ${key}`);
    // Write the value row directly to model older owner choices that predate current validation.
    await deps.settingsRepo.saveWorkspaceValue({
      settingId: definition.settingId, defVersion: definition.version, scope: 'workspace', state: 'set',
      workspaceId, principalId: null, valueJson, seq: 1, updatedBy: 'owner', updatedAt: clock.nowIso(), originPluginId: null,
    });
  }
  const input = { settingsRepo: deps.settingsRepo, workspaceId };
  return { input, write, publicConfig: createSiteConsentConfig(input) };
}

test('honors explicit activation and preserves owner text while public delivery rolls back', async () => {
  const h = await configuredLedger();
  await h.write('title', 'Owner cookie choices');
  await h.write('enabled', true);
  expect(await resolveSiteConsentActivation(h.input)).toEqual({ enabled: true, source: 'owner' });
  expect(await h.publicConfig.get()).toMatchObject({ enabled: true, title: 'Owner cookie choices', privacyPolicyUrl: '/privacy', reopen: 'link' });
  await h.write('enabled', false);
  expect(await resolveSiteConsentActivation(h.input)).toEqual({ enabled: false, source: 'owner' });
  expect(await h.publicConfig.get()).toMatchObject({ enabled: false, title: 'Your cookie choices', reopen: 'link' });
  expect(await readSiteConsentAuthoringSettings(h.input)).toMatchObject({ enabled: false, title: 'Owner cookie choices' });
});

test.each([
  { key: 'enabled', bad: 'yes', message: 'Invalid cookie consent setting: enabled.' },
  { key: 'title', bad: false, message: 'Invalid cookie consent setting: title.' },
  { key: 'privacyPolicyUrl', bad: '/' + 'a'.repeat(2000), message: 'Cookie consent setting privacyPolicyUrl exceeds 2000 characters.' },
  { key: 'regionMode', bad: 'all-opt-out', message: 'Choose automatic, opt-in, or opt-out cookie consent region mode.' },
  { key: 'placement', bad: 'middle', message: 'Choose a cookie banner placement: bottom-bar, bottom-left, bottom-right, top-bar.' },
  { key: 'policyVersion', bad: ' '.repeat(5), message: 'Cookie consent policy version must contain 1–128 characters.' },
])('refuses the malformed legacy value for $key instead of guessing', async ({ key, bad, message }) => {
  const h = await configuredLedger();
  await h.write('enabled', true);
  await h.write(key, bad);
  await expect(h.publicConfig.get()).rejects.toThrow(message);
  await h.write('enabled', false);
  expect(await h.publicConfig.get()).toMatchObject({ enabled: false, reopen: 'link' });
});
