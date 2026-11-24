import { describe, expect, it } from "vitest";
import { createPolicy } from "../../../../server/grant-service.js";
import { policyDeleteRoute } from "../delete-policy.js";
import { BODIES, ERRORS, makeAccessDeps, raw, refusalOf, throwingDeps, WORKSPACE_ID } from "./access-helpers.js";

describe("policyDeleteRoute", () => {
  it("keeps the method, path and 204 no-body success", () => {
    expect([policyDeleteRoute.method, policyDeleteRoute.path, policyDeleteRoute.successStatus, policyDeleteRoute.maxBodyBytes])
      .toEqual(["delete", "/api/admin/v1/workspaces/:workspaceId/policies/:policyId", 204, undefined]);
  });

  it("reads policyId with the `?? \"\"` fallback", () => {
    expect(policyDeleteRoute.parse(raw({ policyId: "p1" }))).toEqual({ ok: true, value: { policyId: "p1" } });
    expect(policyDeleteRoute.parse(raw({}))).toEqual({ ok: true, value: { policyId: "" } });
  });

  it("deletes an unreferenced custom policy through the real service", async () => {
    const { routeDeps, serviceDeps, OWNER, repos } = await makeAccessDeps();
    const { policy } = await createPolicy({ deps: serviceDeps, input: { workspaceId: WORKSPACE_ID, callerPrincipalId: OWNER.id, name: "Gone" } });
    expect(await policyDeleteRoute.handle({ input: { policyId: policy.id }, deps: routeDeps, context: OWNER })).toEqual({ ok: true, value: undefined });
    expect(await repos.policies.findById({ workspaceId: WORKSPACE_ID, id: policy.id })).toBeNull();
  });

  const ladder = [["forbidden", BODIES.forbidden], ["conflict", BODIES.conflictOn("policyId")], ["validation", BODIES.validation], ["notFound", BODIES.notFound]] as const;
  for (const [name, expected] of ladder) {
    it(`maps ${name} to its exact flat body`, async () => {
      expect(await refusalOf(() => policyDeleteRoute.handle({ input: { policyId: "p" }, deps: throwingDeps(ERRORS[name]), context: { id: "p" } }))).toEqual(expected);
    });
  }

  it("rethrows an unmapped failure and fails closed without a principal", async () => {
    await expect(policyDeleteRoute.handle({ input: { policyId: "p" }, deps: throwingDeps(ERRORS.grantExceeds), context: { id: "p" } })).rejects.toBe(ERRORS.grantExceeds);
    await expect(policyDeleteRoute.handle({ input: { policyId: "p" }, deps: throwingDeps(new Error("x")) })).rejects.toThrow(/no authenticated principal/);
  });
});
