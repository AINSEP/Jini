import { describe, expect, it } from "vitest";
import { policyCreateRoute } from "../create-policy.js";
import { BODIES, ERRORS, makeAccessDeps, raw, refusalOf, throwingDeps, WORKSPACE_ID } from "./access-helpers.js";

describe("policyCreateRoute", () => {
  it("keeps the method, path and 201 success status", () => {
    expect([policyCreateRoute.method, policyCreateRoute.path, policyCreateRoute.successStatus, policyCreateRoute.maxBodyBytes])
      .toEqual(["post", "/api/admin/v1/workspaces/:workspaceId/policies", 201, undefined]);
  });

  it("reads name (fallback \"\") and an optional description (absent stays undefined)", () => {
    expect(policyCreateRoute.parse(raw({}, { name: "P", description: 5 }))).toEqual({ ok: true, value: { name: "P", description: "5" } });
    expect(policyCreateRoute.parse(raw({}, undefined))).toEqual({ ok: true, value: { name: "", description: undefined } });
  });

  it("creates a custom policy (with its description) through the real service", async () => {
    const { routeDeps, OWNER } = await makeAccessDeps();
    const result = await policyCreateRoute.handle({ input: { name: "Review", description: "Reviewers" }, deps: routeDeps, context: OWNER });
    expect(result.ok && result.value.policy).toMatchObject({ workspaceId: WORKSPACE_ID, name: "Review", description: "Reviewers", isBuiltin: false, isFrozen: false });
  });

  for (const name of ["forbidden", "validation"] as const) {
    it(`maps ${name} to its exact flat body`, async () => {
      expect(await refusalOf(() => policyCreateRoute.handle({ input: { name: "P", description: undefined }, deps: throwingDeps(ERRORS[name]), context: { id: "p" } }))).toEqual(BODIES[name]);
    });
  }

  it("rethrows an unmapped failure and fails closed without a principal", async () => {
    await expect(policyCreateRoute.handle({ input: { name: "P", description: undefined }, deps: throwingDeps(ERRORS.notFound), context: { id: "p" } })).rejects.toBe(ERRORS.notFound);
    await expect(policyCreateRoute.handle({ input: { name: "P", description: undefined }, deps: throwingDeps(new Error("x")) })).rejects.toThrow(/no authenticated principal/);
  });
});
