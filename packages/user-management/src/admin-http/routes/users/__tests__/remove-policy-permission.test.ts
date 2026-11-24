import { describe, expect, it } from "vitest";
import { isRouteReply } from "@jini-ai/core/contracts/server";

import { removePolicyPermission } from "../../../../server/admin-crud-service.js";
import { createPolicy } from "../../../../server/grant-service.js";
import { policyPermissionRemoveRoute, type PolicyPermissionRemoveRouteDeps } from "../remove-policy-permission.js";
import { BODIES, ERRORS, makeAccessDeps, raw, refusalOf, throwingDeps, WORKSPACE_ID } from "./access-helpers.js";

const PATH = "/api/admin/v1/workspaces/:workspaceId/policies/:policyId/permissions/:policyPermissionId";

/** Route deps over the real service and repos, with the two host owner guards as recording fakes. */
async function harness({ holdsWildcard = true, floor = async () => {} }: { holdsWildcard?: boolean; floor?: () => Promise<void> } = {}) {
  const base = await makeAccessDeps();
  const wildcardChecks: unknown[] = [];
  const floorChecks: unknown[] = [];
  const deps: PolicyPermissionRemoveRouteDeps = {
    workspaceId: WORKSPACE_ID,
    identityServiceDeps: base.routeDeps.identityServiceDeps,
    transactions: base.repos.transactions,
    policyPermissionRepo: base.repos.policyPermissions,
    removePolicyPermission,
    principalHoldsOwnerWildcard: async (required) => { wildcardChecks.push({ workspaceId: required.workspaceId, principalId: required.principalId }); return holdsWildcard; },
    assertActiveOwnerFloor: async (required) => { floorChecks.push({ workspaceId: required.workspaceId }); await floor(); },
  };
  const { policy } = await createPolicy({ deps: base.serviceDeps, input: { workspaceId: WORKSPACE_ID, callerPrincipalId: base.OWNER.id, name: "Target" } });
  const row = (id: string, permission: string) => ({ id, workspaceId: WORKSPACE_ID, policyId: policy.id, permission, resourceType: null, constraintJson: null });
  await base.repos.policyPermissions.save(row("pp-read", "content.read"));
  await base.repos.policyPermissions.save(row("pp-wild", "*"));
  const read = async () => (await base.repos.policyPermissions.listByPolicyId({ workspaceId: WORKSPACE_ID, policyId: policy.id })).map((r) => r.id).sort();
  return { ...base, deps, policy, read, wildcardChecks, floorChecks };
}

describe("policyPermissionRemoveRoute", () => {
  it("keeps the method, path, and no declared success status or body cap", () => {
    expect([policyPermissionRemoveRoute.method, policyPermissionRemoveRoute.path, policyPermissionRemoveRoute.successStatus, policyPermissionRemoveRoute.maxBodyBytes])
      .toEqual(["delete", PATH, undefined, undefined]);
  });

  it("reads both ids with the `?? \"\"` fallback", () => {
    expect(policyPermissionRemoveRoute.parse(raw({ policyId: "p1", policyPermissionId: "pp1" }))).toEqual({ ok: true, value: { policyId: "p1", policyPermissionId: "pp1" } });
    expect(policyPermissionRemoveRoute.parse(raw({}))).toEqual({ ok: true, value: { policyId: "", policyPermissionId: "" } });
  });

  it("removes the row through the real service and answers a bare 204 reply (no body)", async () => {
    const h = await harness();
    const result = await policyPermissionRemoveRoute.handle({ input: { policyId: h.policy.id, policyPermissionId: "pp-read" }, deps: h.deps, context: h.OWNER });
    expect(result.ok).toBe(true);
    const value = (result as { value: unknown }).value;
    expect(isRouteReply(value)).toBe(true);
    expect(value).toEqual({ status: 204 });
    expect(await h.read()).toEqual(["pp-wild"]);
    expect(h.wildcardChecks).toEqual([]);
    expect(h.floorChecks).toEqual([{ workspaceId: WORKSPACE_ID }]);
  });

  it("refuses a non-owner removing the owner wildcard row 409 OWNER_REQUIRED, asking the host guard, and keeps the row", async () => {
    const h = await harness({ holdsWildcard: false });
    expect(await refusalOf(() => policyPermissionRemoveRoute.handle({ input: { policyId: h.policy.id, policyPermissionId: "pp-wild" }, deps: h.deps, context: h.OWNER })))
      .toEqual(BODIES.ownerRequired);
    expect(h.wildcardChecks).toEqual([{ workspaceId: WORKSPACE_ID, principalId: h.OWNER.id }]);
    expect(await h.read()).toEqual(["pp-read", "pp-wild"]);
  });

  it("lets an owner remove the wildcard row", async () => {
    const h = await harness({ holdsWildcard: true });
    await policyPermissionRemoveRoute.handle({ input: { policyId: h.policy.id, policyPermissionId: "pp-wild" }, deps: h.deps, context: h.OWNER });
    expect(await h.read()).toEqual(["pp-read"]);
  });

  it("rolls the removal back when the host's owner floor refuses after the write", async () => {
    const h = await harness({ floor: async () => { throw ERRORS.ownerRequired; } });
    expect(await refusalOf(() => policyPermissionRemoveRoute.handle({ input: { policyId: h.policy.id, policyPermissionId: "pp-read" }, deps: h.deps, context: h.OWNER })))
      .toEqual(BODIES.ownerRequired);
    expect(await h.read()).toEqual(["pp-read", "pp-wild"]);
  });

  const ladder = [["ownerRequired", BODIES.ownerRequired], ["forbidden", BODIES.forbidden], ["validation", BODIES.validation], ["notFound", BODIES.notFound]] as const;
  for (const [name, expected] of ladder) {
    it(`maps ${name} to its exact flat body`, async () => {
      const deps = { ...(await harness()).deps, identityServiceDeps: throwingDeps(ERRORS[name]).identityServiceDeps };
      expect(await refusalOf(() => policyPermissionRemoveRoute.handle({ input: { policyId: "p", policyPermissionId: "pp" }, deps, context: { id: "p" } }))).toEqual(expected);
    });
  }

  it("rethrows an unmapped failure (incl. a conflict, which this route never maps) and fails closed without a principal", async () => {
    const deps = (await harness()).deps;
    for (const err of [ERRORS.conflict, ERRORS.grantExceeds]) {
      const failing = { ...deps, identityServiceDeps: throwingDeps(err).identityServiceDeps };
      await expect(policyPermissionRemoveRoute.handle({ input: { policyId: "p", policyPermissionId: "pp" }, deps: failing, context: { id: "p" } })).rejects.toBe(err);
    }
    await expect(policyPermissionRemoveRoute.handle({ input: { policyId: "p", policyPermissionId: "pp" }, deps })).rejects.toThrow(/no authenticated principal/);
  });
});
