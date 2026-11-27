/** @file Pin host copy validation and error precedence before splitting the text loop. */
import assert from 'node:assert/strict';
import { test, vi } from 'vitest';
import { ToolInputError } from '@jini-ai/core';
import { createSiteConsentService, type ConsentServicePorts } from '../service.js';
import { consentRevisionToken, readConsentRequest } from "../request.js";
import { buildConsentRegistrations, contributeConsentTools, type ConsentToolHost } from '../tool-registrations.js';
import type { SiteConsentState } from '../revisions.js';
import { SITE_CONSENT_DEFAULTS, SITE_CONSENT_TEXT_LIMITS } from '../config.js';
import { consentConfigProblems, parseConsentConfig } from '../validation.js';

for (const [key, max] of Object.entries(SITE_CONSENT_TEXT_LIMITS)) {
  test(`${key} preserves its exact bound, whitespace rule and optional empty secondary label`, () => {
    const valid = { ...SITE_CONSENT_DEFAULTS, [key]: 'x'.repeat(max) };
    assert.deepEqual(parseConsentConfig({ value: valid }), valid);
    for (const text of ['x'.repeat(max + 1), '   ']) {
      assert.throws(() => parseConsentConfig({ value: { ...valid, [key]: text } }), { message: `${key} must contain 1–${max} characters.` });
    }
    const empty = { ...valid, [key]: '' };
    if (key === 'secondaryLinkLabel') assert.deepEqual(parseConsentConfig({ value: empty }), empty);
    else assert.throws(() => parseConsentConfig({ value: empty }), { message: `${key} must contain 1–${max} characters.` });
  });
}

for (const key of ['regionMode', 'placement']) {
  test(`invalid ${key} takes precedence over invalid policy and text`, () => {
    assert.throws(() => parseConsentConfig({ value: { ...SITE_CONSENT_DEFAULTS, [key]: 'unknown', policyVersion: '', title: '' } }),
      { message: 'Choose a supported region mode and placement.' });
  });
}

test('policy version bounds preserve whitespace and precede text errors', () => {
  for (const policyVersion of ['', '   ', 'x'.repeat(65)]) {
    assert.throws(() => parseConsentConfig({ value: { ...SITE_CONSENT_DEFAULTS, policyVersion, title: '' } }), { message: 'policyVersion must contain 1–64 characters.' });
  }
  const policyVersion = ` ${'x'.repeat(62)} `;
  assert.equal(parseConsentConfig({ value: { ...SITE_CONSENT_DEFAULTS, policyVersion } }).policyVersion, policyVersion);
});

for (const key of ['privacyPolicyUrl', 'secondaryLinkUrl']) {
  test(`${key} permits 2000 characters and copy validation precedes link bounds`, () => {
    assert.equal(parseConsentConfig({ value: { ...SITE_CONSENT_DEFAULTS, [key]: 'x'.repeat(2000) } })[key as 'privacyPolicyUrl' | 'secondaryLinkUrl']?.length, 2000);
    assert.throws(() => parseConsentConfig({ value: { ...SITE_CONSENT_DEFAULTS, [key]: 'x'.repeat(2001) } }), { message: 'Policy links must be at most 2000 characters.' });
    assert.throws(() => parseConsentConfig({ value: { ...SITE_CONSENT_DEFAULTS, [key]: 'x'.repeat(2001), title: '' } }), { message: 'title must contain 1–120 characters.' });
  });
}

test('only a plain JSON object is a consent configuration', () => {
  for (const value of [null, undefined, 'config', 7, [], [SITE_CONSENT_DEFAULTS]]) {
    assert.throws(() => parseConsentConfig({ value }), { message: 'config must be a JSON object.' }, JSON.stringify(value));
  }
});

test('a configuration whose serialized size exceeds 32 KiB is refused even when every field is within its own bound', () => {
  const value = { ...SITE_CONSENT_DEFAULTS, customCss: 'x'.repeat(16_000), appearance: { background: 'y'.repeat(17_000) } };
  assert.throws(() => parseConsentConfig({ value }), { message: 'Consent configuration exceeds 32 KiB.' });
});

