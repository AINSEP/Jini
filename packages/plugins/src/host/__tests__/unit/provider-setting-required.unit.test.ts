import { describe, expect, it } from 'vitest';
import { isProviderSettingRequired } from '../../provider-setting-required.js';
import { providerSettingsErrors } from '../../provider-contributions.js';

const field = { name: 'token', label: 'Token', required: true, requiredUnless: { field: 'auth', equals: 'none' } };

describe('conditional provider requirements', () => {
  it('waives only an exact choice; missing, blank and unknown choices fail closed', () => {
    for (const values of [{}, { auth: '' }, { auth: 'token' }, { auth: 'NONE' }, { auth: 'unknown' }]) {
      expect(isProviderSettingRequired({ field, values })).toBe(true);
    }
    expect(isProviderSettingRequired({ field, values: { auth: 'none' } })).toBe(false);
    expect(isProviderSettingRequired({ field: { required: false }, values: {} })).toBe(false);
    expect(isProviderSettingRequired({ field: { required: true }, values: {} })).toBe(true);
  });

  it('accepts the manifest condition and rejects malformed conditions', () => {
    expect(providerSettingsErrors({ settings: [field] })).toEqual([]);
    for (const requiredUnless of [null, [], 'none', {}, { field: '9bad', equals: 'none' }, { field: 'auth', equals: false }]) {
      expect(providerSettingsErrors({ settings: [{ ...field, requiredUnless }] })).toEqual(["provider setting 'token' has a malformed requiredUnless"]);
    }
  });
});
