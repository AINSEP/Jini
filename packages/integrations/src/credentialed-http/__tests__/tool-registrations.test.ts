import assert from 'node:assert/strict';
import { test } from 'vitest';
import { loadCreateCredentialProviders } from '../tools/index.js';

test('create provider catalogs fall back independently when hosting is unavailable', async () => {
  const providers = await loadCreateCredentialProviders({ routeDeps: { workspaceId: 'ws',
    loadDeployTargets: async () => { throw new Error('unavailable'); },
    loadSourceControlProviders: async () => ({ list: () => [{ descriptor: { id: 'source' } }] }),
  } });
  assert.deepEqual(providers, [{ id: 'source', vendorId: 'source' }]);
  assert.deepEqual(await loadCreateCredentialProviders({ routeDeps: { workspaceId: 'ws',
    loadSourceControlProviders: async () => { throw new Error('unavailable'); },
  } }), []);
});

test('create provider catalogs offer only hosting targets that declare a credential vendor', async () => {
  const providers = await loadCreateCredentialProviders({ routeDeps: { workspaceId: 'ws',
    loadDeployTargets: async () => ({ list: () => [{ descriptor: { id: 'static-host', credential: { vendorId: 'vendor-a' } } }, { descriptor: { id: 'no-key-host' } }] }),
    loadSourceControlProviders: async () => ({ list: () => [] }),
  } });
  assert.deepEqual(providers, [{ id: 'static-host', vendorId: 'vendor-a' }]);
});
