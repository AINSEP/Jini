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
