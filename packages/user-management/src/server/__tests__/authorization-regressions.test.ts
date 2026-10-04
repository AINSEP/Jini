import assert from 'node:assert/strict';
import { test } from 'vitest';
import type { IdentityRepos } from '../../core/ports.js';
import { isKnownPermission, listPermissions, registerPermission } from '../../core/permissions.js';
import { IdentityValidationError, IdentityNotFoundError, IdentityTransactionRequiredError, OwnerRequiredError } from '../../core/types.js';
import type { AuthServiceDeps } from '../auth-service.js';
import { authorize } from '../authorize.js';
import { disablePrincipal, enablePrincipal, updateUser, resetUserPassword, deleteRole, deletePolicy } from '../admin-crud-service.js';
import { assignRole, attachPolicy } from '../grant-service.js';
import { parseIdentityToolInput } from '../agent-tool-input.js';
import { migrateDeprecatedPermissionGrants, registerPermissionMigration } from '../permission-migrations.js';
import { seedIdentity } from '../seed.js';
import { createTransactionalInMemoryIdentityRepos } from '../repo.memory-transactions.js';
import {
  InMemoryPrincipalRepo, InMemoryUserRepo, InMemorySessionRepo, InMemoryRoleRepo,
  InMemoryPolicyRepo, InMemoryPolicyPermissionRepo, InMemoryRolePolicyRepo,
  InMemoryPrincipalRoleRepo, InMemoryPrincipalPolicyRepo,
} from '../repo.memory.js';

const workspaceId = 'authorization-regression';
function rawRepos(): Omit<IdentityRepos, "transactions"> {
  return {
    principals: new InMemoryPrincipalRepo({}), users: new InMemoryUserRepo({}),
    sessions: new InMemorySessionRepo({}), roles: new InMemoryRoleRepo({}),
    policies: new InMemoryPolicyRepo({}), policyPermissions: new InMemoryPolicyPermissionRepo({}),
    rolePolicies: new InMemoryRolePolicyRepo({}), principalRoles: new InMemoryPrincipalRoleRepo({}),
    principalPolicies: new InMemoryPrincipalPolicyRepo({}),
  };
}
function fixture() {
  const repos = createTransactionalInMemoryIdentityRepos({ repos: rawRepos() });
  let id = 0;
  const deps: AuthServiceDeps = {
    repos, clock: { nowMs: () => Date.parse('2026-10-02T00:00:00.000Z')}, idGen: { newId: () => `regression-${++id}` },
    hasher: { hash: async () => 'test-hash', verify: async () => true },
    tokens: { newToken: () => 'test-token', hashToken: () => 'test-digest' },
  };
  return { repos, deps };
}
async function principal(repos: IdentityRepos, id: string) {
  await repos.principals.save({ id, workspaceId, kind: 'user', displayName: id, status: 'active', createdAt: '2026-10-02T00:00:00.000Z' });
}
async function ownerGrant(repos: IdentityRepos, id: string) {
  await principal(repos, id);
  await repos.policies.save({ id: `policy-${id}`, workspaceId, name: id, isBuiltin: false, isFrozen: false });
  await repos.policyPermissions.save({ id: `grant-${id}`, workspaceId, policyId: `policy-${id}`, permission: '*', resourceType: null, constraintJson: null });
  await repos.principalPolicies.save({ id: `binding-${id}`, workspaceId, principalId: id, policyId: `policy-${id}` });
}

// Finding 1: the reserved wildcard must never enter the custom catalog.
test('wildcard registration throws a typed error and leaves the catalog unchanged', () => {
  const before = listPermissions({});
  assert.throws(() => registerPermission({ id: '*', owner: 'extension', description: 'reserved' }), IdentityValidationError);
  assert.equal(isKnownPermission({ id: '*' }), false);
  assert.deepEqual(listPermissions({}), before);
});