test('a secondary link needs both its label and a local or https URL', () => {
  const base = parseConsentConfig({ value: { ...SITE_CONSENT_DEFAULTS } });
  const secondary = (patch: Partial<typeof SITE_CONSENT_DEFAULTS>) => consentConfigProblems({ config: { ...base, ...patch }, trustedRegion: false }).filter(problem => problem.code === 'SECONDARY_LINK_INVALID');
  assert.deepEqual(secondary({}), []);
  assert.deepEqual(secondary({ secondaryLinkLabel: 'Imprint', secondaryLinkUrl: '/imprint' }), []);
  for (const patch of [{ secondaryLinkLabel: 'Imprint' }, { secondaryLinkUrl: '/imprint' }, { secondaryLinkLabel: 'Imprint', secondaryLinkUrl: 'http://example.com/imprint' }]) {
    assert.deepEqual(secondary(patch).map(problem => problem.field), ['secondaryLinkUrl'], JSON.stringify(patch));
  }
});

test('unsafe-eval is optional for old snapshots and accepts only literal booleans', () => {
  assert.equal(parseConsentConfig({ value: SITE_CONSENT_DEFAULTS }).allowUnsafeEval, undefined);
  for (const allowUnsafeEval of [true, false]) assert.equal(parseConsentConfig({ value: { ...SITE_CONSENT_DEFAULTS, allowUnsafeEval } }).allowUnsafeEval, allowUnsafeEval);
  for (const allowUnsafeEval of ['true', 1, null, {}, undefined]) assert.throws(() => parseConsentConfig({ value: { ...SITE_CONSENT_DEFAULTS, allowUnsafeEval } }), /allowUnsafeEval must be a boolean/);
});

test('host reopen policy accepts link mode and refuses an author-selected corner control', () => {
  assert.equal(parseConsentConfig({ value: { ...SITE_CONSENT_DEFAULTS, reopen: 'link' } }).reopen, 'link');
  assert.throws(() => parseConsentConfig({ value: { ...SITE_CONSENT_DEFAULTS, reopen: 'corner' } }), /reopen through a link/);
});

test('banner-mode refusal comes from each host and defaults to neutral copy', () => {
  for (const bannerModeRefusal of ['Host Alpha banner choices.', 'Host Beta banner choices.', undefined]) {
    assert.throws(() => parseConsentConfig({ value: { ...SITE_CONSENT_DEFAULTS, bannerMode: 'invalid' }, bannerModeRefusal }),
      { constructor: ToolInputError, message: bannerModeRefusal ?? 'Choose the built-in banner, your own banner, or none.' });
    for (const bannerMode of ['jini', 'headless', 'off']) {
      const value = { ...SITE_CONSENT_DEFAULTS, bannerMode };
      assert.deepEqual(parseConsentConfig({ value, bannerModeRefusal }), value);
    }
    assert.deepEqual(parseConsentConfig({ value: SITE_CONSENT_DEFAULTS, bannerModeRefusal }), SITE_CONSENT_DEFAULTS);
  }
});

test('draft and assistant preparation use the bound banner-mode refusal', async () => {
  const bannerModeRefusal = 'Host Alpha banner choices.';
  const config = { ...SITE_CONSENT_DEFAULTS };
  const invalid = { ...config, bannerMode: 'invalid' };
  const state: SiteConsentState = { draft: null, published: null };
  const saveDraft = vi.fn();
  const ports: ConsentServicePorts = {
    workspaceId: 'w', bannerModeRefusal, authorize: async () => ({ allowed: true, reason: 'allowed' }),
    ready: Promise.resolve(), clock: { nowIso: () => '2026-11-25T00:00:00Z' }, ids: { newId: () => 'draft' }, trustedRegion: false,
    store: { read: async () => state, readPublished: async () => null, saveDraft, publish: vi.fn() },
    readLegacy: async () => config, defaultOnly: async () => false, privacyPageExists: async () => true,
    renderPage: async () => ({ html: '', ok: true, truncated: false }), receiptStorage: async () => ({ writable: true, count: 0 }),
    consentPagePath: ({ path }) => path, deploymentRefusal: ({ problems }) => ({ code: 'CONSENT', error: 'refused', blockingProblems: problems, choices: [] }),
    reportConsentFailure: vi.fn(),
  };
  const siteConsent = createSiteConsentService({ ports });
  await assert.rejects(siteConsent.saveDraft({ principalId: 'p', config: invalid, expectedDraftId: null }), { constructor: ToolInputError, message: bannerModeRefusal });
  const registrations = buildConsentRegistrations({ siteConsent, host: {
    bannerModeRefusal, approvalToolHandler: ({ prepare }) => ctx => prepare({ ctx }),
    readConsentRequest: ({ body }) => body as Record<string, unknown>, consentRevisionToken: ({ input, key }) => input[key] as string | null,
  } }, { surfaceExchanges: { open: () => { throw new Error('unexpected confirmation'); }, deliver: () => { throw new Error('unexpected delivery'); }, findTypedAnswerTarget: () => undefined, size: () => 0 } });
  const ctx = { executionId: 'e', principal: { id: 'p' }, run: { id: 'r' }, signal: new AbortController().signal, input: { config: invalid, expectedDraftId: null } };
  const update = registrations.find(item => item.descriptor.id === 'consent_update_settings')!;
  await assert.rejects(update.handler(ctx), { constructor: ToolInputError, message: bannerModeRefusal });
  state.draft = { id: 'draft', config: invalid as typeof config, actorId: 'p', createdAt: '2026-11-25T00:00:00Z' };
  const publish = registrations.find(item => item.descriptor.id === 'consent_publish_settings')!;
  await assert.rejects(publish.handler({ ...ctx, input: { draftId: 'draft', expectedPublishedId: null } }), { constructor: ToolInputError, message: bannerModeRefusal });
  assert.equal(saveDraft.mock.calls.length, 0);
});

