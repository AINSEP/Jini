// Moved from the host composition tests with the code under test; assertions unchanged.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { JsonValue } from '@jini-ai/core/primitives';
import { InMemorySettingsRepo, ValueValidationFailedError, resolveDefinitionRaw, set } from '@jini-ai/core/settings';
import { ensureCommerceSetting, readCommerceConfiguration } from '../../commerce-settings.js';

async function fixture() {
  const settingsRepo = new InMemorySettingsRepo();
  let id = 0;
  const deps = { settingsRepo, clock: { nowMs: () => 1_800_000_000_000 }, ids: { newId: () => `setting-${++id}` }, principals: { findActiveById: async () => null } };
  await ensureCommerceSetting({ deps, systemPrincipalId: 'commerce-boot' });
  const write = async (workspaceId: string, value: JsonValue) => set({ deps: { ...deps, repo: settingsRepo,
    authorize: async () => ({ allowed: true, reason: 'test-owner' }) }, input: { namespace: 'core.commerce', key: 'configuration',
    scope: 'workspace', workspaceId, value, callerPrincipalId: 'test-owner' } });
  return { settingsRepo, deps, write };
}
const config = { providerId: 'payments-example', accountId: 'merchant', mode: 'test', publicOrigin: 'https://shop.example' };

test('commerce-off registers one public selection without creating a default merchant account', async () => {
  const { settingsRepo, deps } = await fixture();
  await ensureCommerceSetting({ deps, systemPrincipalId: 'commerce-boot' });
  const definition = await resolveDefinitionRaw({ repo: settingsRepo }, { namespace: 'core.commerce', key: 'configuration', workspaceId: null });
  assert.ok(definition); assert.equal(definition.secret, false); assert.deepEqual(definition.defaultValue, {});
  assert.equal(await readCommerceConfiguration({ settingsRepo, workspaceId: 'one' }), null);
});

test('configured merchant scope remains isolated to its owning workspace', async () => {
  const { settingsRepo, write } = await fixture(); await write('one', config);
  assert.deepEqual(await readCommerceConfiguration({ settingsRepo, workspaceId: 'one' }), config);
  assert.equal(await readCommerceConfiguration({ settingsRepo, workspaceId: 'two' }), null);
});

test('incomplete or malformed merchant selection fails closed', async () => {
  const { settingsRepo, write } = await fixture();
  await assert.rejects(write('one', null), ValueValidationFailedError);
  for (const value of [[], 'text', {}, { ...config, providerId: '../stripe' }, { ...config, accountId: '' }, { ...config, mode: 'sandbox' }, { ...config, publicOrigin: '' }]) {
    await write('one', value);
    assert.equal(await readCommerceConfiguration({ settingsRepo, workspaceId: 'one' }), null);
  }
});
