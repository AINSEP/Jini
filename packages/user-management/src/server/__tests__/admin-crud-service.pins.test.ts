import { describe, expect, it } from "vitest";

import {
  deletePolicy,
  deleteRole,
  disablePrincipal,
  enablePrincipal,
  removePolicyPermission,
  resetUserPassword,
  updatePolicy,
  updateRole,
  updateUser,
  writePolicyPermission,
} from "../admin-crud-service.js";
import { IdentityNotFoundError, IdentityValidationError } from "../../core/types.js";
import type { UsernameChangePort } from "../../core/runtime-ports.js";
import { renameHarness } from "./username-change.fixture.js";

/**
 * @file Characterization pins for `admin-crud-service.ts` branches the main suite does not reach:
 * every not-found refusal, the idempotent enable, password-policy and name-validation refusals,
 * and the full check order inside `resolveUpdatedUsername` (the private rename validator).
 *
 * The rename validator is security-relevant: permission and owner gates run before it so a
 * conflict never discloses an account, and its own checks must run in a fixed order (type, blank,
 * port wiring, Trash, host support, uniqueness). Each pin asserts the specific error.
 */

const W = "w";

/** Awaits a refusal and asserts both its class and its exact message. */
async function expectRefusal(promise: Promise<unknown>, errorClass: new (...args: never[]) => Error, message: string): Promise<void> {
  const error = await promise.then(() => { throw new Error("expected a refusal, but the call succeeded"); }, (caught: unknown) => caught);
  expect(error).toBeInstanceOf(errorClass);
  expect((error as Error).message).toBe(message);
}

async function harnessWithUser(username = "alice") {
  const h = await renameHarness();
  const target = await h.user(username);
  const required = { deps: h.deps, input: { workspaceId: W, callerPrincipalId: h.ownerPrincipalId, principalId: target.principalId } };
  return { ...h, target, required };
}

describe("not-found refusals", () => {
  it("disablePrincipal refuses an unknown principal", async () => {
    const h = await renameHarness();
    await expectRefusal(disablePrincipal({ deps: h.deps, input: { workspaceId: W, callerPrincipalId: h.ownerPrincipalId, principalId: "ghost", seededOwnerPrincipalId: h.ownerPrincipalId } }), IdentityNotFoundError, "principal 'ghost' was not found");
  });

  it("enablePrincipal refuses an unknown principal", async () => {
    const h = await renameHarness();
    await expectRefusal(enablePrincipal({ deps: h.deps, input: { workspaceId: W, callerPrincipalId: h.ownerPrincipalId, principalId: "ghost" } }), IdentityNotFoundError, "principal 'ghost' was not found");
  });

  it("updateUser refuses an unknown user", async () => {
    const h = await renameHarness();
    await expectRefusal(updateUser({ deps: h.deps, input: { workspaceId: W, callerPrincipalId: h.ownerPrincipalId, principalId: "ghost" } }, { username: "x" }), IdentityNotFoundError, "user 'ghost' was not found");
  });

  it("resetUserPassword refuses an unknown user", async () => {
    const h = await renameHarness();
    await expectRefusal(resetUserPassword({ deps: h.deps, input: { workspaceId: W, callerPrincipalId: h.ownerPrincipalId, principalId: "ghost", password: "pw", seededOwnerPrincipalId: h.ownerPrincipalId } }), IdentityNotFoundError, "user 'ghost' was not found");
  });

  it("updateRole and deleteRole refuse an unknown role", async () => {
    const h = await renameHarness();
    const input = { workspaceId: W, callerPrincipalId: h.ownerPrincipalId, roleId: "ghost" };
    await expectRefusal(updateRole({ deps: h.deps, input: { ...input, name: "n" } }), IdentityNotFoundError, "role 'ghost' was not found");
    await expectRefusal(deleteRole({ deps: h.deps, input }), IdentityNotFoundError, "role 'ghost' was not found");
  });

  it("every policy transition refuses an unknown policy", async () => {
    const h = await renameHarness();
    const input = { workspaceId: W, callerPrincipalId: h.ownerPrincipalId, policyId: "ghost" };
    const notFound = "policy 'ghost' was not found";
    await expectRefusal(updatePolicy({ deps: h.deps, input }, { name: "n" }), IdentityNotFoundError, notFound);
    await expectRefusal(deletePolicy({ deps: h.deps, input }), IdentityNotFoundError, notFound);
    await expectRefusal(writePolicyPermission({ deps: h.deps, input: { ...input, permission: "user.manage" } }), IdentityNotFoundError, notFound);
    await expectRefusal(removePolicyPermission({ deps: h.deps, input: { ...input, policyPermissionId: "pp" } }), IdentityNotFoundError, notFound);
  });
});

