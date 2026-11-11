import { describe, expect, it } from "vitest";
import {
  InMemoryPolicyPermissionRepo, InMemoryPolicyRepo, InMemoryPrincipalPolicyRepo, InMemoryPrincipalRepo, InMemoryPrincipalRoleRepo,
  InMemoryRolePolicyRepo, InMemoryRoleRepo, InMemorySessionRepo, InMemoryUserRepo,
} from "../repo.memory.js";

// F1 fix wave (Stryker L1 §4 repo.memory.ts:71/100/115 — workspace-scoping fields → {} survived).
// Every repo holds rows with IDENTICAL ids/keys in two workspaces; every read, upsert and delete
// must touch only the named workspace. A dropped `workspaceId` filter fails here.
const W1 = "w1";
const W2 = "w2";
const both = <T extends Record<string, unknown>>(row: T) => [{ ...row, workspaceId: W1, tag: "one" }, { ...row, workspaceId: W2, tag: "two" }] as never[];
const tags = (rows: readonly unknown[]) => (rows as { tag: string }[]).map((r) => r.tag);

describe("in-memory identity repos — cross-workspace isolation", () => {
  it("principals", async () => {
    const repo = new InMemoryPrincipalRepo({}, { initialRows: both({ id: "p" }) });
    expect((await repo.findById({ workspaceId: W1, id: "p" }) as never as { tag: string }).tag).toBe("one");
    expect(tags(await repo.list({ workspaceId: W2 }))).toEqual(["two"]);
    await repo.save({ id: "p", workspaceId: W1, tag: "one-updated" } as never);
    expect(tags(await repo.list({ workspaceId: W2 }))).toEqual(["two"]);
    expect(tags(await repo.list({ workspaceId: W1 }))).toEqual(["one-updated"]);
  });

  it("users", async () => {
    const repo = new InMemoryUserRepo({}, { initialRows: both({ principalId: "p", username: "alice" }) });
    expect((await repo.findByPrincipalId({ workspaceId: W2, principalId: "p" }) as never as { tag: string }).tag).toBe("two");
    expect((await repo.findByUsername({ workspaceId: W1, username: "alice" }) as never as { tag: string }).tag).toBe("one");
    expect(await repo.findByUsername({ workspaceId: "w3", username: "alice" })).toBeNull();
    await repo.save({ principalId: "p", workspaceId: W2, username: "alice", tag: "two-updated" } as never);
    expect(tags(await repo.list({ workspaceId: W1 }))).toEqual(["one"]);
  });

  it("sessions", async () => {
    const repo = new InMemorySessionRepo({}, { initialRows: both({ id: "s", principalId: "p", tokenHash: "h", revokedAt: null }) });
    expect((await repo.findByTokenHash({ workspaceId: W1, tokenHash: "h" }) as never as { tag: string }).tag).toBe("one");
    expect(tags(await repo.listByPrincipalId({ workspaceId: W2, principalId: "p" }))).toEqual(["two"]);
    await repo.revoke({ workspaceId: W1, id: "s", revokedAt: "2026-01-01T00:00:00.000Z" });
    expect((await repo.findById({ workspaceId: W1, id: "s" }) as never as { revokedAt: string | null }).revokedAt).toBe("2026-01-01T00:00:00.000Z");
    expect((await repo.findById({ workspaceId: W2, id: "s" }) as never as { revokedAt: string | null }).revokedAt).toBeNull();
  });

  for (const [label, Repo] of [["roles", InMemoryRoleRepo], ["policies", InMemoryPolicyRepo]] as const) {
    it(label, async () => {
      const repo = new Repo({}, { initialRows: both({ id: "x", name: "admin" }) });
      expect((await repo.findById({ workspaceId: W1, id: "x" }) as never as { tag: string }).tag).toBe("one");
      expect((await repo.findByName({ workspaceId: W2, name: "admin" }) as never as { tag: string }).tag).toBe("two");
      await repo.delete({ workspaceId: W1, id: "x" });
      expect(await repo.findById({ workspaceId: W1, id: "x" })).toBeNull();
      expect(tags(await repo.list({ workspaceId: W2 }))).toEqual(["two"]);
    });
  }

  it("policy permissions", async () => {
    const repo = new InMemoryPolicyPermissionRepo({}, { initialRows: both({ id: "pp", policyId: "pol", permission: "*" }) });
    expect(tags(await repo.listByPolicyId({ workspaceId: W1, policyId: "pol" }))).toEqual(["one"]);
    await repo.deleteByPolicyId({ workspaceId: W1, policyId: "pol" });
    expect(await repo.listByPolicyId({ workspaceId: W1, policyId: "pol" })).toEqual([]);
    expect(tags(await repo.listByPolicyId({ workspaceId: W2, policyId: "pol" }))).toEqual(["two"]);
    await repo.delete({ workspaceId: W1, id: "pp" });
    expect(tags(await repo.listByPolicyId({ workspaceId: W2, policyId: "pol" }))).toEqual(["two"]);
  });

  it("role↔policy links", async () => {
    const repo = new InMemoryRolePolicyRepo({}, { initialRows: both({ id: "l", roleId: "r", policyId: "pol" }) });
    expect(tags(await repo.listByRoleId({ workspaceId: W1, roleId: "r" }))).toEqual(["one"]);
    expect(tags(await repo.listByPolicyId({ workspaceId: W2, policyId: "pol" }))).toEqual(["two"]);
  });

  it("principal↔role links", async () => {
    const repo = new InMemoryPrincipalRoleRepo({}, { initialRows: both({ id: "l", principalId: "p", roleId: "r" }) });
    expect(tags(await repo.listByPrincipalId({ workspaceId: W2, principalId: "p" }))).toEqual(["two"]);
    expect(tags(await repo.listByRoleId({ workspaceId: W1, roleId: "r" }))).toEqual(["one"]);
  });

  it("principal↔policy links", async () => {
    const repo = new InMemoryPrincipalPolicyRepo({}, { initialRows: both({ id: "l", principalId: "p", policyId: "pol" }) });
    expect(tags(await repo.listByPrincipalId({ workspaceId: W1, principalId: "p" }))).toEqual(["one"]);
    expect(tags(await repo.listByPolicyId({ workspaceId: W2, policyId: "pol" }))).toEqual(["two"]);
  });
});
