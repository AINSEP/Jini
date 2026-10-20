import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FetchQueryProvider } from "@jini-ai/ui/panel-kit";
import type { AdminIdentityUser, AdminRole } from "../../models.js";
import type { UsersPort } from "../../ports.js";
import { createFakeUsersPort, type FakeUsersPortOptions } from "../../testing.js";
import { useUsers, type UsersOptions } from "../hooks/use-users.hooks.js";

// Characterization pins for `useUsers`, written against the pre-refactor hook: the list-derived
// fields, the caller's own row, rename permission, the grant runner, and the email/status failures.
const translate = (key: string) => key;
function wrapper({ children }: { children: React.ReactNode }) { return <FetchQueryProvider>{children}</FetchQueryProvider>; }
const base: AdminIdentityUser = { principalId: "u1", workspaceId: "w", username: "alice", email: "alice@example.com",
  status: "active", createdAt: "2026-08-01T00:00:00.000Z", roleIds: [], policyIds: [] };
const CALLER: AdminIdentityUser = { ...base, principalId: "caller", username: "caller" };
const TARGET: AdminIdentityUser = { ...base, principalId: "target", username: "target" };
const OWNER_ROLE: AdminRole = { id: "owner-role", workspaceId: "w", name: "owner", isBuiltin: true };
const EDITOR_ROLE: AdminRole = { id: "editor-role", workspaceId: "w", name: "Editor", isBuiltin: false };
const POLICY = { id: "p1", workspaceId: "w", name: "Content", isBuiltin: false, isFrozen: false };

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

/** A fake port whose `me()` reports `permissions` as the caller's effective permissions. */
function portWith(options: FakeUsersPortOptions, permissions?: string[]): ReturnType<typeof createFakeUsersPort> {
  const port = createFakeUsersPort({}, options);
  const me = port.me.bind(port);
  port.me = async (required) => ({ ...(await me(required)), effectivePermissions: permissions });
  return port;
}

async function mounted(port: UsersPort, options: UsersOptions = {}) {
  const hook = renderHook(() => useUsers({ port, translate, queryScope: "w" }, options), { wrapper });
  await waitFor(() => expect(hook.result.current.users).not.toBeNull());
  return hook;
}