// Finding 2: guard reads and the mutation must share an isolation boundary.
test('concurrent disables preserve an active owner across asynchronous repository calls', async () => {
  const { repos, deps } = fixture();
  await ownerGrant(repos, 'owner-a');
  await ownerGrant(repos, 'owner-b');
  // Only owners may modify owner accounts; each active owner acts on itself so the second call
  // still passes caller authorization and must exercise the active-owner floor after the first.
  const outcomes = await Promise.allSettled(['owner-a', 'owner-b'].map(principalId => disablePrincipal({ deps, input: { workspaceId, callerPrincipalId: principalId, principalId, seededOwnerPrincipalId: 'seeded-elsewhere' } })));
  assert.equal(outcomes.filter(result => result.status === 'fulfilled').length, 1);
  const refusal = outcomes.find(result => result.status === 'rejected');
  assert.ok(refusal?.status === 'rejected' && refusal.reason instanceof OwnerRequiredError);
  assert.equal(refusal.reason.message, 'the workspace must keep at least one active owner-`*` principal');
  assert.equal((await repos.principals.list({ workspaceId })).filter(row => row.id.startsWith('owner-') && row.status === 'active').length, 1);
});

test('role deletion and concurrent assignment cannot leave a dangling assignment', async () => {
  const { repos, deps } = fixture();
  await ownerGrant(repos, 'caller');
  await principal(repos, 'target');
  await repos.roles.save({ id: 'role', workspaceId, name: 'custom', isBuiltin: false });
  const outcomes = await Promise.allSettled([
    deleteRole({ deps, input: { workspaceId, callerPrincipalId: 'caller', roleId: 'role' } }),
    assignRole({ deps, input: { workspaceId, callerPrincipalId: 'caller', principalId: 'target', roleId: 'role' } }),
  ]);
  assert.equal(outcomes.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(await repos.roles.findById({ workspaceId, id: 'role' }), null);
  assert.deepEqual(await repos.principalRoles.listByRoleId({ workspaceId, roleId: 'role' }), []);
});

test('protected mutations fail closed when a transaction port is missing', async () => {
  const { repos, deps } = fixture();
  await ownerGrant(repos, 'caller');
  const withoutTransaction = { ...deps, repos: { ...repos, transactions: undefined } };
  // @ts-expect-error Deliberate JavaScript caller with the required transaction omitted.
  await assert.rejects(disablePrincipal({ deps: withoutTransaction, input: { workspaceId, callerPrincipalId: 'caller', principalId: 'caller', seededOwnerPrincipalId: 'other' } }), IdentityTransactionRequiredError);
  // @ts-expect-error Deliberate JavaScript caller with the required transaction omitted.
  await assert.rejects(deleteRole({ deps: withoutTransaction, input: { workspaceId, callerPrincipalId: 'caller', roleId: 'role' } }), IdentityTransactionRequiredError);
  // @ts-expect-error Deliberate JavaScript caller with the required transaction omitted.
  await assert.rejects(enablePrincipal({ deps: withoutTransaction, input: { workspaceId, callerPrincipalId: 'caller', principalId: 'caller' } }), IdentityTransactionRequiredError);
  // @ts-expect-error Deliberate JavaScript caller with the required transaction omitted.
  await assert.rejects(updateUser({ deps: withoutTransaction, input: { workspaceId, callerPrincipalId: 'caller', principalId: 'caller' } }, { email: 'owner@example.com' }), IdentityTransactionRequiredError);
  // @ts-expect-error Deliberate JavaScript caller with the required transaction omitted.
  await assert.rejects(resetUserPassword({ deps: withoutTransaction, input: { workspaceId, callerPrincipalId: 'caller', principalId: 'caller', password: 'new-pw', seededOwnerPrincipalId: 'caller' } }), IdentityTransactionRequiredError);
  assert.equal((await repos.principals.findById({ workspaceId, id: 'caller' }))?.status, 'active');
});

test('policy deletion rolls its permission cascade back if the final delete fails', async () => {
  const raw = rawRepos();
  raw.policies.delete = async () => { throw new Error('delete failure'); };
  const repos = createTransactionalInMemoryIdentityRepos({ repos: raw });
  const { deps } = fixture();
  deps.repos = repos;
  await ownerGrant(repos, 'caller');
  await repos.policies.save({ id: 'doomed', workspaceId, name: 'doomed', isBuiltin: false, isFrozen: false });
  const grant = { id: 'doomed-grant', workspaceId, policyId: 'doomed', permission: 'content.read' };
  await repos.policyPermissions.save(grant);
  await assert.rejects(deletePolicy({ deps, input: { workspaceId, callerPrincipalId: 'caller', policyId: 'doomed' } }), /delete failure/);
  assert.deepEqual(await repos.policyPermissions.listByPolicyId({ workspaceId, policyId: 'doomed' }), [grant]);
  assert.equal((await repos.policies.findById({ workspaceId, id: 'doomed' }))?.id, 'doomed');
});

// Finding 3: missing references remain not-found; wrong principal kind is validation.
test('both grant transitions keep typed not-found for an absent target and write no links', async () => {
  const { repos, deps } = fixture();
  await ownerGrant(repos, 'caller');
  await assert.rejects(assignRole({ deps, input: { workspaceId, callerPrincipalId: 'caller', principalId: 'missing', roleId: 'missing-role' } }), IdentityNotFoundError);
  await assert.rejects(attachPolicy({ deps, input: { workspaceId, callerPrincipalId: 'caller', principalId: 'missing', policyId: 'missing-policy' } }), IdentityNotFoundError);
  assert.deepEqual(await repos.principalRoles.listByPrincipalId({ workspaceId, principalId: 'missing' }), []);
  assert.deepEqual(await repos.principalPolicies.listByPrincipalId({ workspaceId, principalId: 'missing' }), []);
});

// Finding 4: a constrained seed row cannot satisfy the intended unconstrained grant.
for (const constraintJson of ['', '{}']) {
  test(`resumed seed repairs an owner wildcard with constraint ${JSON.stringify(constraintJson)}`, async () => {
    const { repos, deps } = fixture();
    await repos.policies.save({ id: 'partial-owner', workspaceId, name: 'owner-builtin-policy', isBuiltin: true, isFrozen: false });
    await repos.policyPermissions.save({ id: 'constrained', workspaceId, policyId: 'partial-owner', permission: '*', resourceType: null, constraintJson });
    const { ownerPrincipalId } = await seedIdentity({ deps, input: { workspaceId, ownerUsername: 'owner', ownerPassword: 'explicit-password' } });
    assert.deepEqual(await authorize({ deps: repos, principalId: ownerPrincipalId, permission: 'role.manage', context: { workspaceId } }), { allowed: true, reason: 'owner_wildcard' });
    const rows = await repos.policyPermissions.listByPolicyId({ workspaceId, policyId: 'partial-owner' });
    assert.equal(rows.filter(row => row.permission === '*' && row.resourceType == null && row.constraintJson == null).length, 1);
    assert.equal(rows.find(row => row.id === 'constrained')?.constraintJson, constraintJson);
  });
}

// Finding 5: additions across all policies roll back together, and retries converge.
test('migration failure restores every earlier policy write and a retry is idempotent', async () => {
  const raw = rawRepos();
  const save = raw.policyPermissions.save.bind(raw.policyPermissions);
  let fail = true;
  raw.policyPermissions.save = async row => {
    if (fail && row.permission === 'regression.new' && row.policyId === 'second') throw new Error('migration failure');
    await save(row);
  };
  const repos = createTransactionalInMemoryIdentityRepos({ repos: raw });
  for (const id of ['first', 'second']) {
    await repos.policies.save({ id, workspaceId, name: id, isBuiltin: false, isFrozen: false });
    await repos.policyPermissions.save({ id: `old-${id}`, workspaceId, policyId: id, permission: 'regression.old', resourceType: null, constraintJson: null });
  }
  registerPermissionMigration({ from: 'regression.old', to: ['regression.new'], reason: 'regression fixture' });
  const migrationDeps = { policies: repos.policies, policyPermissions: repos.policyPermissions, transactions: repos.transactions, idGen: { newId: (() => { let id = 0; return () => `migration-${++id}`; })() }, workspaceId };
  await assert.rejects(migrateDeprecatedPermissionGrants(migrationDeps), /migration failure/);
  for (const policyId of ['first', 'second']) assert.deepEqual((await repos.policyPermissions.listByPolicyId({ workspaceId, policyId })).map(row => row.permission), ['regression.old']);
  fail = false;
  assert.deepEqual(await migrateDeprecatedPermissionGrants(migrationDeps), { migratedGrantCount: 2 });
  assert.deepEqual(await migrateDeprecatedPermissionGrants(migrationDeps), { migratedGrantCount: 0 });
});

test('migration requires a transaction port before any write', async () => {
  const { repos, deps } = fixture();
  // @ts-expect-error Deliberately omit the required transaction to exercise untyped callers.
  await assert.rejects(migrateDeprecatedPermissionGrants({ policies: repos.policies, policyPermissions: repos.policyPermissions, idGen: deps.idGen, workspaceId }), IdentityTransactionRequiredError);
});

// Finding 6: inactivity/existence takes precedence even over dangling wildcard grants.
test('unknown principal with a dangling wildcard is denied as principal_disabled', async () => {
  const { repos } = fixture();
  await repos.principalPolicies.save({ id: 'dangling', workspaceId, principalId: 'ghost', policyId: 'ghost-policy' });
  await repos.policyPermissions.save({ id: 'dangling-grant', workspaceId, policyId: 'ghost-policy', permission: '*' });
  assert.deepEqual(await authorize({ deps: repos, principalId: 'ghost', permission: 'content.write', context: { workspaceId } }), { allowed: false, reason: 'principal_disabled' });
});

// Finding 7: JSON Schema counts untrimmed Unicode code points, and schema errors are eager.
const stringSchema = { type: 'object', properties: { value: { type: 'string', minLength: 2 } }, required: ['value'], additionalProperties: false };
test('minLength counts raw code points and preserves accepted strings', () => {
  assert.equal(parseIdentityToolInput({ schema: stringSchema, input: { value: '😀' } }).ok, false);
  assert.deepEqual(parseIdentityToolInput({ schema: stringSchema, input: { value: ' 😀' } }), { ok: true, value: { value: ' 😀' } });
  assert.deepEqual(parseIdentityToolInput({ schema: stringSchema, input: { value: '  ' } }), { ok: true, value: { value: '  ' } });
});
test('absent optional non-string schema properties fail before invalid input is inspected', () => {
  const schema = { type: 'object', properties: { count: { type: 'number' } }, additionalProperties: false };
  assert.throws(() => parseIdentityToolInput({ schema, input: {} }), /non-string property/);
  assert.throws(() => parseIdentityToolInput({ schema, input: null }), /non-string property/);
});
for (const minLength of [-1, 1.5, '2', NaN]) {
  test(`invalid schema minLength ${String(minLength)} is rejected eagerly`, () => {
    assert.throws(() => parseIdentityToolInput({ schema: { ...stringSchema, properties: { value: { type: 'string', minLength } } }, input: {} }), /minLength/);
  });
}
test('misplaced keywords, malformed required/properties, and open schemas fail closed', () => {
  for (const schema of [
    { ...stringSchema, minLength: 2 },
    { ...stringSchema, properties: { value: { type: 'string', required: [] } } },
    { ...stringSchema, required: ['undeclared'] },
    { ...stringSchema, required: 'value' },
    { ...stringSchema, properties: { value: null } },
    { ...stringSchema, additionalProperties: true },
  ]) assert.throws(() => parseIdentityToolInput({ schema, input: {} }));
});
test('inherited input keys cannot satisfy required properties or smuggle additional keys', () => {
  assert.equal(parseIdentityToolInput({ schema: stringSchema, input: Object.create({ value: 'inherited' }) }).ok, false);
  assert.equal(parseIdentityToolInput({ schema: stringSchema, input: { value: 'ok', toString: 'extra' } }).ok, false);
});

test('ordinary readers see the restored state after a transaction rolls back', async () => {
  const { repos } = fixture();
  await principal(repos, 'reader-target');
  let ready!: () => void;
  let release!: () => void;
  const started = new Promise<void>(resolve => { ready = resolve; });
  const finish = new Promise<void>(resolve => { release = resolve; });
  const mutation = repos.transactions.run({ workspaceId, execute: async () => {
    const row = await repos.principals.findById({ workspaceId, id: 'reader-target' });
    assert.ok(row);
    await repos.principals.save({ ...row, status: 'disabled' });
    ready();
    await finish;
    throw new Error('rollback reader fixture');
  } });
  const rejected = assert.rejects(mutation, /rollback reader fixture/);
  await started;
  const read = repos.principals.findById({ workspaceId, id: 'reader-target' });
  release();
  await rejected;
  assert.equal((await read)?.status, 'active');
});

test('memory transactions reject a repository bag that has already been bound', () => {
  const { repos } = fixture();
  assert.throws(() => createTransactionalInMemoryIdentityRepos({ repos }), /already/);
});
