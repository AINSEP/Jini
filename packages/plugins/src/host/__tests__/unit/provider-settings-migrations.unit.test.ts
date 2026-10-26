import { expect, it } from 'vitest';
import { migrateProviderSettings } from '../../provider-settings-migrations.js';
import { validatePluginProviderDeclarations } from '../../provider-contributions.js';

const provider = { contract: 'custom', id: 'custom', contractVersion: 1 as const, settings: [
  { name: 'mode', label: 'Mode' }, { name: 'account', label: 'Account' }, { name: 'token', label: 'Token', secret: true },
], settingsMigrations: [
  { when: { field: 'mode', in: ['old'], orAbsent: true }, whenPresent: 'account', set: { mode: 'paired' } },
  { when: { field: 'mode', in: ['old'], orAbsent: true }, set: { mode: 'single' } },
] };
const validate = (value: unknown) => validatePluginProviderDeclarations({ value: [value], tier: 'tier-3', capabilities: ['providers.register'] });

it('migrates only matching retired choices, including absent values, without mutating inputs', () => {
  expect(validate(provider)).toEqual([]);
  for (const [settings, mode] of [[{}, 'single'], [{ mode: 'old' }, 'single'], [{ mode: 'old', account: 'A' }, 'paired'],
    [{ account: '  ' }, 'single'], [{ mode: 'single', account: 'A' }, 'single'], [{ mode: 'current' }, 'current']] as const) {
    const snapshot = structuredClone(settings);
    expect(migrateProviderSettings({ providers: [provider], settings })).toEqual({ ...settings, mode });
    expect(migrateProviderSettings({ providers: [{ ...provider, settingsMigrations: [] }], settings })).toEqual(snapshot);
    expect(settings).toEqual(snapshot);
  }
});

it('refuses malformed hooks, undeclared references and all secret reads or assignments', () => {
  const rule = provider.settingsMigrations[0]!;
  for (const settingsMigrations of [null, {}, [null], [{ ...rule, when: {} }], [{ ...rule, when: { ...rule.when, orAbsent: 'yes' } }],
    [{ ...rule, when: { ...rule.when, field: 'unknown' } }], [{ ...rule, whenPresent: 'token' }],
    [{ ...rule, when: { ...rule.when, field: 'token' } }], [{ ...rule, set: { token: 'public' } }],
    [{ ...rule, set: { unknown: 'current' } }], [{ ...rule, set: {} }], [{ ...rule, set: [] }]]) {
    expect(validate({ ...provider, settingsMigrations })).toEqual([{ code: 'PROVIDERS_INVALID', file: null,
      message: 'provider settingsMigrations are malformed or assign secret fields' }]);
  }
});
