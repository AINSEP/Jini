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


describe('requiredWhen', () => {
  const username = { requiredWhen: { field: 'auth', in: ['grafana-cloud', 'basic'] } };
  it('requires the field only for the declared exact choices, with an explicit waiver taking precedence', () => {
    for (const auth of ['grafana-cloud', 'basic']) expect(isProviderSettingRequired({ field: username, values: { auth } })).toBe(true);
    for (const values of [{}, { auth: '' }, { auth: 'token' }, { auth: 'none' }]) expect(isProviderSettingRequired({ field: username, values })).toBe(false);
    expect(isProviderSettingRequired({ field: { ...username, requiredUnless: { field: 'local', equals: 'yes' } }, values: { auth: 'basic', local: 'yes' } })).toBe(false);
    expect(providerSettingsErrors({ settings: [{ name: 'username', label: 'Username', ...username }] })).toEqual([]);
  });
  it('rejects malformed conditions rather than silently ignoring a requirement', () => {
    for (const requiredWhen of [null, [], 'auth', {}, { field: '9bad', in: ['basic'] }, { field: 'auth', in: [] }, { field: 'auth', in: [''] }, { field: 'auth', in: [true] }]) {
      expect(providerSettingsErrors({ settings: [{ name: 'username', label: 'Username', requiredWhen }] })).toEqual(["provider setting 'username' has a malformed requiredWhen"]);
    }
  });
});


it('a declared alternative credential can satisfy a requirement, including a presence-only saved view', () => {
  const token = { ...field, requiredUnless: { field: 'auth', equals: 'none', orPresent: 'headers' } };
  expect(providerSettingsErrors({ settings: [token] })).toEqual([]);
  for (const headers of ['', '  ', undefined, 123, false]) {
    expect(isProviderSettingRequired({ field: token, values: { auth: 'bearer', headers } })).toBe(true);
  }
  for (const headers of ['Authorization=Custom fixture', 'saved']) {
    expect(isProviderSettingRequired({ field: token, values: { auth: 'bearer', headers } })).toBe(false);
  }
  for (const orPresent of ['', '9bad', false, []]) {
    expect(providerSettingsErrors({ settings: [{ ...token, requiredUnless: { ...token.requiredUnless, orPresent } }] }))
      .toEqual(["provider setting 'token' has a malformed requiredUnless"]);
  }
});
