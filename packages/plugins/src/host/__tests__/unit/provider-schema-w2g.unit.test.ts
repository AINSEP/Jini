import { expect, test } from 'vitest';
import { providerSettingsErrors, validatePluginProviderDeclarations } from '../../provider-contributions.js';

test.each([
  { requiredUnless: { field: 'mode', equals: 'off', orPresent: 'headers', headerNames: [] } },
  { requiredUnless: { field: 'mode', equals: 'off', headerNames: ['Authorization'] } },
  { requiredUnless: { field: 'mode', equals: 'off', orPresent: 'headers', headerNames: ['Bad Header'] } },
  { requiredWhen: { field: 'mode', in: [] } },
])('malformed conditional setting %j cannot reach provider setup', patch => {
  const errors = providerSettingsErrors({ settings: [{ name: 'token', label: 'Token', ...patch }] });
  expect(errors).toHaveLength(1);
  expect(errors[0]).toMatch(/malformed required(?:Unless|When)/);
});

test('migration predicates cannot read secrets or use a secret field as their presence gate', () => {
  const base = { contract: 'mail', id: 'api', contractVersion: 1,
    settings: [{ name: 'mode', label: 'Mode' }, { name: 'token', label: 'Token', secret: true }] };
  for (const rule of [
    { when: { field: 'token', in: ['old'] }, set: { mode: 'new' } },
    { when: { field: 'mode', in: ['old'] }, whenPresent: 'token', set: { mode: 'new' } },
    { when: { field: 'mode', in: ['old'], orAbsent: 'yes' }, set: { mode: 'new' } },
  ]) {
    expect(validatePluginProviderDeclarations({ value: [{ ...base, settingsMigrations: [rule] }], tier: 'tier-3', capabilities: ['providers.register'] })).toEqual([
      { code: 'PROVIDERS_INVALID', file: null, message: 'provider settingsMigrations are malformed or assign secret fields' },
    ]);
  }
});

test('a null entry in a setting\'s options is refused like any other malformed option', () => {
  expect(providerSettingsErrors({ settings: [{ name: 'region', label: 'Region', options: [{ value: 'eu', label: 'EU' }, null] }] }))
    .toEqual(["provider setting 'region' options must be a non-empty list of { value, label }"]);
  expect(providerSettingsErrors({ settings: [{ name: 'region', label: 'Region', options: [{ value: 'eu', label: 'EU' }] }] })).toEqual([]);
});

test('contributes.providers must be a list; an empty list needs no tier-3 or capability admission', () => {
  for (const value of [null, { contract: 'mail' }, 'mail']) {
    expect(validatePluginProviderDeclarations({ value, tier: 'tier-3', capabilities: ['providers.register'] })).toEqual([
      { code: 'PROVIDERS_INVALID', file: null, message: 'contributes.providers must be a list of provider declarations' },
    ]);
  }
  expect(validatePluginProviderDeclarations({ value: [], tier: 'tier-1', capabilities: [] })).toEqual([]);
  // The same tier and capabilities are refused as soon as one provider is declared.
  expect(validatePluginProviderDeclarations({ value: [{ contract: 'mail', id: 'api', contractVersion: 1 }], tier: 'tier-1', capabilities: [] }))
    .toContainEqual({ code: 'PROVIDERS_INVALID', file: null, message: 'provider declarations require tier-3' });
});
