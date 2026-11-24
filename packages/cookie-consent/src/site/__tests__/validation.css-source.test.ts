/** @file consentConfigProblems hands the saved Custom CSS and appearance tokens to the engine compiler. */
import assert from 'node:assert/strict';
import { test } from 'vitest';
import { SITE_CONSENT_DEFAULTS } from '../config.js';
import { consentConfigProblems, parseConsentConfig } from '../validation.js';

const base = { ...SITE_CONSENT_DEFAULTS, enabled: true };

test('a refused Custom CSS rule is reported on the appearance field', () => {
  const config = parseConsentConfig({ value: { ...base, customCss: '#jini-consent { position: fixed; }' } });
  const problems = consentConfigProblems({ config, trustedRegion: false }).filter(problem => problem.field === 'appearance');
  assert.ok(problems.length > 0, JSON.stringify(problems));
});

test('unreadable appearance tokens are reported on the appearance field', () => {
  const config = parseConsentConfig({ value: { ...base, appearance: { backgroundColor: '#fff', textColor: '#fff' } } });
  const problems = consentConfigProblems({ config, trustedRegion: false }).filter(problem => problem.field === 'appearance');
  assert.ok(problems.some(problem => problem.code === 'contrast'), JSON.stringify(problems));
});

test('cssBlocks false leaves CSS problems to the preview', () => {
  const config = parseConsentConfig({ value: { ...base, customCss: '#jini-consent { position: fixed; }' } });
  assert.deepEqual(consentConfigProblems({ config, trustedRegion: false }, { cssBlocks: false }).filter(problem => problem.field === 'appearance'), []);
});
