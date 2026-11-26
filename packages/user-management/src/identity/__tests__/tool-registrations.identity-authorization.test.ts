import { buildIdentityRegistrations, identityDerivedRisk } from "../../server/agent-tool-registrations.js";
import { createUsernameChangePort } from "../username-change-ports.js";
import assert from 'node:assert/strict';
import { test } from 'vitest';
import { assertVersionedWrite } from '@jini-ai/core/optimistic-concurrency';
import type { ToolExecutionContext } from '@jini-ai/core';
import { IdentityForbiddenError, type IdentityRepos } from '../../core/index.js';
import { InMemoryPrincipalRepo, InMemoryUserRepo, InMemorySessionRepo, InMemoryRoleRepo, InMemoryPolicyRepo,
  InMemoryPolicyPermissionRepo, InMemoryRolePolicyRepo, InMemoryPrincipalRoleRepo, InMemoryPrincipalPolicyRepo,
  createTransactionalInMemoryIdentityRepos, seedIdentity, assertCallerHasAnyPermission, normalizeUsername, parseIdentityToolInput } from '../../server/index.js';
import { SelfDeleteError, assertUserAccountAction } from '../delete-user-service.js';
import { buildGatedIdentityRegistrations, withoutPassword, type IdentityToolDeps } from '../tool-registrations.js';

async function fixture(afterApproval: (repos: IdentityRepos, owner: string) => Promise<void> = async () => {}) {
  const repos = createTransactionalInMemoryIdentityRepos({ repos: {
    principals: new InMemoryPrincipalRepo({}), users: new InMemoryUserRepo({ assertVersionedWrite }), sessions: new InMemorySessionRepo({}),
    roles: new InMemoryRoleRepo({ assertVersionedWrite }), policies: new InMemoryPolicyRepo({ assertVersionedWrite }),
    policyPermissions: new InMemoryPolicyPermissionRepo({}), rolePolicies: new InMemoryRolePolicyRepo({}),
    principalRoles: new InMemoryPrincipalRoleRepo({}), principalPolicies: new InMemoryPrincipalPolicyRepo({}),
  } });
  let nextId = 0;
  const clock = { nowMs: () => 0 }; const idGen = { newId: () => `id-${++nextId}` };
  const hasher = { hash: async () => 'hash', verify: async () => true };
  const { ownerPrincipalId } = await seedIdentity({ deps: { repos, clock, idGen, hasher }, input: { workspaceId: 'ws', ownerUsername: 'owner', ownerPassword: 'owner-password' } });
  const deps = { buildIdentityRegistrations, identityDerivedRisk, normalizeUsername, parseIdentityToolInput, createUsernameChangePort, SelfDeleteError, workspaceId: 'ws', clock, idGen, passwordHasher: hasher, ownerPrincipalId: Promise.resolve(ownerPrincipalId),
    transactions: repos.transactions, principalRepo: repos.principals, userRepo: repos.users, sessionRepo: repos.sessions,
    roleRepo: repos.roles, policyRepo: repos.policies, policyPermissionRepo: repos.policyPermissions,
    rolePolicyRepo: repos.rolePolicies, principalRoleRepo: repos.principalRoles, principalPolicyRepo: repos.principalPolicies,
    assertCallerHasAnyPermission, assertUserAccountAction, outbox: {}, isInTrash: async () => false,
    approvalToolHandler: (steps: { prepare(input: { ctx: ToolExecutionContext }, optional: {}): Promise<unknown>; run(input: { ctx: ToolExecutionContext; prepared: unknown; confirmer: { id: string; kind: 'user' } }, optional: {}): Promise<unknown> }) => async (ctx: ToolExecutionContext) => {
      const prepared = await steps.prepare({ ctx }, {}); await afterApproval(repos, ownerPrincipalId);
      return steps.run({ ctx, prepared, confirmer: { id: ownerPrincipalId, kind: 'user' } }, {});
    },
  } as unknown as IdentityToolDeps;
  return { repos, ownerPrincipalId, tools: buildGatedIdentityRegistrations(deps, {} as never) };
}
const ctx = (principalId: string, input: unknown): ToolExecutionContext => ({ executionId: 'exec', principal: { id: principalId }, run: { id: 'run' }, input, signal: new AbortController().signal });

test('a non-owner cannot enable the protected owner account', async () => {
  const f = await fixture();
  await f.repos.principals.save({ id: 'caller', workspaceId: 'ws', kind: 'user', displayName: 'Caller', status: 'active', createdAt: 'now' });
  const tool = f.tools.find(item => item.descriptor.id === 'identity_user_enable')!;
  await assert.rejects(tool.handler(ctx('caller', { principalId: f.ownerPrincipalId })), /OWNER_REQUIRED/);
  assert.equal((await f.repos.principals.findById({ workspaceId: 'ws', id: f.ownerPrincipalId }))?.status, 'active');
});

test('the real service rechecks authority lost during human approval', async () => {
  const f = await fixture(async (repos, owner) => {
    const principal = await repos.principals.findById({ workspaceId: 'ws', id: owner }); assert.ok(principal);
    await repos.principals.save({ ...principal, status: 'disabled' });
  });
  const role = { id: 'role', workspaceId: 'ws', name: 'Temporary', isBuiltin: false, version: 1 };
  await f.repos.roles.save(role);
  const tool = f.tools.find(item => item.descriptor.id === 'identity_role_delete')!;
  await assert.rejects(tool.handler(ctx(f.ownerPrincipalId, { roleId: 'role' })), IdentityForbiddenError);
  assert.deepEqual(await f.repos.roles.findById({ workspaceId: 'ws', id: 'role' }), role);
});

test('user create model schema exposes no password field or requirement', () => {
  assert.deepEqual(withoutPassword({ schema: { type: 'object', properties: { username: { type: 'string' }, password: { type: 'string' } }, required: ['username', 'password'] } }),
    { type: 'object', properties: { username: { type: 'string' } }, required: ['username'] });
});
