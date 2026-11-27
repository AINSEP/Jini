import assert from 'node:assert/strict';
import { test } from 'vitest';
import { bindPublishCompatibility, type PublishCompatibilitySource } from '../compatibility-port.js';

const registry = { get: () => undefined, list: () => [], refusals: [] };

test('binding reads nothing and preparation loads the registry only when a cache is present', async () => {
  const reads: string[] = []; let loads = 0;
  const source: PublishCompatibilitySource = { get loadDeployTargets() { reads.push('registry'); return async () => { loads++; return registry; }; },
    get publishCredentialVerificationCache() { reads.push('cache'); return undefined; } };
  const port = bindPublishCompatibility({ source, invalidatePublishCredentialCompatibility: () => assert.fail('no cache') });
  assert.deepEqual(reads, []);
  await port.prepareInvalidation({ workspaceId: 'ws' }); assert.equal(loads, 0);
  const cached = bindPublishCompatibility({ source: { ...source, publishCredentialVerificationCache: { delete: () => {} } }, invalidatePublishCredentialCompatibility: () => {} });
  await cached.prepareInvalidation({ workspaceId: 'ws' }); assert.equal(loads, 1);
});

test('a prepared invalidation uses the original registry and the live cache, if still installed', async () => {
  type BindInput = Parameters<typeof bindPublishCompatibility>[0];
  type Cache = NonNullable<PublishCompatibilitySource['publishCredentialVerificationCache']>;
  const original: Cache = { delete: () => assert.fail('old cache was replaced') };
  const deleted: Array<{ workspaceId: string; target: string }> = [];
  let live: Cache | undefined = original;
  const requests: unknown[] = [];
  const after: Parameters<BindInput['invalidatePublishCredentialCompatibility']>[0]['after'] = {
    id: 'new-key', label: 'Docs key', category: 'api', baseUrl: 'https://docs.example.test', additionalHosts: [],
    credentialType: 'custom', worksFor: ['host'], configured: true, createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z',
  };
  const port = bindPublishCompatibility({
    source: {
      loadDeployTargets: async input => { requests.push(input); return registry; },
      get publishCredentialVerificationCache() { return live; },
    },
    invalidatePublishCredentialCompatibility: input => {
      assert.equal(input.registry, registry);
      assert.equal(input.after, after);
      input.cache.delete({ workspaceId: input.workspaceId, target: 'host' });
    },
  });
  const commit = await port.prepareInvalidation({ workspaceId: 'site-a' });
  live = undefined;
  commit({ after });
  live = { delete: input => { deleted.push(input); } };
  commit({ after });
  assert.deepEqual(requests, [{ workspaceId: 'site-a' }]);
  assert.deepEqual(deleted, [{ workspaceId: 'site-a', target: 'host' }]);
});