test('the consent diagnostic tools preserve the caller’s path and refuse malformed requests or absent service', async () => {
  const readiness = vi.fn(async ({ principalId, path }: { principalId: string; path?: string | undefined }) => ({ principalId, sampledPaths: [path], ready: false }));
  const service = {
    readiness: readiness as unknown as ReturnType<typeof createSiteConsentService>['readiness'],
    read: vi.fn(), deploymentCheck: vi.fn(), publish: vi.fn(), preview: vi.fn(), saveDraft: vi.fn(),
  } satisfies ReturnType<typeof createSiteConsentService>;
  const host: ConsentToolHost = {
    approvalToolHandler: () => async () => { throw new Error('diagnostics must not require write confirmation'); },
    readConsentRequest, consentRevisionToken,
  };
  const surfaces = { surfaceExchanges: {
    open: () => { throw new Error('unexpected confirmation'); },
    deliver: () => { throw new Error('unexpected delivery'); },
    findTypedAnswerTarget: () => undefined, size: () => 0,
  } };
  const contributor = contributeConsentTools({ host });
  const ctx = { executionId: 'e2', principal: { id: 'reader-2' }, run: { id: 'r2' }, signal: new AbortController().signal, input: { path: '/sample' } };
  const registrations = contributor.build({ siteConsent: service }, surfaces);
  const read = registrations.find(({ descriptor }) => descriptor.id === 'consent_get_readiness')!;
  const explain = registrations.find(({ descriptor }) => descriptor.id === 'consent_explain_blocked')!;
  assert.deepEqual(await read.handler(ctx), { principalId: 'reader-2', sampledPaths: ['/sample'], ready: false });
  assert.deepEqual(await explain.handler(ctx), {
    principalId: 'reader-2', sampledPaths: ['/sample'], ready: false,
    explanation: 'Declared optional scripts wait until all their consent categories are effectively allowed. Unmanaged content and missing runtime slots need review; they are not automatically controlled. Durable grants wait for receipt confirmation.',
  });
  await assert.rejects(read.handler({ ...ctx, input: { path: 5 } }), { constructor: ToolInputError, message: 'path must be a local page path.' });
  await assert.rejects(read.handler({ ...ctx, input: { path: '/sample', force: true } }), { constructor: ToolInputError, message: 'Unknown consent request field.' });
  assert.deepEqual(readiness.mock.calls, [[{ principalId: 'reader-2', path: '/sample' }], [{ principalId: 'reader-2', path: '/sample' }]]);
  const missing = contributor.build({}, surfaces).find(({ descriptor }) => descriptor.id === 'consent_get_readiness')!;
  await assert.rejects(missing.handler({ ...ctx, input: undefined }), { constructor: ToolInputError, message: 'The site consent service is unavailable. Nothing was changed.' });
});

test('validates appearance fields as a separate shape boundary', () => {
  const valid = { ...SITE_CONSENT_DEFAULTS, customCss: '#jini-consent{padding:16px}', appearance: { borderRadius: '8px' } };
  assert.deepEqual(parseConsentConfig({ value: valid }), valid);
  for (const appearance of [null, [], 'theme']) {
    assert.throws(() => parseConsentConfig({ value: { ...valid, appearance } }), { constructor: ToolInputError, message: 'appearance must be a token object.' });
  }
  for (const customCss of [false, 'x'.repeat(16_385)]) {
    assert.throws(() => parseConsentConfig({ value: { ...valid, customCss } }), { constructor: ToolInputError, message: 'customCss must be a string of at most 16384 characters.' });
  }
});
