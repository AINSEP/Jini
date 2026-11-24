import { describe, expect, it } from "vitest";
import { IdentityForbiddenError, IdentityNotFoundError, OwnerRequiredError } from "../../../../core/types.js";
import { userDeleteRoute } from "../delete.js";
import { HostSelfDeleteError, HostUnsupportedError, raw, refusalOf, signal, WORKSPACE_ID } from "./helpers.js";

function deleteDeps(trash: () => Promise<unknown> = async () => ({ ok: true })) {
  const calls: unknown[] = [];
  const deps = {
    workspaceId: WORKSPACE_ID, ownerPrincipalId: Promise.resolve("owner-1"),
    trashUser: async (required: unknown) => { calls.push(required); return trash(); },
    isSelfDeleteError: ({ err }: { err: unknown }) => err instanceof HostSelfDeleteError,
    isUserDeleteUnsupportedError: ({ err }: { err: unknown }) => err instanceof HostUnsupportedError,
  };
  return { deps, calls };
}

describe("userDeleteRoute", () => {
  it("keeps the method, path, 204 success status and the principal id fallback", () => {
    expect(userDeleteRoute.method).toBe("delete");
    expect(userDeleteRoute.path).toBe("/api/admin/v1/workspaces/:workspaceId/users/:principalId");
    expect(userDeleteRoute.successStatus).toBe(204);
    expect(userDeleteRoute.maxBodyBytes).toBeUndefined();
    expect(userDeleteRoute.parse(raw({}))).toEqual({ ok: true, value: { principalId: "" } });
  });

  it("hands the injected trash move the caller, target and seeded owner, and answers no body", async () => {
    const { deps, calls } = deleteDeps();
    expect(await userDeleteRoute.handle({ input: { principalId: "p2" }, deps, context: { id: "p1" } }, { signal })).toEqual({ ok: true, value: undefined });
    expect(calls).toEqual([{ workspaceId: WORKSPACE_ID, callerPrincipalId: "p1", principalId: "p2", seededOwnerPrincipalId: "owner-1" }]);
  });

  const ladder: Array<[string, Error, { status: number; body: unknown }]> = [
    ["forbidden", new IdentityForbiddenError({ message: "no", permission: "admin", reason: "r" }), { status: 403, body: { error: "no", code: "FORBIDDEN", details: { permission: "admin", reason: "r" } } }],
    ["self delete", new HostSelfDeleteError("you cannot delete your own account"), { status: 409, body: { error: "you cannot delete your own account", code: "SELF_DELETE" } }],
    ["owner required", new OwnerRequiredError({ message: "owner" }), { status: 409, body: { error: "owner", code: "OWNER_REQUIRED" } }],
    ["not found", new IdentityNotFoundError({ message: "gone" }), { status: 404, body: { error: "gone", code: "RESOURCE_NOT_FOUND" } }],
    ["no trash wiring", new HostUnsupportedError("no trash"), { status: 501, body: { error: "no trash", code: "NOT_SUPPORTED" } }],
  ];
  for (const [name, err, expected] of ladder) {
    it(`maps ${name} to its exact body`, async () => {
      const { deps } = deleteDeps(async () => { throw err; });
      expect(await refusalOf(() => userDeleteRoute.handle({ input: { principalId: "p2" }, deps, context: { id: "p1" } }))).toEqual(expected);
    });
  }

  it("rethrows an unmapped failure and fails closed without a principal", async () => {
    const { deps, calls } = deleteDeps(async () => { throw new Error("trash down"); });
    await expect(userDeleteRoute.handle({ input: { principalId: "p2" }, deps, context: { id: "p1" } })).rejects.toThrow("trash down");
    await expect(userDeleteRoute.handle({ input: { principalId: "p2" }, deps, context: undefined })).rejects.toThrow(/no authenticated principal/);
    expect(calls).toHaveLength(1);
  });
});
