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
