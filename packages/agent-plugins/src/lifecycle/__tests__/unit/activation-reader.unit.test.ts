import { expect, test, vi } from 'vitest';
import { createVersionedPluginActivationReader } from '../../activation-reader.js';

test('unchanged activation metadata uses a point cache; a new revision observes OFF immediately', async () => {
  let revision = 'first';
  let enabled = true;
  const resolve = vi.fn(async () => enabled);
  const reader = createVersionedPluginActivationReader({ ports: { revision: async () => revision, resolve } });
  expect(await reader.isEnabled({ pluginId: 'media' })).toBe(true);
  expect(await reader.isEnabled({ pluginId: 'media' })).toBe(true);
  expect(resolve).toHaveBeenCalledTimes(1);
  revision = 'second'; enabled = false;
  expect(await reader.isEnabled({ pluginId: 'media' })).toBe(false);
  expect(resolve).toHaveBeenCalledTimes(2);
  reader.clear({});
  await reader.isEnabled({ pluginId: 'media' });
  expect(resolve).toHaveBeenCalledTimes(3);
});

test('a revision changing during a read or an unreadable revision cannot grant cached access', async () => {
  let revision = 'first';
  const reader = createVersionedPluginActivationReader({ ports: {
    revision: async () => revision,
    resolve: async () => { revision = 'second'; return true; },
  } });
  expect(await reader.isEnabled({ pluginId: 'media' })).toBe(false);
  const broken = createVersionedPluginActivationReader({ ports: { revision: async () => { throw new Error('stat failed'); }, resolve: async () => true } });
  await expect(broken.isEnabled({ pluginId: 'media' })).rejects.toThrow('stat failed');
});
