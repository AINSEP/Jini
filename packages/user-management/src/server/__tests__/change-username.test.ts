import { expect, it } from "vitest";
import { updateUser } from "../admin-crud-service.js";
import { login, validateSession } from "../auth-service.js";
import { seedIdentity } from "../seed.js";
import { renameHarness } from "./username-change.fixture.js";
import { IdentityValidationError } from "../../core/types.js";

it("reports a missing rename port as a wiring fault and preserves the user", async () => {
  const h = await renameHarness(); const target = await h.user("alice");
  const { usernameChanges: _usernameChanges, ...deps } = h.deps;
  let failure: unknown;
  try {
    await updateUser({ deps, input: { workspaceId: "w", callerPrincipalId: h.ownerPrincipalId, principalId: target.principalId } }, { username: "renamed" });
  } catch (error) { failure = error; }
  expect(failure).toBeInstanceOf(Error);
  expect(failure).not.toBeInstanceOf(IdentityValidationError);
  expect((failure as Error).message).toBe("username changes are not configured");
  expect(await h.repos.users.findByPrincipalId({ workspaceId: "w", principalId: target.principalId })).toEqual(target);
  expect(h.audit).toEqual([]);
});

it("normalizes names, preserves credentials/email/sessions, audits once, and supports idempotent retries", async () => {
  const h = await renameHarness(); const target = await h.user("alice");
  const session = await login({ deps: h.deps, input: { workspaceId: "w", username: "alice", password: "test-password" } });
  const required = { deps: h.deps, input: { workspaceId: "w", callerPrincipalId: h.ownerPrincipalId, principalId: target.principalId } };
  const { user } = await updateUser(required, { username: "  E\u0301LODIE  " });
  expect(user).toEqual({ ...target, lastLoginAt: session.session.createdAt, username: "élodie" });
  expect(await validateSession({ deps: h.deps, input: { workspaceId: "w", rawToken: session.rawToken } })).toMatchObject({ principal: { id: target.principalId } });
  expect(await h.repos.sessions.findById({ workspaceId: "w", id: session.session.id })).toEqual(session.session);
  expect(h.audit).toEqual([{ workspaceId: "w", callerPrincipalId: h.ownerPrincipalId, principalId: target.principalId,
    previousUsername: "alice", username: "élodie", occurredAt: "2026-10-09T00:00:00.000Z" }]);
  await updateUser(required, { username: "ÉLODIE" }); expect(h.audit).toHaveLength(1);
  await expect(login({ deps: h.deps, input: { workspaceId: "w", username: "alice", password: "test-password" } })).rejects.toThrow("invalid username or password");
  expect((await login({ deps: h.deps, input: { workspaceId: "w", username: "ÉLODIE", password: "test-password" } })).principal.id).toBe(target.principalId);
});

it("refuses blank, conflicting and trashed names without writes, including normalized collisions", async () => {
  const h = await renameHarness(); const target = await h.user("alice"); const taken = await h.user("bob");
  const required = { deps: h.deps, input: { workspaceId: "w", callerPrincipalId: h.ownerPrincipalId, principalId: target.principalId } };
  await expect(updateUser(required, { username: "   " })).rejects.toThrow("username must not be blank");
  await expect(updateUser(required, { username: " BOB " })).rejects.toMatchObject({ code: "RESOURCE_CONFLICT", message: "username 'bob' is already in use" });
  h.trash.add(taken.principalId);
  await expect(updateUser(required, { username: "BOB" })).rejects.toMatchObject({ code: "USERNAME_IN_TRASH", message: "a user with this username is in the Trash; restore or delete them permanently first" });
  h.trash.add(target.principalId);
  await expect(updateUser(required, { username: "free" })).rejects.toMatchObject({ code: "USER_IN_TRASH" });
  expect(await h.repos.users.findByPrincipalId({ workspaceId: "w", principalId: target.principalId })).toEqual(target);
  expect(h.audit).toEqual([]);
});

