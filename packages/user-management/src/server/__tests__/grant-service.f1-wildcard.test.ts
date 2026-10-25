/**
 * F1 fix wave (Stryker L1 §4: grant-service.ts:80,138,139,143 survived). The owner-wildcard test
 * `permission==='*' && resourceType==null && constraintJson==null` is pinned one clause at a time,
 * and both `some` calls get ≥2 rows with the qualifying row first and last.
 */
import { describe, expect, it } from "vitest";

import { assertGrantClamp, principalHoldsOwnerWildcard } from "../grant-service.js";
import type { AuthServiceDeps } from "../auth-service.js";
import {
  InMemoryPolicyPermissionRepo, InMemoryPrincipalPolicyRepo, InMemoryPrincipalRepo, InMemoryPrincipalRoleRepo, InMemoryRolePolicyRepo,
} from "../repo.memory.js";
import { GrantExceedsIssuerError } from "../../core/types.js";

const W = "w";
type Row = { permission: string; resourceType?: string | null; constraintJson?: string | null };

async function depsWith(rows: readonly Row[]): Promise<AuthServiceDeps> {
  const repos = {
    principals: new InMemoryPrincipalRepo({}), principalRoles: new InMemoryPrincipalRoleRepo({}), rolePolicies: new InMemoryRolePolicyRepo({}),
    principalPolicies: new InMemoryPrincipalPolicyRepo({}), policyPermissions: new InMemoryPolicyPermissionRepo({}),
  };
  await repos.principals.save({ id: "caller", workspaceId: W, kind: "user", displayName: "caller", status: "active", createdAt: "2026-01-01T00:00:00.000Z" });
  await repos.principalPolicies.save({ id: "link", workspaceId: W, principalId: "caller", policyId: "pol" });
  let n = 0;
  for (const row of rows) {
    await repos.policyPermissions.save({ id: `pp-${++n}`, workspaceId: W, policyId: "pol", permission: row.permission, resourceType: row.resourceType ?? null, constraintJson: row.constraintJson ?? null });
  }
  return { repos } as unknown as AuthServiceDeps;
}

const holds = async (rows: readonly Row[]) => principalHoldsOwnerWildcard({ deps: await depsWith(rows), workspaceId: W, principalId: "caller" });

describe("principalHoldsOwnerWildcard", () => {
  it.each<[string, Row[], boolean]>([
    ["unconstrained *", [{ permission: "*" }], true],
    ["* scoped to a resource type", [{ permission: "*", resourceType: "post" }], false],
    ["* with a constraint", [{ permission: "*", constraintJson: "{}" }], false],
    ["unconstrained non-* permission", [{ permission: "user.manage" }], false],
    ["no rows", [], false],
    ["qualifying * listed last after two non-qualifying", [{ permission: "*", resourceType: "post" }, { permission: "*", constraintJson: "{}" }, { permission: "*" }], true],
    ["qualifying * listed first", [{ permission: "*" }, { permission: "user.manage", resourceType: "x" }, { permission: "*", constraintJson: "{}" }], true],
  ])("%s → %s", async (_label, rows, expected) => {
    expect(await holds(rows)).toBe(expected);
  });

  it("is workspace-scoped: the same caller in another workspace holds nothing", async () => {
    expect(await principalHoldsOwnerWildcard({ deps: await depsWith([{ permission: "*" }]), workspaceId: "other", principalId: "caller" })).toBe(false);
  });
});

describe("assertGrantClamp", () => {
  const clamp = async (rows: readonly Row[], conferredPermissions: readonly string[]) =>
    assertGrantClamp({ deps: await depsWith(rows), workspaceId: W, callerPrincipalId: "caller", conferredPermissions });

  async function expectExceeds(promise: Promise<unknown>, offending: readonly string[]) {
    const error = await promise.then(() => { throw new Error("expected GrantExceedsIssuerError"); }, (e: unknown) => e);
    expect(error).toBeInstanceOf(GrantExceedsIssuerError);
    expect((error as Error).message).toBe(`principal 'caller' cannot grant permission(s) it does not hold unconstrained: ${offending.join(", ")}`);
    expect((error as { offendingPermissions?: readonly string[] }).offendingPermissions).toEqual(offending);
  }

  it("an empty conferred set needs no authority at all", async () => {
    await expect(clamp([], [])).resolves.toBeUndefined();
  });

  it("unconstrained * may confer anything", async () => {
    await expect(clamp([{ permission: "*" }], ["user.manage", "role.manage"])).resolves.toBeUndefined();
  });

  it.each<[string, Row]>([
    ["scoped *", { permission: "*", resourceType: "post" }],
    ["constrained *", { permission: "*", constraintJson: "{}" }],
  ])("%s may NOT confer a permission it does not otherwise hold", async (_l, row) => {
    await expectExceeds(clamp([row], ["user.manage"]), ["user.manage"]);
  });

  it.each<[string, Row]>([
    ["resource-scoped hold", { permission: "user.manage", resourceType: "post" }],
    ["constrained hold", { permission: "user.manage", constraintJson: "{}" }],
    ["a different permission", { permission: "role.manage" }],
  ])("%s cannot be delegated", async (_l, row) => {
    await expectExceeds(clamp([row], ["user.manage"]), ["user.manage"]);
  });

  it("names every offending permission, de-duplicated, in input order; held ones pass", async () => {
    await expectExceeds(
      clamp([{ permission: "user.manage", constraintJson: "{}" }, { permission: "role.manage" }, { permission: "post.read", resourceType: "p" }], ["post.read", "role.manage", "user.manage", "post.read"]),
      ["post.read", "user.manage"],
    );
  });

  it("an unconstrained hold listed after conditional ones still counts (some, not every)", async () => {
    await expect(clamp([{ permission: "user.manage", resourceType: "x" }, { permission: "user.manage", constraintJson: "{}" }, { permission: "user.manage" }], ["user.manage"])).resolves.toBeUndefined();
  });
});

describe("assertGrantClamp — F1 re-score kill", () => {
  it("an unconstrained * alongside ordinary rows still confers a permission held nowhere else (some, not every)", async () => {
    await expect(assertGrantClamp({ deps: await depsWith([{ permission: "post.read" }, { permission: "*" }, { permission: "media.read", resourceType: "x" }]), workspaceId: W, callerPrincipalId: "caller", conferredPermissions: ["user.manage"] })).resolves.toBeUndefined();
  });
});
