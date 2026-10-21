import assert from 'node:assert/strict';
import { test } from 'vitest';
import {
  createObjectStoreRegistry, DEFAULT_OBJECT_STORE_PROVIDER_ID, OBJECT_STORE_CONTRACT, objectStoreProviderFault,
  type ObjectStore, type ObjectStoreProvider,
} from '../object-store.js';
import { providerOk, ProviderRegistryError } from '../provider-registry.js';

const store: ObjectStore = {
  put: async () => ({ written: true }),
  get: async () => null,
  head: async () => null,
  delete: async () => {},
};
const provider: ObjectStoreProvider = { create: () => providerOk({ value: store }) };

test('provider shape check names what is missing', () => {
  assert.equal(objectStoreProviderFault({ provider }), undefined);
  assert.equal(objectStoreProviderFault({ provider: null }), 'an object-store provider must be an object');
  assert.equal(objectStoreProviderFault({ provider: 'local' }), 'an object-store provider must be an object');
  assert.equal(objectStoreProviderFault({ provider: { create: 'x' } }), 'an object-store provider must define create()');
});

test('registry: contract name, local default, seed, and the shape check on plugin contributions', () => {
  assert.equal(OBJECT_STORE_CONTRACT, 'object_store');
  assert.equal(DEFAULT_OBJECT_STORE_PROVIDER_ID, 'local');
  const empty = createObjectStoreRegistry();
  assert.equal(empty.contract, 'object_store');
  assert.equal(empty.getDefault(), undefined, 'local is node-only and registered by the host');

  const registry = createObjectStoreRegistry({}, { seed: [{ id: 'local', provider }] });
  assert.equal(registry.getDefault()?.provider, provider);
  const created = registry.getDefault()?.provider.create({ settings: {}, host: {} });
  assert.deepEqual(created, { status: 'ok', value: store });

  assert.equal(registry.contribute({ definition: { id: 'bad', provider: {} as ObjectStoreProvider }, pluginId: 'p' }), false);
  assert.equal(registry.refusals()[0]?.code, 'invalid_provider');
  assert.equal(registry.contribute({ definition: { id: 's3_compatible', provider }, pluginId: 'p' }), true);
  assert.deepEqual(registry.list().map(e => e.id), ['local', 's3_compatible']);
  assert.throws(() => registry.register({ definition: { id: 'local', provider } }), ProviderRegistryError);
});
