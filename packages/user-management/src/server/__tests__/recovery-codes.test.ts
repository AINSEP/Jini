import assert from 'node:assert/strict';
import { test } from 'vitest';
import type { AuthServiceDeps } from '../auth-service.js';
import { createSessionForPrincipal, login } from '../auth-service.js';
import { seedIdentity } from '../seed.js';
import { NodeSessionTokens } from '../session-tokens.js';
import { createTransactionalInMemoryIdentityRepos } from '../repo.memory-transactions.js';
import * as memory from '../repo.memory.js';
import { issueRecoveryCodes, recoverOwner, resetOwnerPassword, type RecoveryCodeStore, resolveOwnerResetTarget } from '../recovery-codes.js';

/** Real identity transitions, with deterministic clock/hash seams and a rollback-capable kit store. */
async function fixture() {
  const repos = createTransactionalInMemoryIdentityRepos({ repos: {
    principals: new memory.InMemoryPrincipalRepo({}), users: new memory.InMemoryUserRepo({}),
    sessions: new memory.InMemorySessionRepo({}), roles: new memory.InMemoryRoleRepo({}),
    policies: new memory.InMemoryPolicyRepo({}), policyPermissions: new memory.InMemoryPolicyPermissionRepo({}),
    rolePolicies: new memory.InMemoryRolePolicyRepo({}), principalRoles: new memory.InMemoryPrincipalRoleRepo({}),
    principalPolicies: new memory.InMemoryPrincipalPolicyRepo({}),
  } });
  let id = 0;
  let failVerification = false;
  const auth: AuthServiceDeps = { repos, tokens: new NodeSessionTokens({}),
    idGen: { newId: () => `id-${++id}` }, clock: { nowMs: () => 1_800_000_000_000 },
    hasher: { hash: async ({ password }) => `hashed:${password}`,
      verify: async ({ hash, password }) => !failVerification && hash === `hashed:${password}` },
  };
  let stored: Record<string, string[]> = {};
  const key = (scope: { workspaceId: string; principalId: string }) => JSON.stringify([scope.workspaceId, scope.principalId]);
  const codes: RecoveryCodeStore = {
    replace: async scope => { stored[key(scope)] = [...scope.hashes]; },
    contains: async scope => (stored[key(scope)] ?? []).includes(scope.hash),
    clear: async scope => { delete stored[key(scope)]; },
  };
  const transactions = repos.transactions;
  repos.transactions = { run: input => transactions.run({ ...input, execute: async () => {
    const snapshot = structuredClone(stored);
    try { return await input.execute(); } catch (error) { stored = snapshot; throw error; }
  } }) };
  const { ownerPrincipalId } = await seedIdentity({ deps: auth,
    input: { workspaceId: 'a', ownerUsername: 'renamed-owner', ownerPassword: 'old' } });
  const deps = { auth, codes, seededOwnerPrincipalId: ownerPrincipalId };
  const scope = { workspaceId: 'a', principalId: ownerPrincipalId };
  return { auth, deps, scope, stored: () => structuredClone(stored),
    failVerification: () => { failVerification = true; } };
}

test('issues exactly ten distinct 256-bit codes and stores only scoped hashes; rotation invalidates the old kit', async () => {
  const f = await fixture();
  const kit = await issueRecoveryCodes({ deps: f.deps, input: { ...f.scope, password: 'old' } }, {});
  assert.equal(kit.codes.length, 10);
  assert.equal(new Set(kit.codes).size, 10);
  for (const code of kit.codes) {
    assert.match(code, /^[a-f0-9]{64}$/);
    assert.ok(!JSON.stringify(f.stored()).includes(code));
  }
  await issueRecoveryCodes({ deps: f.deps, input: { ...f.scope, password: 'old' } }, {});
  await assert.rejects(recoverOwner({ deps: f.deps, input: { ...f.scope, code: kit.codes[0]!, password: 'new' } }, {}));
});

