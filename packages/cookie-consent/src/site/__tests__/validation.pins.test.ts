/** @file Pin host copy validation and error precedence before splitting the text loop. */
import assert from 'node:assert/strict';
import { test } from 'vitest';
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
