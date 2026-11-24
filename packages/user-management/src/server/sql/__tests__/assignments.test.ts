import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "vitest";
import { SqlPrincipalPolicyRepo, SqlPrincipalRoleRepo, SqlRolePolicyRepo } from "../assignments.js";
import { type TestSqliteKernel, sqliteTestKernel } from "./support/sqlite-kernel.js";

let k: TestSqliteKernel;
beforeEach(async () => {
  k = sqliteTestKernel();
  await k.exec("CREATE TABLE host_role_policies (id text PRIMARY KEY, workspace_id text NOT NULL, role_id text NOT NULL, policy_id text NOT NULL)");
  await k.exec("CREATE TABLE host_principal_roles (id text PRIMARY KEY, workspace_id text NOT NULL, principal_id text NOT NULL, role_id text NOT NULL)");
  await k.exec("CREATE TABLE host_principal_policies (id text PRIMARY KEY, workspace_id text NOT NULL, principal_id text NOT NULL, policy_id text NOT NULL)");
});
afterEach(() => k.close());
const base = () => ({ kernel: k.kernel, transactions: k.transactions });

test("role->policy rows list by role and by policy, scoped to the workspace; save upserts on id", async () => {
  const repo = new SqlRolePolicyRepo({ ...base(), tables: { rolePolicies: "host_role_policies" } });
  await repo.save({ id: "1", workspaceId: "w", roleId: "r1", policyId: "p1" });
  await repo.save({ id: "2", workspaceId: "w", roleId: "r1", policyId: "p2" });
  await repo.save({ id: "3", workspaceId: "other", roleId: "r1", policyId: "p1" });
  assert.deepEqual((await repo.listByRoleId({ workspaceId: "w", roleId: "r1" })).map(r => r.id).sort(), ["1", "2"]);
  assert.deepEqual((await repo.listByPolicyId({ workspaceId: "w", policyId: "p1" })).map(r => r.id), ["1"]);
  await repo.save({ id: "1", workspaceId: "w", roleId: "r9", policyId: "p1" });
  assert.deepEqual(await repo.listByPolicyId({ workspaceId: "w", policyId: "p1" }), [{ id: "1", workspaceId: "w", roleId: "r9", policyId: "p1" }]);
});

test("principal->role rows list by principal and by role; principal->policy likewise", async () => {
  const roles = new SqlPrincipalRoleRepo({ ...base(), tables: { principalRoles: "host_principal_roles" } });
  await roles.save({ id: "1", workspaceId: "w", principalId: "u1", roleId: "r1" });
  await roles.save({ id: "2", workspaceId: "w", principalId: "u2", roleId: "r1" });
  await roles.save({ id: "3", workspaceId: "x", principalId: "u1", roleId: "r1" });
  assert.deepEqual((await roles.listByPrincipalId({ workspaceId: "w", principalId: "u1" })).map(r => r.id), ["1"]);
  assert.deepEqual((await roles.listByRoleId({ workspaceId: "w", roleId: "r1" })).map(r => r.id).sort(), ["1", "2"]);
  const policies = new SqlPrincipalPolicyRepo({ ...base(), tables: { principalPolicies: "host_principal_policies" } });
  await policies.save({ id: "1", workspaceId: "w", principalId: "u1", policyId: "p1" });
  await policies.save({ id: "2", workspaceId: "w", principalId: "u2", policyId: "p1" });
  await policies.save({ id: "1", workspaceId: "w", principalId: "u1", policyId: "p2" });
  assert.deepEqual(await policies.listByPrincipalId({ workspaceId: "w", principalId: "u1" }), [{ id: "1", workspaceId: "w", principalId: "u1", policyId: "p2" }]);
  assert.deepEqual((await policies.listByPolicyId({ workspaceId: "w", policyId: "p1" })).map(r => r.id), ["2"]);
});

test("every save takes the identity lock for its workspace in one transaction with one statement", async () => {
  const repo = new SqlRolePolicyRepo({ ...base(), tables: { rolePolicies: "host_role_policies" } });
  await repo.save({ id: "1", workspaceId: "w", roleId: "r", policyId: "p" });
  assert.deepEqual(k.events, ["begin", "lock:identity:w", "commit"]);
  assert.equal(k.queries.length, 1);
  k.queries.length = 0;
  await repo.listByRoleId({ workspaceId: "w", roleId: "r" });
  assert.equal(k.queries.length, 1);
});
