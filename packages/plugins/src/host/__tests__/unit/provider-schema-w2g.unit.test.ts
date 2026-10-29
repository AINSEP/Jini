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