describe("enable / reset / role / policy edges", () => {
  it("enablePrincipal of an already-active user is a no-op that returns the stored record", async () => {
    const h = await harnessWithUser();
    const before = await h.repos.principals.findById({ workspaceId: W, id: h.target.principalId });
    const { principal } = await enablePrincipal({ deps: h.deps, input: { workspaceId: W, callerPrincipalId: h.ownerPrincipalId, principalId: h.target.principalId } });
    expect(principal).toEqual(before);
    expect(principal.status).toBe("active");
  });

  it("resetUserPassword refuses a password over the policy limit without writing", async () => {
    const h = await harnessWithUser();
    await expectRefusal(resetUserPassword({ deps: h.deps, input: { workspaceId: W, callerPrincipalId: h.ownerPrincipalId, principalId: h.target.principalId, password: "x".repeat(513), seededOwnerPrincipalId: h.ownerPrincipalId } }), IdentityValidationError, "Password must be no more than 512 characters.");
    expect(await h.repos.users.findByPrincipalId({ workspaceId: W, principalId: h.target.principalId })).toEqual(h.target);
  });

  it("updateRole refuses a missing or blank name and trims a valid one", async () => {
    const h = await renameHarness();
    await h.repos.roles.save({ id: "role-1", workspaceId: W, name: "old", isBuiltin: false });
    const input = { workspaceId: W, callerPrincipalId: h.ownerPrincipalId, roleId: "role-1" };
    const required = "role name is required";
    // Malformed-input fixture: an untyped route can deliver no name at all.
    await expectRefusal(updateRole({ deps: h.deps, input: { ...input, name: undefined as unknown as string } }), IdentityValidationError, required);
    await expectRefusal(updateRole({ deps: h.deps, input: { ...input, name: "   " } }), IdentityValidationError, required);
    expect((await updateRole({ deps: h.deps, input: { ...input, name: "  new  " } })).role.name).toBe("new");
  });

  it("updatePolicy keeps the stored name for a description-only edit and refuses a blank name", async () => {
    const h = await renameHarness();
    await h.repos.policies.save({ id: "pol-1", workspaceId: W, name: "keep", description: "old", isBuiltin: false, isFrozen: false });
    const input = { workspaceId: W, callerPrincipalId: h.ownerPrincipalId, policyId: "pol-1" };
    expect((await updatePolicy({ deps: h.deps, input }, { description: "new" })).policy).toMatchObject({ name: "keep", description: "new" });
    await expectRefusal(updatePolicy({ deps: h.deps, input }, { name: "  " }), IdentityValidationError, "policy name is required");
    expect((await updatePolicy({ deps: h.deps, input }, { name: " renamed " })).policy).toMatchObject({ name: "renamed", description: "new" });
  });
});

describe("resolveUpdatedUsername check order (via updateUser)", () => {
  it("rejects a non-string username before checking port wiring", async () => {
    const h = await harnessWithUser();
    h.deps.usernameChanges = undefined;
    // Malformed-input fixture: an untyped caller can pass a number where a string is declared.
    await expectRefusal(updateUser(h.required, { username: 42 as unknown as string }), IdentityValidationError, "username must be a string");
  });

  it("rejects a blank username before checking port wiring", async () => {
    const h = await harnessWithUser();
    h.deps.usernameChanges = undefined;
    await expectRefusal(updateUser(h.required, { username: " \t " }), IdentityValidationError, "username must not be blank");
  });

  it("checks the target's Trash state before asking the host whether a rename is supported", async () => {
    const h = await harnessWithUser();
    const calls: string[] = [];
    const port: UsernameChangePort = {
      isInTrash: async () => { calls.push("isInTrash"); return true; },
      assertSupported: async () => { calls.push("assertSupported"); },
      record: async () => { calls.push("record"); },
    };
    h.deps.usernameChanges = port;
    await expect(updateUser(h.required, { username: "bob" })).rejects.toMatchObject({ code: "USER_IN_TRASH", message: "this user is in the Trash; restore them first" });
    expect(calls).toEqual(["isInTrash"]);
  });

  it("asks the host only for an actual change, and a host refusal aborts with no writes", async () => {
    const h = await harnessWithUser();
    const supportedFor: string[] = [];
    h.deps.usernameChanges = {
      isInTrash: async () => false,
      assertSupported: async ({ principalId }) => { supportedFor.push(principalId); throw new Error("host cannot rename this principal"); },
      record: async () => { throw new Error("record must not run"); },
    };
    // Same normalized name: no host check, no audit, the save still succeeds.
    await expect(updateUser(h.required, { username: " ALICE " })).resolves.toMatchObject({ user: { username: "alice" } });
    expect(supportedFor).toEqual([]);
    await expect(updateUser(h.required, { username: "carol" })).rejects.toThrow(/^host cannot rename this principal$/);
    expect(supportedFor).toEqual([h.target.principalId]);
    expect((await h.repos.users.findByPrincipalId({ workspaceId: W, principalId: h.target.principalId }))?.username).toBe("alice");
  });

  it("renames when the host port has no assertSupported hook", async () => {
    const h = await harnessWithUser();
    const { user } = await updateUser(h.required, { username: "dave" });
    expect(user.username).toBe("dave");
    expect(h.audit).toHaveLength(1);
  });

  it("does not treat the target's own current name as a conflict", async () => {
    const h = await harnessWithUser();
    await expect(updateUser(h.required, { username: "alice" })).resolves.toMatchObject({ user: { username: "alice", email: "kept@example.test" } });
    expect(h.audit).toEqual([]);
  });

  it("checks the conflicting holder's Trash state, not the target's, for a taken name", async () => {
    const h = await harnessWithUser();
    const taken = await h.user("bob");
    const trashQueries: string[] = [];
    h.deps.usernameChanges = { isInTrash: async ({ principalId }) => { trashQueries.push(principalId); return principalId === taken.principalId; }, record: async () => {} };
    await expect(updateUser(h.required, { username: "BOB" })).rejects.toMatchObject({ code: "USERNAME_IN_TRASH" });
    expect(trashQueries).toEqual([h.target.principalId, taken.principalId]);
  });
});
