import { describe, expect, it } from "vitest";
import { createTransactionalInMemoryIdentityRepos } from "../repo.memory-transactions.js";
import {
  InMemoryIdentityRows, InMemoryPolicyPermissionRepo, InMemoryPolicyRepo, InMemoryPrincipalPolicyRepo, InMemoryPrincipalRepo,
  InMemoryPrincipalRoleRepo, InMemoryRolePolicyRepo, InMemoryRoleRepo, InMemorySessionRepo, InMemoryUserRepo,
} from "../repo.memory.js";
import type { IdentityRepos } from "../../core/ports.js";

function memoryRepos(): Omit<IdentityRepos, "transactions"> {
  return {
    principals: new InMemoryPrincipalRepo({}), users: new InMemoryUserRepo({}), sessions: new InMemorySessionRepo({}),
    roles: new InMemoryRoleRepo({}), policies: new InMemoryPolicyRepo({}), policyPermissions: new InMemoryPolicyPermissionRepo({}),
    rolePolicies: new InMemoryRolePolicyRepo({}), principalRoles: new InMemoryPrincipalRoleRepo({}), principalPolicies: new InMemoryPrincipalPolicyRepo({}),
  };
}

describe("createTransactionalInMemoryIdentityRepos", () => {
  it("refuses a repository bag containing a store it cannot snapshot", () => {
    const foreignUsers = { findByPrincipalId: async () => null } as unknown as IdentityRepos["users"];
    expect(() => createTransactionalInMemoryIdentityRepos({ repos: { ...memoryRepos(), users: foreignUsers } }))
      .toThrow("memory transactions require in-memory identity repositories");
  });

  it("does not make wrapped repositories thenable, so awaiting one yields the repository itself", async () => {
    const repos = createTransactionalInMemoryIdentityRepos({ repos: memoryRepos() });
    // A proxy that turned the absent `then` into a queued function would hang this await.
    await expect(Promise.resolve(repos.users)).resolves.toBe(repos.users);
  });

  it("rolls every store back when a transaction body throws", async () => {
    const repos = createTransactionalInMemoryIdentityRepos({ repos: memoryRepos() });
    const principal = { id: "p1", workspaceId: "w", kind: "user" as const, displayName: "p1", status: "active" as const, createdAt: "2026-01-01T00:00:00.000Z" };
    await expect(repos.transactions.run({ workspaceId: "w", execute: async () => {
      await repos.principals.save(principal);
      throw new Error("abort transaction");
    } })).rejects.toThrow("abort transaction");
    expect(await repos.principals.findById({ workspaceId: "w", id: "p1" })).toBeNull();
  });
});

describe("in-memory identity rows", () => {
  it("starts empty when a subclass passes no seed rows", () => {
    class Rows extends InMemoryIdentityRows<{ id: string }> {}
    expect(new Rows({}).snapshotRows({})).toEqual([]);
  });

  it("returns null for an unknown session id", async () => {
    const sessions = new InMemorySessionRepo({});
    expect(await sessions.findById({ workspaceId: "w", id: "missing" })).toBeNull();
  });
});