describe("useUsers pins — list-derived fields", () => {
  it("is null everywhere with canGrant false before the read settles", () => {
    const port = createFakeUsersPort({}, { users: [base] });
    port.listUsers = () => new Promise(() => {});
    const { result } = renderHook(() => useUsers({ port, translate, queryScope: "w" }), { wrapper });
    expect(result.current.users).toBeNull();
    expect(result.current.roles).toBeNull();
    expect(result.current.policies).toBeNull();
    expect(result.current.canGrant).toBe(false);
    expect(result.current.error).toBeNull();
    expect(result.current.ownProfile).toBeNull();
    expect(result.current.canRenameOwnProfile).toBe(false);
  });

  it("loads roles and policies with canGrant true when the grant reads succeed", async () => {
    const port = createFakeUsersPort({}, { users: [base], roles: [EDITOR_ROLE], policies: [POLICY] });
    const { result } = await mounted(port);
    expect(result.current.roles).toEqual([EDITOR_ROLE]);
    expect(result.current.policies).toEqual([POLICY]);
    expect(result.current.canGrant).toBe(true);
  });

  it("degrades a 403 on the grant reads to empty roles/policies with canGrant false", async () => {
    const port = createFakeUsersPort({}, { users: [base], roles: [EDITOR_ROLE], policies: [POLICY] });
    port.listPolicies = () => Promise.reject(Object.assign(new Error("forbidden"), { status: 403 }));
    const { result } = await mounted(port);
    expect(result.current.users).toEqual([base]);
    expect(result.current.roles).toEqual([]);
    expect(result.current.policies).toEqual([]);
    expect(result.current.canGrant).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("treats a non-403 status on the grant reads as a page error", async () => {
    const port = createFakeUsersPort({}, { users: [base] });
    port.listRoles = () => Promise.reject(Object.assign(new Error("server error"), { status: 500 }));
    const { result } = renderHook(() => useUsers({ port, translate, queryScope: "w" }), { wrapper });
    await waitFor(() => expect(result.current.error).toBe("server error"));
    expect(result.current.users).toBeNull();
  });

  it("falls back to the translated load message for an Error with no message", async () => {
    const port = createFakeUsersPort({}, { users: [base] });
    port.listUsers = () => Promise.reject(new Error(""));
    const { result } = renderHook(() => useUsers({ port, translate: key => `t:${key}`, queryScope: "w" }), { wrapper });
    await waitFor(() => expect(result.current.error).toBe("t:failed to load users"));
  });

  it("exposes the injected translator as both t and translate", async () => {
    const { result } = await mounted(createFakeUsersPort({}, { users: [base] }));
    expect(result.current.t).toBe(translate);
    expect(result.current.translate).toBe(translate);
  });
});

describe("useUsers pins — the caller's own row", () => {
  it("finds the caller's own profile from me()", async () => {
    const port = createFakeUsersPort({}, { users: [TARGET, CALLER], meId: "caller" });
    const { result } = await mounted(port);
    await waitFor(() => expect(result.current.ownProfile).toEqual(CALLER));
  });

  it("has no own profile when me() names a principal outside the roster", async () => {
    const port = createFakeUsersPort({}, { users: [TARGET], meId: "elsewhere" });
    const { result } = await mounted(port);
    await waitFor(() => expect(result.current.canManageUserTrash).toBe(true));
    expect(result.current.ownProfile).toBeNull();
  });

  it("has no own profile and no trash affordance when me() fails", async () => {
    const port = createFakeUsersPort({}, { users: [CALLER], meId: "caller" });
    port.me = () => Promise.reject(new Error("me failed"));
    const { result } = await mounted(port);
    expect(result.current.ownProfile).toBeNull();
    expect(result.current.canManageUserTrash).toBe(false);
  });

  it("lets an owner caller act on a protected admin row", async () => {
    const caller = { ...CALLER, roleIds: [OWNER_ROLE.id] };
    const target = { ...TARGET, isProtectedAccount: true };
    const port = createFakeUsersPort({}, { users: [caller, target], roles: [OWNER_ROLE], meId: "caller" });
    const { result } = await mounted(port);
    await waitFor(() => expect(result.current.ownProfile).toEqual(caller));
    expect(result.current.rowCapabilities(target)).toEqual({ canDelete: true, canDisable: true, canEnable: true, canResetPassword: true });
  });

  it("refuses a non-owner caller on a protected admin row", async () => {
    const target = { ...TARGET, isProtectedAccount: true };
    const port = createFakeUsersPort({}, { users: [CALLER, target], roles: [OWNER_ROLE], meId: "caller" });
    const { result } = await mounted(port);
    await waitFor(() => expect(result.current.ownProfile).toEqual(CALLER));
    expect(result.current.rowCapabilities(target)).toEqual({ canDelete: false, canDisable: false, canEnable: false, canResetPassword: false });
  });

  it("refuses every destructive action while the caller is still unknown", () => {
    const port = createFakeUsersPort({}, { users: [TARGET] });
    port.me = () => new Promise(() => {});
    const { result } = renderHook(() => useUsers({ port, translate, queryScope: "w" }), { wrapper });
    expect(result.current.rowCapabilities(TARGET)).toEqual({ canDelete: false, canDisable: false, canEnable: false, canResetPassword: false });
  });
});

describe("useUsers pins — rename permission", () => {
  it.each([["*"], ["user.manage"]])("allows renaming an ordinary user with the %s permission", async (permission) => {
    const { result } = await mounted(portWith({ users: [CALLER, TARGET], meId: "caller" }, [permission]));
    await waitFor(() => expect(result.current.canRenameUser?.(TARGET)).toBe(true));
    expect(result.current.renameUserHandler?.({ user: TARGET })).toBeTypeOf("function");
  });

  it("refuses renaming without a user-management permission", async () => {
    const { result } = await mounted(portWith({ users: [CALLER, TARGET], meId: "caller" }, ["member.manage"]));
    await waitFor(() => expect(result.current.ownProfile).toEqual(CALLER));
    expect(result.current.canRenameUser?.(TARGET)).toBe(false);
    expect(result.current.renameUserHandler?.({ user: TARGET })).toBeUndefined();
  });

  it("refuses renaming when me() reports no permissions at all", async () => {
    const { result } = await mounted(portWith({ users: [CALLER, TARGET], meId: "caller" }));
    await waitFor(() => expect(result.current.ownProfile).toEqual(CALLER));
    expect(result.current.canRenameUser?.(TARGET)).toBe(false);
  });

  it("refuses renaming before the caller is known", () => {
    const port = createFakeUsersPort({}, { users: [TARGET] });
    port.me = () => new Promise(() => {});
    const { result } = renderHook(() => useUsers({ port, translate, queryScope: "w" }), { wrapper });
    expect(result.current.canRenameUser?.(TARGET)).toBe(false);
  });

  it("refuses a row the server marked canRename false, even with full permissions", async () => {
    const { result } = await mounted(portWith({ users: [CALLER, TARGET], meId: "caller" }, ["*"]));
    await waitFor(() => expect(result.current.canRenameUser?.(TARGET)).toBe(true));
    expect(result.current.canRenameUser?.({ ...TARGET, canRename: false })).toBe(false);
  });

  it("refuses a non-owner renaming a server-flagged owner, and allows a server-flagged non-owner with an owner role", async () => {
    const { result } = await mounted(portWith({ users: [CALLER, TARGET], roles: [OWNER_ROLE], meId: "caller" }, ["*"]));
    await waitFor(() => expect(result.current.ownProfile).toEqual(CALLER));
    expect(result.current.canRenameUser?.({ ...TARGET, isOwner: true })).toBe(false);
    expect(result.current.canRenameUser?.({ ...TARGET, isOwner: false, roleIds: [OWNER_ROLE.id] })).toBe(true);
  });

  it("treats a target holding a role the caller cannot see as an owner (fails closed)", async () => {
    const { result } = await mounted(portWith({ users: [CALLER, TARGET], roles: [EDITOR_ROLE], meId: "caller" }, ["*"]));
    await waitFor(() => expect(result.current.ownProfile).toEqual(CALLER));
    expect(result.current.canRenameUser?.({ ...TARGET, roleIds: ["hidden-role"] })).toBe(false);
    expect(result.current.canRenameUser?.({ ...TARGET, roleIds: [EDITOR_ROLE.id] })).toBe(true);
    expect(result.current.canRenameUser?.({ ...TARGET, roleIds: [OWNER_ROLE.id] })).toBe(false);
  });

  it("lets an owner caller rename an owner target", async () => {
    const caller = { ...CALLER, roleIds: [OWNER_ROLE.id] };
    const { result } = await mounted(portWith({ users: [caller, TARGET], roles: [OWNER_ROLE], meId: "caller" }, ["*"]));
    await waitFor(() => expect(result.current.ownProfile).toEqual(caller));
    expect(result.current.canRenameUser?.({ ...TARGET, isOwner: true })).toBe(true);
  });

  it("opens the rename dialog on the caller's own profile when allowed", async () => {
    const { result } = await mounted(portWith({ users: [CALLER, TARGET], meId: "caller" }, ["*"]));
    await waitFor(() => expect(result.current.canRenameOwnProfile).toBe(true));
    act(() => result.current.openOwnRename?.());
    expect(result.current.changeUsername?.target).toEqual(CALLER);
  });

  it("opens the rename dialog for the row a handler was built for", async () => {
    const { result } = await mounted(portWith({ users: [CALLER, TARGET], meId: "caller" }, ["*"]));
    await waitFor(() => expect(result.current.canRenameUser?.(TARGET)).toBe(true));
    act(() => result.current.renameUserHandler?.({ user: TARGET })?.(TARGET));
    expect(result.current.changeUsername?.target).toEqual(TARGET);
  });

  it("openOwnRename does nothing without an own profile", async () => {
    const { result } = await mounted(portWith({ users: [TARGET], meId: "elsewhere" }, ["*"]));
    await waitFor(() => expect(result.current.canManageUserTrash).toBe(true));
    act(() => result.current.openOwnRename?.());
    expect(result.current.changeUsername?.target).toBeNull();
    expect(result.current.canRenameOwnProfile).toBe(false);
  });
});

describe("useUsers pins — grants", () => {
  it("onAssignRole with no pending role calls nothing", async () => {
    const port = createFakeUsersPort({}, { users: [base], roles: [EDITOR_ROLE] });
    let calls = 0;
    port.assignRole = async () => { calls += 1; return { assignment: {} }; };
    const { result } = await mounted(port);
    await act(async () => result.current.onAssignRole({ principalId: base.principalId }));
    expect(calls).toBe(0);
  });

  it("onAttachPolicy with no pending policy calls nothing", async () => {
    const port = createFakeUsersPort({}, { users: [base], policies: [POLICY] });
    let calls = 0;
    port.attachPolicy = async () => { calls += 1; return { attachment: {} }; };
    const { result } = await mounted(port);
    await act(async () => result.current.onAttachPolicy({ principalId: base.principalId }));
    expect(calls).toBe(0);
  });

  it("a successful grant clears its pending selection and the saving flag", async () => {
    const port = createFakeUsersPort({}, { users: [base], policies: [POLICY] });
    const write = deferred<{ attachment: unknown }>();
    port.attachPolicy = () => write.promise;
    const { result } = await mounted(port);
    act(() => result.current.setPendingPolicyId(POLICY.id));
    let grant!: Promise<void>;
    act(() => { grant = result.current.onAttachPolicy({ principalId: base.principalId }); });
    expect(result.current.grantSaving).toBe(true);
    await act(async () => { write.resolve({ attachment: {} }); await grant; });
    expect(result.current.grantSaving).toBe(false);
    expect(result.current.pendingPolicyId).toBe("");
    expect(result.current.grantError).toBeNull();
  });

  it("a failed attach keeps the pending selection and shows the translated fallback", async () => {
    const port = createFakeUsersPort({}, { users: [base], policies: [POLICY], attachPolicyError: new Error("") });
    const { result } = await mounted(port);
    act(() => result.current.setPendingPolicyId(POLICY.id));
    await act(async () => result.current.onAttachPolicy({ principalId: base.principalId }));
    expect(result.current.grantError).toBe("failed to attach policy");
    expect(result.current.pendingPolicyId).toBe(POLICY.id);
    expect(result.current.grantSaving).toBe(false);
  });

  it("toggleExpanded seeds the email field, and an email-less user seeds it empty", async () => {
    const { result } = await mounted(createFakeUsersPort({}, { users: [base] }));
    act(() => result.current.toggleExpanded(base));
    expect(result.current.expandedId).toBe(base.principalId);
    expect(result.current.editEmail).toBe("alice@example.com");
    const { email: _omitted, ...withoutEmail } = base;
    act(() => result.current.toggleExpanded(withoutEmail));
    expect(result.current.expandedId).toBeNull();
    expect(result.current.editEmail).toBe("");
  });
});

describe("useUsers pins — email and status failures", () => {
  it("onSaveEmail shows the port's error message on the shared grant error slot", async () => {
    const port = createFakeUsersPort({}, { users: [base], updateUserError: new Error("email taken") });
    const { result } = await mounted(port);
    await act(async () => result.current.onSaveEmail({ principalId: base.principalId }));
    expect(result.current.grantError).toBe("email taken");
    expect(result.current.emailSaving).toBe(false);
  });

  it("onSaveEmail reports emailSaving while the write is in flight", async () => {
    const port = createFakeUsersPort({}, { users: [base] });
    const write = deferred<{ user: AdminIdentityUser }>();
    port.updateUser = () => write.promise;
    const { result } = await mounted(port);
    let save!: Promise<void>;
    act(() => { save = result.current.onSaveEmail({ principalId: base.principalId }); });
    await waitFor(() => expect(result.current.emailSaving).toBe(true));
    await act(async () => { write.resolve({ user: base }); await save; });
    expect(result.current.emailSaving).toBe(false);
  });

  it("onToggleStatus shows the port's error message and clears the busy row", async () => {
    const port = createFakeUsersPort({}, { users: [base, CALLER], meId: "caller", toggleStatusError: new Error("status refused") });
    const { result } = await mounted(port);
    await waitFor(() => expect(result.current.ownProfile).toEqual(CALLER));
    await act(async () => result.current.onToggleStatus(base));
    expect(result.current.toggleError).toBe("status refused");
    expect(result.current.toggleSavingId).toBeNull();
  });

  it("onToggleStatus enables a disabled user", async () => {
    const disabled = { ...base, status: "disabled" as const };
    const port = createFakeUsersPort({}, { users: [disabled, CALLER], meId: "caller" });
    const { result } = await mounted(port);
    await waitFor(() => expect(result.current.ownProfile).toEqual(CALLER));
    await act(async () => result.current.onToggleStatus(disabled));
    expect(port.users[0]!.status).toBe("active");
  });
});

describe("useUsers pins — permission before the roster loads", () => {
  it("allows renaming an ordinary user while roles are still unloaded", async () => {
    const port = portWith({ users: [CALLER, TARGET], meId: "caller" }, ["*"]);
    port.listUsers = () => new Promise(() => {});
    const { result } = renderHook(() => useUsers({ port, translate, queryScope: "w" }), { wrapper });
    await waitFor(() => expect(result.current.canRenameUser?.(TARGET)).toBe(true));
    expect(result.current.roles).toBeNull();
    expect(result.current.canRenameUser?.({ ...TARGET, isOwner: true })).toBe(false);
  });

  it("a caller outside the roster may rename an ordinary user but not an owner", async () => {
    const { result } = await mounted(portWith({ users: [TARGET], meId: "elsewhere" }, ["*"]));
    await waitFor(() => expect(result.current.canRenameUser?.(TARGET)).toBe(true));
    expect(result.current.canRenameUser?.({ ...TARGET, isOwner: true })).toBe(false);
  });
});

describe("useUsers pins — dialog guards", () => {
  it("the deep link does not open a dialog when the caller's row is not in the roster", async () => {
    const { result } = await mounted(createFakeUsersPort({}, { users: [TARGET], meId: "elsewhere" }), { openOwnPasswordReset: true });
    await waitFor(() => expect(result.current.canManageUserTrash).toBe(true));
    expect(result.current.resetPasswordFor).toBeNull();
  });

  it("refuses to open the reset dialog while a status toggle is in flight", async () => {
    const port = createFakeUsersPort({}, { users: [TARGET, CALLER], meId: "caller" });
    const write = deferred<{ user: AdminIdentityUser }>();
    port.disableUser = () => write.promise;
    const { result } = await mounted(port);
    await waitFor(() => expect(result.current.ownProfile).toEqual(CALLER));
    let toggle!: Promise<void>;
    act(() => { toggle = result.current.onToggleStatus(TARGET); });
    expect(result.current.toggleSavingId).toBe("target");
    act(() => result.current.openResetPassword(TARGET));
    expect(result.current.resetPasswordFor).toBeNull();
    await act(async () => { write.resolve({ user: { ...TARGET, status: "disabled" } }); await toggle; });
  });

  it("refuses to open a second reset dialog while a reset is saving", async () => {
    const other = { ...TARGET, principalId: "other", username: "other" };
    const port = createFakeUsersPort({}, { users: [TARGET, other, CALLER], meId: "caller" });
    const write = deferred<void>();
    port.resetUserPassword = () => write.promise;
    const { result } = await mounted(port);
    await waitFor(() => expect(result.current.ownProfile).toEqual(CALLER));
    act(() => result.current.openResetPassword(TARGET));
    act(() => result.current.setNewPassword("new-pass-1"));
    let reset!: Promise<void>;
    act(() => { reset = result.current.confirmResetPassword(); });
    await waitFor(() => expect(result.current.passwordSaving).toBe(true));
    act(() => result.current.openResetPassword(other));
    expect(result.current.resetPasswordFor).toEqual(TARGET);
    await act(async () => { write.resolve(); await reset; });
    expect(result.current.resetPasswordFor).toBeNull();
  });

  it("an overlapping toggle on another row keeps that row busy when the first settles", async () => {
    const other = { ...TARGET, principalId: "other", username: "other" };
    const port = createFakeUsersPort({}, { users: [TARGET, other, CALLER], meId: "caller" });
    const first = deferred<{ user: AdminIdentityUser }>();
    const second = deferred<{ user: AdminIdentityUser }>();
    port.disableUser = ({ principalId }) => (principalId === "target" ? first.promise : second.promise);
    const { result } = await mounted(port);
    await waitFor(() => expect(result.current.ownProfile).toEqual(CALLER));
    let a!: Promise<void>;
    let b!: Promise<void>;
    act(() => { a = result.current.onToggleStatus(TARGET); });
    act(() => { b = result.current.onToggleStatus(other); });
    expect(result.current.toggleSavingId).toBe("other");
    await act(async () => { first.resolve({ user: { ...TARGET, status: "disabled" } }); await a; });
    expect(result.current.toggleSavingId).toBe("other");
    await act(async () => { second.resolve({ user: { ...other, status: "disabled" } }); await b; });
    expect(result.current.toggleSavingId).toBeNull();
  });

  it("confirmDisable with no pending confirmation calls nothing", async () => {
    const port = createFakeUsersPort({}, { users: [TARGET, CALLER], meId: "caller" });
    let calls = 0;
    port.disableUser = async () => { calls += 1; return { user: TARGET }; };
    const { result } = await mounted(port);
    await act(async () => result.current.confirmDisable());
    expect(calls).toBe(0);
  });

  it("confirmDisable disables the confirmed user and closes its dialog", async () => {
    const port = createFakeUsersPort({}, { users: [TARGET, CALLER], meId: "caller" });
    const { result } = await mounted(port);
    await waitFor(() => expect(result.current.ownProfile).toEqual(CALLER));
    act(() => result.current.requestDisable(TARGET));
    expect(result.current.confirmingDisable).toEqual(TARGET);
    await act(async () => result.current.confirmDisable());
    expect(port.users[0]!.status).toBe("disabled");
    expect(result.current.confirmingDisable).toBeNull();
  });

  it("a disable confirmation cancelled while its toggle is in flight stays closed", async () => {
    const port = createFakeUsersPort({}, { users: [TARGET, CALLER], meId: "caller" });
    const write = deferred<{ user: AdminIdentityUser }>();
    port.disableUser = () => write.promise;
    const { result } = await mounted(port);
    await waitFor(() => expect(result.current.ownProfile).toEqual(CALLER));
    act(() => result.current.requestDisable(TARGET));
    let confirm!: Promise<void>;
    act(() => { confirm = result.current.confirmDisable(); });
    act(() => result.current.setConfirmingDisable(null));
    await act(async () => { write.resolve({ user: { ...TARGET, status: "disabled" } }); await confirm; });
    expect(result.current.confirmingDisable).toBeNull();
  });

  it("a delete confirmation replaced while its delete is in flight keeps the newer one open", async () => {
    const other = { ...TARGET, principalId: "other", username: "other" };
    const port = createFakeUsersPort({}, { users: [TARGET, other, CALLER], meId: "caller" });
    const write = deferred<void>();
    port.deleteUser = () => write.promise;
    const { result } = await mounted(port);
    await waitFor(() => expect(result.current.ownProfile).toEqual(CALLER));
    act(() => result.current.requestDelete(TARGET));
    let confirm!: Promise<void>;
    act(() => { confirm = result.current.confirmDelete(); });
    act(() => result.current.requestDelete(other));
    await act(async () => { write.resolve(); await confirm; });
    expect(result.current.confirmingDelete).toEqual(other);
  });

  it("a delete confirmation cancelled while its delete is in flight stays closed", async () => {
    const port = createFakeUsersPort({}, { users: [TARGET, CALLER], meId: "caller" });
    const write = deferred<void>();
    port.deleteUser = () => write.promise;
    const { result } = await mounted(port);
    await waitFor(() => expect(result.current.ownProfile).toEqual(CALLER));
    act(() => result.current.requestDelete(TARGET));
    let confirm!: Promise<void>;
    act(() => { confirm = result.current.confirmDelete(); });
    act(() => result.current.setConfirmingDelete(null));
    await act(async () => { write.resolve(); await confirm; });
    expect(result.current.confirmingDelete).toBeNull();
  });
});

