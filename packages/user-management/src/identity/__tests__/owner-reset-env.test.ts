import * as identity from '../../server/index.js';
import assert from 'node:assert/strict';
import { test } from 'vitest';
import { applyOwnerPasswordReset } from '../owner-reset-env.js';
import type { OwnerRecoveryDeps } from '../../server/recovery-codes.js';

test('host fallback resolves the renamed owner and skips a password already satisfied', async () => {
  let reads = 0;
  const owner = { principalId: 'owner', workspaceId: 'w', username: 'renamed-owner', passwordHash: 'stored' };
  const deps = { seededOwnerPrincipalId: 'owner', codes: {}, auth: { repos: {
    principals: { findById: async () => ({ id: 'owner', kind: 'user', status: 'active' }) },
    users: { findByPrincipalId: async () => { reads++; return owner; }, findByUsername: async () => { throw new Error('must not assume admin'); } },
  }, hasher: { verify: async () => true } } } as unknown as OwnerRecoveryDeps;
  assert.equal(await applyOwnerPasswordReset({ deps, workspaceId: 'w', password: 'already-stored' }, {}), 'renamed-owner');
  assert.equal(reads, 1);
});


/** Deterministic ports exercise the real Jini transition and the host's pre-write hook. */
async function resetFixture() {
  const repos = identity.createTransactionalInMemoryIdentityRepos({ repos: {
    principals: new identity.InMemoryPrincipalRepo({}), users: new identity.InMemoryUserRepo({}),
    sessions: new identity.InMemorySessionRepo({}), roles: new identity.InMemoryRoleRepo({}),
    policies: new identity.InMemoryPolicyRepo({}), policyPermissions: new identity.InMemoryPolicyPermissionRepo({}),
    rolePolicies: new identity.InMemoryRolePolicyRepo({}), principalRoles: new identity.InMemoryPrincipalRoleRepo({}),
    principalPolicies: new identity.InMemoryPrincipalPolicyRepo({}),
  } });
  let id = 0;
  const auth = { repos, tokens: { newToken: () => 'f'.repeat(64), hashToken: ({ rawToken }: { rawToken: string }) => `digest:${rawToken}` }, clock: { nowMs: () => 1800000000000 },
    idGen: { newId: () => `id-${++id}` }, hasher: { hash: async ({ password }: { password: string }) => `hash:${password}`,
      verify: async ({ hash, password }: { hash: string; password: string }) => hash === `hash:${password}` } };
  const { ownerPrincipalId } = await identity.seedIdentity({ deps: auth, input: { workspaceId: 'w', ownerUsername: 'owner', ownerPassword: 'old' } });
  const deps = { auth, seededOwnerPrincipalId: ownerPrincipalId, codes: { clear: async () => {}, replace: async () => {}, contains: async () => false } };
  return { deps, scope: { workspaceId: 'w', principalId: ownerPrincipalId } };
}

test('host reset captures the old database before a write, once, and skips a satisfied secret', async () => {
  const f = await resetFixture();
  const snapshots: string[] = [];
  const beforeReset = async () => { snapshots.push((await f.deps.auth.repos.users.findByPrincipalId(f.scope))!.passwordHash); };
  await applyOwnerPasswordReset({ deps: f.deps, workspaceId: 'w', password: 'new' }, { beforeReset });
  assert.deepEqual(snapshots, ['hash:old']);
  assert.equal((await f.deps.auth.repos.users.findByPrincipalId(f.scope))!.passwordHash, 'hash:new');
  await applyOwnerPasswordReset({ deps: f.deps, workspaceId: 'w', password: 'new' }, { beforeReset });
  assert.equal(snapshots.length, 1);
});

test('a failed pre-write backup prevents any password change', async () => {
  const f = await resetFixture();
  await assert.rejects(applyOwnerPasswordReset({ deps: f.deps, workspaceId: 'w', password: 'new' }, {
    beforeReset: async () => { throw new Error('backup disk full'); },
  }), /backup disk full/);
  assert.equal((await f.deps.auth.repos.users.findByPrincipalId(f.scope))!.passwordHash, 'hash:old');
});
