import { describe, expect, it } from "vitest";
import { policyPermissionRemoveRoute } from "../remove-policy-permission.js";
import { BODIES, ERRORS, makeAccessDeps, raw, refusalOf, throwingDeps, WORKSPACE_ID } from "./access-helpers.js";

/** Real services plus recording host owner probes; `isOwner` decides what the injected wildcard probe answers. */
async function harness({ isOwner, permission = "*", scope = { resourceType: null, constraintJson: null } }: {
  isOwner: boolean; permission?: string; scope?: { resourceType: string | null; constraintJson: string | null };
}) {
  const base = await makeAccessDeps();
  const probes: string[] = [];
  const floorChecks: string[] = [];
  await base.repos.policies.save({ id: "target", workspaceId: WORKSPACE_ID, name: "target", isBuiltin: false, isFrozen: false });
  const row = { id: "row", workspaceId: WORKSPACE_ID, policyId: "target", permission, ...scope };
  await base.repos.policyPermissions.save(row);
  const deps = {
    ...base.routeDeps, transactions: base.repos.transactions,
    principalHoldsOwnerWildcard: async ({ principalId }: { principalId: string }) => { probes.push(principalId); return isOwner; },
    assertActiveOwnerFloor: async ({ workspaceId }: { workspaceId: string }) => { floorChecks.push(workspaceId); },
  };
  const read = () => base.repos.policyPermissions.listByPolicyId({ workspaceId: WORKSPACE_ID, policyId: "target" });
  return { ...base, deps, row, read, probes, floorChecks };
}
const target = { policyId: "target", policyPermissionId: "row" };

describe("policyPermissionRemoveRoute", () => {
  it("keeps the method, path and 204 no-body success", () => {
    expect([policyPermissionRemoveRoute.method, policyPermissionRemoveRoute.path, policyPermissionRemoveRoute.successStatus, policyPermissionRemoveRoute.maxBodyBytes])
      .toEqual(["delete", "/api/admin/v1/workspaces/:workspaceId/policies/:policyId/permissions/:policyPermissionId", 204, undefined]);
  });

  it("reads both ids with the `?? \"\"` fallback", () => {
    expect(policyPermissionRemoveRoute.parse(raw(target))).toEqual({ ok: true, value: target });
    expect(policyPermissionRemoveRoute.parse(raw({}))).toEqual({ ok: true, value: { policyId: "", policyPermissionId: "" } });
  });

  it("refuses a non-owner removing the unscoped owner wildcard 409 OWNER_REQUIRED, asking the injected probe, and keeps the row", async () => {
    const { deps, OWNER, row, read, probes, floorChecks } = await harness({ isOwner: false });
    expect(await refusalOf(() => policyPermissionRemoveRoute.handle({ input: target, deps, context: OWNER }))).toEqual(BODIES.ownerRequired);
    expect(probes).toEqual([OWNER.id]);
    expect(floorChecks).toEqual([]);
    expect(await read()).toEqual([row]);
  });

  it("lets an owner remove the wildcard row, then checks the injected owner floor inside the same unit of work", async () => {
    const { deps, OWNER, read, floorChecks } = await harness({ isOwner: true });
    expect(await policyPermissionRemoveRoute.handle({ input: target, deps, context: OWNER })).toEqual({ ok: true, value: undefined });
    expect(floorChecks).toEqual([WORKSPACE_ID]);
    expect(await read()).toEqual([]);
  });

  it("rolls the removal back when the injected owner floor refuses", async () => {
    const { deps, OWNER, row, read } = await harness({ isOwner: true });
    const floor = { ...deps, assertActiveOwnerFloor: async () => { throw ERRORS.ownerRequired; } };
    expect(await refusalOf(() => policyPermissionRemoveRoute.handle({ input: target, deps: floor, context: OWNER }))).toEqual(BODIES.ownerRequired);
    expect(await read()).toEqual([row]);
  });

  for (const scope of [{ resourceType: "post", constraintJson: null }, { resourceType: null, constraintJson: "{}" }]) {
    it(`never consults the owner probe for a scoped '*' row ${JSON.stringify(scope)}`, async () => {
      const { deps, OWNER, read, probes } = await harness({ isOwner: false, scope });
      expect(await policyPermissionRemoveRoute.handle({ input: target, deps, context: OWNER })).toEqual({ ok: true, value: undefined });
      expect(probes).toEqual([]);
      expect(await read()).toEqual([]);
    });
  }

  it("answers an id that is not a member of the policy 404 RESOURCE_NOT_FOUND, never a delete", async () => {
    const { deps, OWNER, row, read } = await harness({ isOwner: true, permission: "role.manage" });
    expect(await refusalOf(() => policyPermissionRemoveRoute.handle({ input: { policyId: "target", policyPermissionId: "" }, deps, context: OWNER })))
      .toMatchObject({ status: 404, body: { code: "RESOURCE_NOT_FOUND" } });
    expect(await read()).toEqual([row]);
  });

  const ladder = [["ownerRequired", BODIES.ownerRequired], ["forbidden", BODIES.forbidden], ["validation", BODIES.validation], ["notFound", BODIES.notFound]] as const;
  for (const [name, expected] of ladder) {
    it(`maps ${name} to its exact flat body`, async () => {
      const deps = { ...throwingDeps(ERRORS[name]), transactions: { run: async () => undefined }, principalHoldsOwnerWildcard: async () => true, assertActiveOwnerFloor: async () => undefined };
      expect(await refusalOf(() => policyPermissionRemoveRoute.handle({ input: target, deps, context: { id: "p" } }))).toEqual(expected);
    });
  }

  it("rethrows an unmapped failure and fails closed without a principal", async () => {
    const deps = { ...throwingDeps(ERRORS.conflict), transactions: { run: async () => undefined }, principalHoldsOwnerWildcard: async () => true, assertActiveOwnerFloor: async () => undefined };
    await expect(policyPermissionRemoveRoute.handle({ input: target, deps, context: { id: "p" } })).rejects.toBe(ERRORS.conflict);
    await expect(policyPermissionRemoveRoute.handle({ input: target, deps })).rejects.toThrow(/no authenticated principal/);
  });
});
