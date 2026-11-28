import { describe, expect, it } from "vitest";
import { createPolicy } from "../../../../server/grant-service.js";
import { policyPermissionWriteRoute } from "../write-policy-permission.js";
import { BODIES, ERRORS, makeAccessDeps, raw, refusalOf, throwingDeps, WORKSPACE_ID } from "./access-helpers.js";

/** The host's ungrantable permissions and refusal copy are injected, so the tests use values no real host ships. */
const HOST_POLICY = { ungrantablePermissions: ["test.reserved", "test.reserved_too"], ungrantablePermissionRefusal: "test: reserved for the owner" };
const input = (permission: unknown = "role.manage") => ({ policyId: "p", permission: String(permission ?? ""), requestedPermission: permission, resourceType: undefined, constraintJson: undefined });

describe("policyPermissionWriteRoute", () => {
  it("keeps the method, path and 201 success status", () => {
    expect([policyPermissionWriteRoute.method, policyPermissionWriteRoute.path, policyPermissionWriteRoute.successStatus, policyPermissionWriteRoute.maxBodyBytes])
      .toEqual(["post", "/api/admin/v1/workspaces/:workspaceId/policies/:policyId/permissions", 201, undefined]);
  });

  it("coerces the payload, keeps the raw permission for the PERMISSION_UNKNOWN echo, and leaves absent scopes undefined", () => {
    expect(policyPermissionWriteRoute.parse(raw({ policyId: "p1" }, { permission: "a.b", resourceType: "post", constraintJson: 3 }))).toEqual({
      ok: true, value: { policyId: "p1", permission: "a.b", requestedPermission: "a.b", resourceType: "post", constraintJson: "3" },
    });
    expect(policyPermissionWriteRoute.parse(raw({}, undefined))).toEqual({
      ok: true, value: { policyId: "", permission: "", requestedPermission: undefined, resourceType: undefined, constraintJson: undefined },
    });
  });

  it("writes a permission row onto a custom policy through the real service", async () => {
    const { routeDeps, serviceDeps, OWNER } = await makeAccessDeps();
    const { policy } = await createPolicy({ deps: serviceDeps, input: { workspaceId: WORKSPACE_ID, callerPrincipalId: OWNER.id, name: "Grants" } });
    const result = await policyPermissionWriteRoute.handle({ input: { ...input(), policyId: policy.id }, deps: { ...routeDeps, ...HOST_POLICY }, context: OWNER });
    expect(result.ok && result.value.policyPermission).toMatchObject({ policyId: policy.id, permission: "role.manage", resourceType: null, constraintJson: null });
  });

  it("forwards a resource scope and constraint to the service, which stores them on the row", async () => {
    const { routeDeps, serviceDeps, OWNER } = await makeAccessDeps();
    const { policy } = await createPolicy({ deps: serviceDeps, input: { workspaceId: WORKSPACE_ID, callerPrincipalId: OWNER.id, name: "Scoped" } });
    const result = await policyPermissionWriteRoute.handle({ input: { ...input(), policyId: policy.id, resourceType: "post", constraintJson: '{"own":true}' },
      deps: { ...routeDeps, ...HOST_POLICY }, context: OWNER });
    expect(result.ok && result.value.policyPermission).toMatchObject({ policyId: policy.id, permission: "role.manage", resourceType: "post", constraintJson: '{"own":true}' });
  });

  for (const reserved of HOST_POLICY.ungrantablePermissions) {
    it(`refuses the injected ungrantable permission '${reserved}' with the host's code-only 403 before any service work`, async () => {
      const { routeDeps, OWNER, serviceCalls } = await makeAccessDeps();
      expect(await refusalOf(() => policyPermissionWriteRoute.handle({ input: input(reserved), deps: { ...routeDeps, ...HOST_POLICY }, context: OWNER })))
        .toEqual({ status: 403, body: { error: "test: reserved for the owner", code: "FORBIDDEN" } });
      expect(serviceCalls()).toBe(0);
    });
  }

  it("echoes the raw requested permission on PERMISSION_UNKNOWN from the real service", async () => {
    const { routeDeps, serviceDeps, OWNER } = await makeAccessDeps();
    const { policy } = await createPolicy({ deps: serviceDeps, input: { workspaceId: WORKSPACE_ID, callerPrincipalId: OWNER.id, name: "Grants" } });
    const refusal = await refusalOf(() => policyPermissionWriteRoute.handle({ input: { ...input("nope.never"), policyId: policy.id }, deps: { ...routeDeps, ...HOST_POLICY }, context: OWNER }));
    expect(refusal).toMatchObject({ status: 400, body: { code: "PERMISSION_UNKNOWN", details: { permission: "nope.never" } } });
  });

  const ladder = [["forbidden", BODIES.forbidden], ["grantExceeds", BODIES.grantExceeds], ["permissionUnknown", BODIES.permissionUnknownFor(42)],
    ["validation", BODIES.validation], ["notFound", BODIES.notFound]] as const;
  for (const [name, expected] of ladder) {
    it(`maps ${name} to its exact flat body`, async () => {
      expect(await refusalOf(() => policyPermissionWriteRoute.handle({ input: input(42), deps: { ...throwingDeps(ERRORS[name]), ...HOST_POLICY }, context: { id: "p" } }))).toEqual(expected);
    });
  }

  it("rethrows an unmapped failure and fails closed without a principal (before the reserved check)", async () => {
    await expect(policyPermissionWriteRoute.handle({ input: input(), deps: { ...throwingDeps(ERRORS.conflict), ...HOST_POLICY }, context: { id: "p" } })).rejects.toBe(ERRORS.conflict);
    await expect(policyPermissionWriteRoute.handle({ input: input("test.reserved"), deps: { ...throwingDeps(new Error("x")), ...HOST_POLICY } })).rejects.toThrow(/no authenticated principal/);
  });
});
