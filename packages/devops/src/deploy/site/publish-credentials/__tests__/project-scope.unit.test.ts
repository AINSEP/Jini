import assert from 'node:assert/strict';
import { test } from 'vitest';
import { updatePublishCredential, type PublishCredentialWriteDeps } from '../store.js';

test('project replacement refuses outside the owner card before any vault write', async () => {
  let writes = 0;
  const ownerRepo = { findById: async () => ({ id: 'key', vendorId: 'vendor' }),
    vault: { find: async () => { writes++; throw new Error('unapproved vault access'); } } };
  const deps = { repo: { findById: async () => null, project: { workspaceId: 'project', repo: ownerRepo, createRepo: ownerRepo, replaceRepo: ownerRepo } },
    credentialScopes: ({ deps, workspaceId }: { deps: PublishCredentialWriteDeps; workspaceId: string }) => [
      { deps, workspaceId, scope: 'site' }, { deps: { ...deps, repo: ownerRepo }, workspaceId: 'project', scope: 'project' }],
    loadDeployTargets: async () => ({ list: () => [{ descriptor: { id: 'host', credential: { vendorId: 'vendor' } } }] }),
  } as unknown as PublishCredentialWriteDeps;
  await assert.rejects(updatePublishCredential(deps, { workspaceId: 'site', id: 'key', connection: { providerId: 'host', token: 'new' } }), /P25_OWNER_KEY_READ_ONLY/);
  assert.equal(writes, 0);
});