it("requires user.manage even for self, and an owner for every owner target", async () => {
  const h = await renameHarness(); const manager = await h.user("manager");
  await h.grant(manager.principalId, "member.manage");
  const input = { workspaceId: "w", callerPrincipalId: manager.principalId, principalId: manager.principalId };
  await expect(updateUser({ deps: h.deps, input }, { username: "new-manager" })).rejects.toMatchObject({
    permission: "user.manage", reason: "no_grant", message: `principal '${manager.principalId}' is not authorized for any of [user.manage]`,
  });
  await h.grant(manager.principalId, "user.manage");
  await expect(updateUser({ deps: h.deps, input: { ...input, principalId: h.ownerPrincipalId } }, { username: "new-owner" })).rejects.toThrow("only an owner can modify an owner principal");
  await updateUser({ deps: h.deps, input }, { username: "new-manager" });
  expect(h.audit).toHaveLength(1);
});

it("serializes competing normalized renames and rolls back when audit persistence fails", async () => {
  const h = await renameHarness(); const a = await h.user("alice"); const b = await h.user("bob");
  const results = await Promise.allSettled([a, b].map(target => updateUser({ deps: h.deps,
    input: { workspaceId: "w", callerPrincipalId: h.ownerPrincipalId, principalId: target.principalId } }, { username: "shared" })));
  expect(results.map(result => result.status).sort()).toEqual(["fulfilled", "rejected"]);
  expect(h.audit).toHaveLength(1);
  h.deps.usernameChanges = { isInTrash: async () => false, record: async () => { throw new Error("audit unavailable"); } };
  const before = await h.repos.users.findByPrincipalId({ workspaceId: "w", principalId: a.principalId });
  await expect(updateUser({ deps: h.deps, input: { workspaceId: "w", callerPrincipalId: h.ownerPrincipalId, principalId: a.principalId } }, { username: "another" })).rejects.toThrow("audit unavailable");
  expect(await h.repos.users.findByPrincipalId({ workspaceId: "w", principalId: a.principalId })).toEqual(before);
});

it("reboots with the same renamed seeded owner even after somebody reuses the former login", async () => {
  const h = await renameHarness();
  await updateUser({ deps: h.deps, input: { workspaceId: "w", callerPrincipalId: h.ownerPrincipalId, principalId: h.ownerPrincipalId } }, { username: "renamed-owner" });
  const other = await h.user("admin");
  const before = await h.repos.principals.list({ workspaceId: "w" });
  expect((await seedIdentity({ deps: h.deps, input: { workspaceId: "w", ownerUsername: "admin", ownerPassword: "test-password" } },
    { seededOwnerPrincipalId: h.ownerPrincipalId })).ownerPrincipalId).toBe(h.ownerPrincipalId);
  expect(await h.repos.principals.list({ workspaceId: "w" })).toEqual(before);
  expect(await h.repos.principalRoles.listByPrincipalId({ workspaceId: "w", principalId: other.principalId })).toEqual([]);
});

it("fails closed without rename lifecycle ports and rejects malformed service input without changing data", async () => {
  const h = await renameHarness(); const target = await h.user("alice");
  const required = { deps: h.deps, input: { workspaceId: "w", callerPrincipalId: h.ownerPrincipalId, principalId: target.principalId } };
  await expect(updateUser(required, { username: null as unknown as string })).rejects.toThrow("username must be a string");
  h.deps.usernameChanges = undefined;
  await expect(updateUser(required, { username: "new-name" })).rejects.toThrow("username changes are not configured");
  expect(await h.repos.users.findByPrincipalId({ workspaceId: "w", principalId: target.principalId })).toEqual(target);
  expect(h.audit).toEqual([]);
});

it("refuses a missing bound seeded owner instead of selecting a different user or minting an owner", async () => {
  const h = await renameHarness();
  const before = await h.repos.principals.list({ workspaceId: "w" });
  await expect(seedIdentity({ deps: h.deps, input: { workspaceId: "w", ownerUsername: "admin", ownerPassword: "test-password" } },
    { seededOwnerPrincipalId: "missing" })).rejects.toThrow("the bound seeded owner user was not found; restore the owner identity before booting");
  expect(await h.repos.principals.list({ workspaceId: "w" })).toEqual(before);
});
