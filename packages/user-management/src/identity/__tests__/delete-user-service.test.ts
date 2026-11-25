import { assertVersionedWrite } from "@jini-ai/core/optimistic-concurrency";
import assert from "node:assert/strict";
import { test } from "vitest";

import { IdentityForbiddenError, OwnerRequiredError, type IdentityRepos } from "../../core/index.js";
import { NodeSessionTokens, createTransactionalInMemoryIdentityRepos, InMemoryPolicyPermissionRepo, InMemoryPolicyRepo, InMemoryPrincipalPolicyRepo, InMemoryPrincipalRepo, InMemoryPrincipalRoleRepo, InMemoryRolePolicyRepo, InMemoryRoleRepo, InMemorySessionRepo, InMemoryUserRepo, type AuthServiceDeps } from "../../server/index.js";
import { createTrashUserService, type DeleteUserDeps, type RemoveUserFn } from "../delete-user-service.js";

/**
 * @file The factory-owned `trashUser` serialization (INV-08 owner floor) against in-memory repos.
 * The SQLite + real-Trash coverage of every refusal stays in the host, against its binding. Here the
 * identity transaction port is a pass-through for the concurrency cases, so the factory's own
 * queue is the only thing standing between two concurrent owner trashes and a zero-owner workspace.
 */

const WS = "ws-trash";
const NOW = "2026-09-24T00:00:00.000Z";
const SEEDED = "seeded-owner";

function memoryRepos(): Omit<IdentityRepos, "transactions"> {
  return { principals: new InMemoryPrincipalRepo({}), users: new InMemoryUserRepo({ assertVersionedWrite }), sessions: new InMemorySessionRepo({}), roles: new InMemoryRoleRepo({ assertVersionedWrite }), policies: new InMemoryPolicyRepo({ assertVersionedWrite }), policyPermissions: new InMemoryPolicyPermissionRepo({}), principalPolicies: new InMemoryPrincipalPolicyRepo({}), principalRoles: new InMemoryPrincipalRoleRepo({}), rolePolicies: new InMemoryRolePolicyRepo({}) };
}

/** `transactional: false` binds a pass-through transaction port, isolating the factory queue. */
async function harness({ transactional }: { transactional: boolean }) {
  let id = 0;
  const repos: IdentityRepos = transactional
    ? createTransactionalInMemoryIdentityRepos({ repos: memoryRepos() })
    : { ...memoryRepos(), transactions: { run: ({ execute }) => execute() } };
  const identity: AuthServiceDeps = {
    tokens: new NodeSessionTokens({}), repos, clock: { nowMs: () => Date.parse(NOW) }, idGen: { newId: () => `id-${++id}` },
    hasher: { hash: async ({ password }) => `password:${password}`, verify: async ({ hash, password }) => hash === `password:${password}` },
  };
  await repos.policies.save({ version: 1, id: "owner-policy", workspaceId: WS, name: "owner", isBuiltin: false, isFrozen: false });
  await repos.policyPermissions.save({ id: "owner-star", workspaceId: WS, policyId: "owner-policy", permission: "*", resourceType: null, constraintJson: null });
  const addUser = async ({ principalId, status, owner }: { principalId: string; status: "active" | "disabled"; owner: boolean }) => {
    await repos.principals.save({ id: principalId, workspaceId: WS, kind: "user", displayName: principalId, status, createdAt: NOW });
    await repos.users.save({ version: 1, principalId, workspaceId: WS, username: principalId, passwordHash: "password:x" });
    if (owner) await repos.principalPolicies.save({ id: `${principalId}-link`, workspaceId: WS, principalId, policyId: "owner-policy" });
  };
  // The disabled seeded owner still holds `*` (so it may call) but does not count toward the floor.
  await addUser({ principalId: SEEDED, status: "disabled", owner: true });
  await addUser({ principalId: "owner-a", status: "active", owner: true });
  await addUser({ principalId: "owner-b", status: "active", owner: true });
  const removed: string[] = [];
  const removeUser: RemoveUserFn = async ({ workspaceId, id: targetId }) => {
    await new Promise((resolve) => setTimeout(resolve, 1));
    const principal = await repos.principals.findById({ workspaceId, id: targetId });
    await repos.principals.save({ ...principal!, status: "disabled", disabledAt: NOW });
    removed.push(targetId);
    return { ok: true, version: null };
  };
  const deps: DeleteUserDeps = { identity, removeUser, isInTrash: async () => false };
  const input = (principalId: string) => ({ workspaceId: WS, callerPrincipalId: SEEDED, principalId, seededOwnerPrincipalId: SEEDED });
  return { deps, input, removed };
}

async function trashBothOwnersConcurrently({ transactional }: { transactional: boolean }) {
  const { trashUser } = createTrashUserService({});
  const h = await harness({ transactional });
  const outcomes = await Promise.allSettled([trashUser({ deps: h.deps, input: h.input("owner-a") }), trashUser({ deps: h.deps, input: h.input("owner-b") })]);
  return { outcomes, removed: h.removed };
}

for (const transactional of [false, true]) {
  test(`two concurrent trashes of the only two active owners serialize — exactly one succeeds (transactional repos: ${transactional})`, async () => {
    const { outcomes, removed } = await trashBothOwnersConcurrently({ transactional });
    assert.deepEqual(outcomes.map((o) => o.status), ["fulfilled", "rejected"], "calls run in invocation order; the second sees the first's write");
    assert.deepEqual(removed, ["owner-a"]);
    const rejected = outcomes[1]!;
    assert.ok(rejected.status === "rejected" && rejected.reason instanceof OwnerRequiredError);
    assert.equal(rejected.reason.message, "the workspace must keep at least one active owner-`*` principal");
  });
}

test("a refused trash does not poison the queue for the calls behind it", async () => {
  const { trashUser } = createTrashUserService({});
  const h = await harness({ transactional: false });
  const outcomes = await Promise.allSettled([
    trashUser({ deps: h.deps, input: { ...h.input("owner-a"), callerPrincipalId: "owner-b-nobody" } }),
    trashUser({ deps: h.deps, input: h.input("owner-a") }),
  ]);
  assert.ok(outcomes[0]!.status === "rejected" && outcomes[0].reason instanceof IdentityForbiddenError);
  assert.equal(outcomes[1]!.status, "fulfilled");
  assert.deepEqual(h.removed, ["owner-a"]);
});

test("each service instance owns its queue; one instance serializes across repeated calls", async () => {
  const service = createTrashUserService({});
  const h = await harness({ transactional: false });
  await service.trashUser({ deps: h.deps, input: h.input("owner-a") });
  await assert.rejects(service.trashUser({ deps: h.deps, input: h.input("owner-b") }), OwnerRequiredError);
  assert.deepEqual(h.removed, ["owner-a"]);
});