test('two simultaneous redemptions have one winner, revoke sessions, and invalidate every remaining code', async () => {
  const f = await fixture();
  const session = await createSessionForPrincipal({ deps: f.auth, input: f.scope });
  const kit = await issueRecoveryCodes({ deps: f.deps, input: { ...f.scope, password: 'old' } }, {});
  const outcomes = await Promise.allSettled([kit.codes[0]!, kit.codes[1]!].map(code =>
    recoverOwner({ deps: f.deps, input: { ...f.scope, code, password: 'new' } }, {})));
  assert.equal(outcomes.filter(result => result.status === 'fulfilled').length, 1);
  assert.deepEqual(f.stored(), {});
  assert.ok((await f.auth.repos.sessions.findById({ workspaceId: 'a', id: session.session.id }))?.revokedAt);
  await login({ deps: f.auth, input: { workspaceId: 'a', username: 'renamed-owner', password: 'new' } });
  await assert.rejects(login({ deps: f.auth, input: { workspaceId: 'a', username: 'renamed-owner', password: 'old' } }));
});

test('failed read-back verification rolls back password, kit deletion, and session revocation', async () => {
  const f = await fixture();
  const session = await createSessionForPrincipal({ deps: f.auth, input: f.scope });
  const kit = await issueRecoveryCodes({ deps: f.deps, input: { ...f.scope, password: 'old' } }, {});
  const stored = f.stored();
  f.failVerification();
  await assert.rejects(recoverOwner({ deps: f.deps, input: { ...f.scope, code: kit.codes[0]!, password: 'new' } }, {}));
  assert.deepEqual(f.stored(), stored);
  assert.equal((await f.auth.repos.users.findByPrincipalId(f.scope))?.passwordHash, 'hashed:old');
  assert.equal((await f.auth.repos.sessions.findById({ workspaceId: 'a', id: session.session.id }))?.revokedAt, undefined);
});

test('a code cannot recover another workspace or another owner', async () => {
  const f = await fixture();
  const kit = await issueRecoveryCodes({ deps: f.deps, input: { ...f.scope, password: 'old' } }, {});
  const other = await seedIdentity({ deps: f.auth, input: { workspaceId: 'b', ownerUsername: 'other', ownerPassword: 'other' } });
  await assert.rejects(recoverOwner({ deps: f.deps, input: {
    workspaceId: 'b', principalId: other.ownerPrincipalId, code: kit.codes[0]!, password: 'new',
  } }, {}));
  assert.equal((await f.auth.repos.users.findByPrincipalId({ workspaceId: 'b', principalId: other.ownerPrincipalId }))?.passwordHash, 'hashed:other');
});

test('kit issuance requires the current password; direct owner reset refuses staff without promoting them', async () => {
  const f = await fixture();
  await assert.rejects(issueRecoveryCodes({ deps: f.deps, input: { ...f.scope, password: 'wrong' } }, {}));
  await f.auth.repos.principals.save({ id: 'staff', workspaceId: 'a', kind: 'user', displayName: 'Staff', status: 'active', createdAt: '2026-01-01T00:00:00Z' });
  await assert.rejects(resetOwnerPassword({ deps: f.deps, input: { workspaceId: 'a', principalId: 'staff', password: 'new' } }, {}));
  assert.deepEqual(await f.auth.repos.principalRoles.listByPrincipalId({ workspaceId: 'a', principalId: 'staff' }), []);
});

test('host reset resolves a renamed owner by identity and refuses an explicit staff username', async () => {
  const f = await fixture();
  assert.equal((await resolveOwnerResetTarget({ deps: f.deps, input: f.scope }, {})).username, 'renamed-owner');
  await assert.rejects(resolveOwnerResetTarget({ deps: f.deps, input: { ...f.scope, username: 'staff' } }, {}));
});


test('kit issuance verifies an existing credential even when it exceeds the new-password policy', async () => {
  const f = await fixture();
  const password = 'p'.repeat(513);
  const owner = (await f.auth.repos.users.findByPrincipalId(f.scope))!;
  await f.auth.repos.users.save({ ...owner, passwordHash: `hashed:${password}` });
  assert.equal((await issueRecoveryCodes({ deps: f.deps, input: { ...f.scope, password } }, {})).codes.length, 10);
});
