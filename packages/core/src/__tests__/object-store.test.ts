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

test('deferObjectStore loads once on first use, forwards every call, and retries a failed load', async () => {
  const { deferObjectStore } = await import('../object-store.js');
  const calls: string[] = [];
  const real: ObjectStore = {
    put: async ({ key }, options) => { calls.push(`put:${key}:${String(options?.ifAbsent)}`); return { written: true }; },
    get: async ({ key }) => { calls.push(`get:${key}`); return new Uint8Array([1]); },
    head: async ({ key }) => { calls.push(`head:${key}`); return { size: 1 }; },
    delete: async ({ key }) => { calls.push(`delete:${key}`); },
  };
  let loads = 0;
  const deferred = deferObjectStore({ load: async () => { loads += 1; if (loads === 1) throw new Error('plugin not ready'); return real; } });
  assert.equal(loads, 0, 'nothing loads until first use');
  await assert.rejects(deferred.get({ key: 'a' }), /plugin not ready/);
  assert.deepEqual(await deferred.put({ key: 'a', bytes: new Uint8Array() }, { ifAbsent: true }), { written: true });
  assert.deepEqual(await deferred.get({ key: 'a' }), new Uint8Array([1]));
  assert.deepEqual(await deferred.head({ key: 'a' }), { size: 1 });
  await deferred.delete({ key: 'a' });
  assert.equal(loads, 2, 'the failed load was retried once, then kept');
  assert.deepEqual(calls, ['put:a:true', 'get:a', 'head:a', 'delete:a']);
  assert.equal(deferred.publicAccess, undefined);
});
