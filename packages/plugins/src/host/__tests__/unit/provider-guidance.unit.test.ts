import { expect, it } from 'vitest';
import { createPluginContributionRegistry } from '../../contributions.js';
import { createPluginProviderHost, PluginProviderStartupError, pluginProviderStartupGuidance } from '../../provider-host.js';

it('returns explicit startup guidance from both the local error and a separately bundled Error class', () => {
  const cause = new Error('underlying SDK detail');
  const local = new PluginProviderStartupError({ reason: 'missing key', action: 'configure a credential', cause });
  expect(local.cause).toBe(cause);
  expect(pluginProviderStartupGuidance({ error: local })).toEqual({ reason: 'missing key', action: 'configure a credential' });
  const bundled = Object.assign(new Error('missing permission'), {
    name: 'PluginProviderStartupError', reason: 'missing permission', action: 'grant access',
  });
  expect(pluginProviderStartupGuidance({ error: bundled })).toEqual({ reason: 'missing permission', action: 'grant access' });
});

it.each([
  null, 'raw SDK detail', new Error('SDK detail'),
  { name: 'PluginProviderStartupError', reason: 'fake', action: 'fake' },
  Object.assign(new Error('detail'), { name: 'PluginProviderStartupError', reason: 1, action: 'configure' }),
  Object.assign(new Error('detail'), { name: 'PluginProviderStartupError', reason: 'configure', action: null }),
])('does not surface raw errors or malformed guidance: %j', error => {
  expect(pluginProviderStartupGuidance({ error })).toBeUndefined();
});

it.each([0, -1, NaN, Infinity, 1.5])('rejects an invalid provider disposal timeout %j', disposeTimeoutMs => {
  expect(() => createPluginProviderHost({ contributions: createPluginContributionRegistry({}), contracts: [] }, { disposeTimeoutMs }))
    .toThrow('invalid provider disposal timeout');
});

it('rejects duplicate contracts before creating a live provider host', () => {
  const contract = { contract: 'fixture', validate: () => undefined };
  expect(() => createPluginProviderHost({ contributions: createPluginContributionRegistry({}), contracts: [contract, contract] }))
    .toThrow('duplicate provider contract');
});
