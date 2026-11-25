import { describe, expect, it } from "vitest";
import { createPolicy } from "../../../../server/grant-service.js";
import { policyUpdateRoute } from "../update-policy.js";
import { BODIES, ERRORS, makeAccessDeps, raw, refusalOf, throwingDeps, WORKSPACE_ID } from "./access-helpers.js";

describe("policyUpdateRoute", () => {
  it("keeps the method, path and 200 success status", () => {
    expect([policyUpdateRoute.method, policyUpdateRoute.path, policyUpdateRoute.successStatus, policyUpdateRoute.maxBodyBytes])
      .toEqual(["patch", "/api/admin/v1/workspaces/:workspaceId/policies/:policyId", undefined, undefined]);
  });

  it("reads policyId (fallback \"\") and leaves an absent name/description undefined (= unchanged)", () => {
    expect(policyUpdateRoute.parse(raw({ policyId: "p1" }, { name: 1, description: "d" }))).toEqual({ ok: true, value: { policyId: "p1", name: "1", description: "d" } });
    expect(policyUpdateRoute.parse(raw({}, undefined))).toEqual({ ok: true, value: { policyId: "", name: undefined, description: undefined } });
  });

  it("re-describes a custom policy and keeps its name when name is absent", async () => {
    const { routeDeps, serviceDeps, OWNER } = await makeAccessDeps();
    const { policy } = await createPolicy({ deps: serviceDeps, input: { workspaceId: WORKSPACE_ID, callerPrincipalId: OWNER.id, name: "Keep" } });
    const result = await policyUpdateRoute.handle({ input: { policyId: policy.id, name: undefined, description: "New" }, deps: routeDeps, context: OWNER });
    expect(result.ok && result.value.policy).toMatchObject({ id: policy.id, name: "Keep", description: "New" });
  });

  it("carries the client's basis unparsed and refuses a malformed one 400 before any write", async () => {
    expect(policyUpdateRoute.parse(raw({ policyId: "p1" }, { expectedVersion: "3" }))).toEqual({ ok: true, value: { policyId: "p1", name: undefined, description: undefined, expectedVersion: "3" } });
    const { routeDeps, serviceDeps, OWNER, repos } = await makeAccessDeps();
    const { policy } = await createPolicy({ deps: serviceDeps, input: { workspaceId: WORKSPACE_ID, callerPrincipalId: OWNER.id, name: "Keep" } });
    expect(await refusalOf(() => policyUpdateRoute.handle({ input: { policyId: policy.id, name: "New", description: undefined, expectedVersion: "3" }, deps: routeDeps, context: OWNER })))
      .toEqual({ status: 400, body: { error: "'expectedVersion' must be a non-negative integer when present", code: "VALIDATION_ERROR" } });
    expect((await repos.policies.findById({ workspaceId: WORKSPACE_ID, id: policy.id }))?.name).toBe("Keep");
  });

  it("answers the second editor from the same version 409 VERSION_CONFLICT and keeps the first save", async () => {
    const { routeDeps, serviceDeps, OWNER, repos } = await makeAccessDeps();
    const { policy } = await createPolicy({ deps: serviceDeps, input: { workspaceId: WORKSPACE_ID, callerPrincipalId: OWNER.id, name: "Keep" } });
    const first = await policyUpdateRoute.handle({ input: { policyId: policy.id, name: "First", description: undefined, expectedVersion: policy.version }, deps: routeDeps, context: OWNER });
    expect(first.ok && first.value.policy.version).toBe(policy.version + 1);
    expect(await refusalOf(() => policyUpdateRoute.handle({ input: { policyId: policy.id, name: "Second", description: undefined, expectedVersion: policy.version }, deps: routeDeps, context: OWNER })))
      .toMatchObject({ status: 409, body: { code: "VERSION_CONFLICT" } });
    expect((await repos.policies.findById({ workspaceId: WORKSPACE_ID, id: policy.id }))?.name).toBe("First");
  });

  for (const name of ["forbidden", "validation", "notFound"] as const) {
    it(`maps ${name} to its exact flat body`, async () => {
      expect(await refusalOf(() => policyUpdateRoute.handle({ input: { policyId: "p", name: undefined, description: undefined }, deps: throwingDeps(ERRORS[name]), context: { id: "p" } }))).toEqual(BODIES[name]);
    });
  }

  it("rethrows an unmapped failure and fails closed without a principal", async () => {
    const input = { policyId: "p", name: undefined, description: undefined };
    await expect(policyUpdateRoute.handle({ input, deps: throwingDeps(ERRORS.conflict), context: { id: "p" } })).rejects.toBe(ERRORS.conflict);
    await expect(policyUpdateRoute.handle({ input, deps: throwingDeps(new Error("x")) })).rejects.toThrow(/no authenticated principal/);
  });
});
