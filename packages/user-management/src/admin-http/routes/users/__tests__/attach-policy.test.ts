import { describe, expect, it } from "vitest";
import { userAttachPolicyRoute } from "../attach-policy.js";
import { addUser, raw, refusalOf, seededIdentity, signal, WORKSPACE_ID } from "./helpers.js";

async function grantDeps() {
  const { services, ownerId } = await seededIdentity();
  const alice = await addUser({ services, ownerId, username: "alice" });
  const [grant] = await services.repos.policies.list({ workspaceId: WORKSPACE_ID });
  return { deps: { workspaceId: WORKSPACE_ID, identityServices: () => services }, services, ownerId, alice, grantId: grant!.id };
}

describe("userAttachPolicyRoute", () => {
  it("keeps the method, path and 201 success status", () => {
    expect(userAttachPolicyRoute.method).toBe("post");
    expect(userAttachPolicyRoute.path).toBe("/api/admin/v1/workspaces/:workspaceId/users/:principalId/policies");
    expect(userAttachPolicyRoute.successStatus).toBe(201);
    expect(userAttachPolicyRoute.maxBodyBytes).toBeUndefined();
  });

  it("parses the principal id and policyId with the host's fallbacks, including a null or non-object body", () => {
    expect(userAttachPolicyRoute.parse(raw({ principalId: "p1" }, { policyId: 9 }))).toEqual({ ok: true, value: { principalId: "p1", policyId: "9" } });
    for (const body of [undefined, null, "text"]) expect(userAttachPolicyRoute.parse(raw({}, body))).toEqual({ ok: true, value: { principalId: "", policyId: "" } });
  });

  it("grants through the real service and answers the attachment record", async () => {
    const { deps, ownerId, alice, grantId } = await grantDeps();
    const result = await userAttachPolicyRoute.handle({ input: { principalId: alice, policyId: grantId }, deps, context: { id: ownerId } }, { signal });
    expect(result.ok && result.value.attachment).toMatchObject({ principalId: alice, policyId: grantId });
  });

  it("maps a missing grant to the code-less 404 and an unauthorized caller to 403 FORBIDDEN", async () => {
    const { deps, services, ownerId, alice } = await grantDeps();
    const missing = await refusalOf(() => userAttachPolicyRoute.handle({ input: { principalId: alice, policyId: "nope" }, deps, context: { id: ownerId } }));
    expect(missing.status).toBe(404);
    expect(Object.keys(missing.body as object)).toEqual(["error"]);
    const bob = await addUser({ services, ownerId, username: "bob" });
    const forbidden = await refusalOf(() => userAttachPolicyRoute.handle({ input: { principalId: alice, policyId: "nope" }, deps, context: { id: bob } }));
    expect(forbidden.status).toBe(403);
    expect(forbidden.body).toMatchObject({ code: "FORBIDDEN" });
  });

  it("rethrows an unmapped failure and fails closed without a principal", async () => {
    const { deps, services, ownerId, alice, grantId } = await grantDeps();
    const broken = { ...services, repos: { ...services.repos, transactions: { run: async () => { throw new Error("db down"); } } } };
    await expect(userAttachPolicyRoute.handle({ input: { principalId: alice, policyId: grantId }, deps: { ...deps, identityServices: () => broken }, context: { id: ownerId } })).rejects.toThrow("db down");
    await expect(userAttachPolicyRoute.handle({ input: { principalId: alice, policyId: grantId }, deps, context: undefined })).rejects.toThrow(/no authenticated principal/);
  });
});
