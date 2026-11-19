import { describe, expect, test } from 'vitest';
import {
  fillNativePermissions,
  InvalidNativePermissionsError,
  projectNativePermissions,
  validateNativePermissionSnapshot,
} from '../native-permissions.js';

const capabilityKeys = ['alpha', 'beta', 'gamma'] as const;
const snapshot = () => ({ enabled: true, capabilities: { alpha: true, beta: false, gamma: true } });
const secret = 'SECRET-123';
const message = 'Invalid CLI permissions';

const invalidSnapshots: [string, Record<string, unknown>][] = [
  ['non-boolean enabled', { enabled: secret }],
  ['missing capabilities', { capabilities: undefined }],
  ['missing capability key', { capabilities: { alpha: true, beta: false } }],
  ['non-boolean capability', { capabilities: { ...snapshot().capabilities, gamma: secret } }],
  ['byAgent array', { byAgent: [] }],
  ['byAgent null', { byAgent: null }],
  ['byAgent string', { byAgent: secret }],
  ['entry array', { byAgent: { worker: [] } }],
  ['entry null', { byAgent: { worker: null } }],
  ['entry non-boolean enabled', { byAgent: { worker: { enabled: secret } } }],
  ['entry capabilities array', { byAgent: { worker: { capabilities: [] } } }],
  ['entry capabilities null', { byAgent: { worker: { capabilities: null } } }],
  ['entry unknown capability key', { byAgent: { worker: { capabilities: { [secret]: true } } } }],
  ['entry non-boolean capability', { byAgent: { worker: { capabilities: { alpha: secret } } } }],
];

describe('fillNativePermissions', () => {
  test.each([true, false])('master default %s fills every key', enabled => {
    expect(fillNativePermissions({ capabilityKeys, enabled })).toEqual({
      enabled, capabilities: { alpha: enabled, beta: enabled, gamma: enabled },
    });
  });

  test('explicit false beats a true master default', () => {
    expect(fillNativePermissions({ capabilityKeys, enabled: true, capabilities: { beta: false } })).toEqual(snapshot());
  });

  test('capabilities and nested byAgent choices are copied without shared references', () => {
    const capabilities = { alpha: true };
    const byAgent = { worker: { enabled: false, capabilities: { beta: true } }, empty: {} };
    const result = fillNativePermissions({ capabilityKeys, enabled: false, capabilities, byAgent });
    expect(result.capabilities).not.toBe(capabilities);
    expect(result.byAgent).toEqual(byAgent);
    expect(result.byAgent).not.toBe(byAgent);
    expect(result.byAgent?.worker).not.toBe(byAgent.worker);
    expect(result.byAgent?.worker?.capabilities).not.toBe(byAgent.worker.capabilities);
    expect(result.byAgent?.empty).not.toBe(byAgent.empty);
    capabilities.alpha = false;
    byAgent.worker.enabled = true;
    byAgent.worker.capabilities.beta = false;
    expect(result.capabilities).toEqual({ alpha: true, beta: false, gamma: false });
    expect(result.byAgent).toEqual({ worker: { enabled: false, capabilities: { beta: true } }, empty: {} });
  });
});

describe('validateNativePermissionSnapshot', () => {
  test.each(invalidSnapshots)('rejects %s with only the host message', (_name, invalid) => {
    const value = { ...snapshot(), sentinel: secret, ...invalid };
    const validate = () => validateNativePermissionSnapshot({ value, capabilityKeys }, { message });
    expect(validate).toThrow(InvalidNativePermissionsError);
    expect(validate).toThrow(new Error(message));
    expect(validate).not.toThrow(secret);
  });

  test('accepts an unknown top-level capability key and returns only the known keys', () => {
    const value = { ...snapshot(), capabilities: { ...snapshot().capabilities, extra: secret } };
    expect(validateNativePermissionSnapshot({ value, capabilityKeys }, { message })).toEqual(snapshot());
  });

  test('JSON agent id __proto__ is copied and projected as an ordinary own key', () => {
    const before = Object.getOwnPropertyDescriptors(Object.prototype);
    const value: unknown = JSON.parse('{"enabled":true,"capabilities":{"alpha":true,"beta":false,"gamma":true},"byAgent":{"__proto__":{"enabled":false,"capabilities":{"alpha":false}}}}');
    const settings = validateNativePermissionSnapshot({ value, capabilityKeys }, { message });
    expect(Object.keys(settings.byAgent ?? {})).toEqual(['__proto__']);
    expect(settings.byAgent?.['__proto__']).toEqual({ enabled: false, capabilities: { alpha: false } });
    const projected = projectNativePermissions({ settings, capabilityKeys, agentId: '__proto__' });
    expect(projected.enabled).toBe(false);
    expect(projected.capabilities).toEqual({ alpha: false, beta: false, gamma: true });
    expect(Object.getOwnPropertyDescriptors(Object.prototype)).toEqual(before);
  });
});

describe('projectNativePermissions', () => {
  test.each([true, false])('agent enabled %s overrides the master', enabled => {
    const settings = { ...snapshot(), enabled: !enabled, byAgent: { worker: { enabled } } };
    const result = projectNativePermissions({ settings, capabilityKeys, agentId: 'worker' });
    expect(result.enabled).toBe(enabled);
    expect(result.capabilities).toEqual(settings.capabilities);
  });

  test('agent capabilities merge over the snapshot and preserve unrelated choices', () => {
    const settings = { ...snapshot(), byAgent: { worker: { capabilities: { alpha: false, beta: true } } } };
    const result = projectNativePermissions({ settings, capabilityKeys, agentId: 'worker' });
    expect(result).toEqual({ ...settings, capabilities: { alpha: false, beta: true, gamma: true } });
    expect(settings.capabilities).toEqual(snapshot().capabilities);
  });

  test('omitting agentId leaves the settings unchanged', () => {
    const settings = { ...snapshot(), byAgent: { worker: { enabled: false, capabilities: { alpha: false } } } };
    expect(projectNativePermissions({ settings, capabilityKeys })).toEqual(settings);
  });
});
