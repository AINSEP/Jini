import { StrictMode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FetchQueryProvider } from "@jini-ai/ui/panel-kit";
import type { AdminIdentityUser, AdminPolicyPermission } from "../../models.js";
import { createFakeUsersPort, createFakeRolesPort } from "../../testing.js";
import { useUsers } from "../hooks/use-users.hooks.js";
const translate = (key: string) => key;
const fetchMock = vi.fn(() => { throw new Error("unexpected transport call"); });
beforeEach(() => { vi.stubGlobal("fetch", fetchMock); });
afterEach(() => { vi.unstubAllGlobals(); fetchMock.mockClear(); });
function wrapper({ children }: { children: React.ReactNode }) { return <FetchQueryProvider>{children}</FetchQueryProvider>; }
const USER_A = {
  principalId: "u1",
  workspaceId: "w1",
  username: "alice",
  email: "alice@example.com",
  status: "active" as const,
  createdAt: "2026-08-01T00:00:00.000Z",
  roleIds: [] as string[],
  policyIds: [] as string[],
};
const USER_B = {
  principalId: "u2",
  workspaceId: "w1",
  username: "bob",
  email: "bob@example.com",
  status: "active" as const,
  createdAt: "2026-08-01T00:00:00.000Z",
  roleIds: [] as string[],
  policyIds: [] as string[],
};
const ROLE = { id: "r1", workspaceId: "w1", name: "Editor", isBuiltin: false };
const POLICY = { id: "p1", workspaceId: "w1", name: "Content", description: "d", isBuiltin: false, isFrozen: false };
describe("injected port (useX(dependencies) / useWiredX() conversion coverage)", () => {

  it("loads users, roles, and policies through the injected port, without touching fetch", async () => {
    const port = createFakeUsersPort({}, { users: [USER_A], roles: [ROLE], policies: [POLICY] });
    const { result } = renderHook(() => useUsers({ port, translate, queryScope: "w1" }), { wrapper });
    await waitFor(() => expect(result.current.users).not.toBeNull());

    expect(result.current.users).toEqual([USER_A]);
    expect(result.current.roles).toEqual([ROLE]);
    expect(result.current.policies).toEqual([POLICY]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("onCreate writes through the injected port and the list reflects the new user", async () => {
    const port = createFakeUsersPort({}, { users: [USER_A], roles: [ROLE], policies: [POLICY] });
    const { result } = renderHook(() => useUsers({ port, translate, queryScope: "w1" }), { wrapper });
    await waitFor(() => expect(result.current.users).not.toBeNull());

    act(() => {
      result.current.setUsername("carol");
      result.current.setPassword("hunter22");
    });
    await act(async () => {
      await result.current.onCreate({ preventDefault: () => {} } as unknown as React.FormEvent);
    });

    expect(port.users).toHaveLength(2);
    await waitFor(() => expect(result.current.users).toHaveLength(2));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("onToggleStatus disables an active user through the injected port", async () => {
    const port = createFakeUsersPort({}, { users: [USER_A], roles: [ROLE], policies: [POLICY] });
    const { result } = renderHook(() => useUsers({ port, translate, queryScope: "w1" }), { wrapper });
    await waitFor(() => expect(result.current.users).not.toBeNull());

    await act(async () => {
      await result.current.onToggleStatus(USER_A);
    });

    expect(port.users[0]!.status).toBe("disabled");
    await waitFor(() => expect(result.current.users?.[0]?.status).toBe("disabled"));
  });

  it("passes the selected principal and draft values to injected mutation ports", async () => {
    const port = createFakeUsersPort({}, { users: [USER_A, USER_B], roles: [ROLE], policies: [POLICY] });
    const assign = vi.spyOn(port, "assignRole");
    const attach = vi.spyOn(port, "attachPolicy");
    const update = vi.spyOn(port, "updateUser");
    const reset = vi.spyOn(port, "resetUserPassword");
    const { result } = renderHook(() => useUsers({ port, translate, queryScope: "w1" }), { wrapper });
    await waitFor(() => expect(result.current.users).not.toBeNull());

    act(() => result.current.setPendingRoleId(ROLE.id));
    await act(async () => result.current.onAssignRole({ principalId: USER_B.principalId }));
    expect(assign).toHaveBeenCalledWith({ principalId: USER_B.principalId, roleId: ROLE.id });

    act(() => result.current.setPendingPolicyId(POLICY.id));
    await act(async () => result.current.onAttachPolicy({ principalId: USER_B.principalId }));
    expect(attach).toHaveBeenCalledWith({ principalId: USER_B.principalId, policyId: POLICY.id });

    act(() => result.current.setEditEmail("bob+edited@example.com"));
    await act(async () => result.current.onSaveEmail({ principalId: USER_B.principalId }));
    expect(update).toHaveBeenCalledWith({ principalId: USER_B.principalId }, { email: "bob+edited@example.com" });

    act(() => result.current.openResetPassword(USER_B));
    act(() => result.current.setNewPassword("newpass1"));
    await act(async () => result.current.confirmResetPassword());
    expect(reset).toHaveBeenCalledWith({ principalId: USER_B.principalId, password: "newpass1" });
  });

  it("onAssignRole sets grantError from the injected port's configured failure", async () => {
    const port = createFakeUsersPort({}, {
      users: [USER_A],
      roles: [ROLE],
      policies: [POLICY],
      assignRoleError: new Error("boom"),
    });
    const { result } = renderHook(() => useUsers({ port, translate, queryScope: "w1" }), { wrapper });
    await waitFor(() => expect(result.current.users).not.toBeNull());

    act(() => result.current.setPendingRoleId(ROLE.id));
    await act(async () => {
      await result.current.onAssignRole({ principalId: USER_A.principalId });
    });

    expect(result.current.grantError).toBe("boom");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  describe("requestDelete / confirmDelete — ConfirmDialog gate", () => {
    it("canManageUserTrash resolves from the injected port's me()", async () => {
      const port = createFakeUsersPort({}, { users: [USER_A], roles: [ROLE], policies: [POLICY], canManageUserTrash: true });
      const { result } = renderHook(() => useUsers({ port, translate, queryScope: "w1" }), { wrapper });
      await waitFor(() => expect(result.current.canManageUserTrash).toBe(true));
    });

    it("confirmDelete calls the fake deleteUser once and closes the dialog", async () => {
      const port = createFakeUsersPort({}, { users: [USER_A], roles: [ROLE], policies: [POLICY] });
      const spy = vi.spyOn(port, "deleteUser");
      const { result } = renderHook(() => useUsers({ port, translate, queryScope: "w1" }), { wrapper });
      await waitFor(() => expect(result.current.users).not.toBeNull());

      act(() => result.current.requestDelete(USER_A));
      expect(result.current.confirmingDelete).toEqual(USER_A);

      await act(async () => {
        await result.current.confirmDelete();
      });

      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy).toHaveBeenCalledWith({ principalId: USER_A.principalId });
      expect(result.current.confirmingDelete).toBeNull();
      await waitFor(() => expect(result.current.users).toEqual([]));
    });

    it("on failure, sets toggleError and still closes the dialog", async () => {
      const port = createFakeUsersPort({}, {
        users: [USER_A],
        roles: [ROLE],
        policies: [POLICY],
        deleteUserError: new Error("cannot delete"),
      });
      const { result } = renderHook(() => useUsers({ port, translate, queryScope: "w1" }), { wrapper });
      await waitFor(() => expect(result.current.users).not.toBeNull());

      act(() => result.current.requestDelete(USER_A));
      await act(async () => {
        await result.current.confirmDelete();
      });

      expect(result.current.confirmingDelete).toBeNull();
      expect(result.current.toggleError).toBe("cannot delete");
    });

    it("confirmDelete is a no-op with nothing pending", async () => {
      const port = createFakeUsersPort({}, { users: [USER_A], roles: [ROLE], policies: [POLICY] });
      const spy = vi.spyOn(port, "deleteUser");
      const { result } = renderHook(() => useUsers({ port, translate, queryScope: "w1" }), { wrapper });
      await waitFor(() => expect(result.current.users).not.toBeNull());

      await act(async () => {
        await result.current.confirmDelete();
      });
      expect(spy).not.toHaveBeenCalled();
    });
  });

  it("onAssignRole: a stale success settling after the operator switched panels and picked a NEW role must not clear it", async () => {
    let resolveA!: (v: { assignment: unknown }) => void;
    const port = createFakeUsersPort({}, { users: [USER_A, USER_B], roles: [ROLE], policies: [POLICY] });
    port.assignRole = vi.fn(() => new Promise<{ assignment: unknown }>((resolve) => { resolveA = resolve; }));

    const { result } = renderHook(() => useUsers({ port, translate, queryScope: "w1" }), { wrapper });
    await waitFor(() => expect(result.current.users).not.toBeNull());

    act(() => result.current.toggleExpanded(USER_A));
    act(() => result.current.setPendingRoleId(ROLE.id));
    act(() => {
      void result.current.onAssignRole({ principalId: USER_A.principalId });
    });
    await waitFor(() => expect(port.assignRole).toHaveBeenCalledTimes(1));

    act(() => result.current.toggleExpanded(USER_B));
    act(() => result.current.setPendingRoleId("some-other-role"));
    expect(result.current.pendingRoleId).toBe("some-other-role");

    await act(async () => {
      resolveA({ assignment: {} });
    });
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(result.current.pendingRoleId).toBe("some-other-role");
  });

  it("confirmDisable: a stale settlement after the operator opened a DIFFERENT user's confirm dialog must not silently close it", async () => {
    let resolveA!: (v: { user: AdminIdentityUser }) => void;
    const port = createFakeUsersPort({}, { users: [USER_A, USER_B], roles: [ROLE], policies: [POLICY] });
    port.disableUser = vi.fn(() => new Promise<{ user: AdminIdentityUser }>((resolve) => { resolveA = resolve; }));

    const { result } = renderHook(() => useUsers({ port, translate, queryScope: "w1" }), { wrapper });
    await waitFor(() => expect(result.current.users).not.toBeNull());

    act(() => result.current.requestDisable(USER_A));
    act(() => {
      void result.current.confirmDisable();
    });
    await waitFor(() => expect(port.disableUser).toHaveBeenCalledTimes(1));

    act(() => result.current.requestDisable(USER_B));
    expect(result.current.confirmingDisable).toEqual(USER_B);

    await act(async () => {
      resolveA({ user: { ...USER_A, status: "disabled" as const } });
    });
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(result.current.confirmingDisable).toEqual(USER_B);
  });

  it("onAssignRole: a stale failure settling after the operator switched panels must not show on the new panel", async () => {
    let rejectA!: (e: unknown) => void;
    const port = createFakeUsersPort({}, { users: [USER_A, USER_B], roles: [ROLE], policies: [POLICY] });
    port.assignRole = vi.fn(() => new Promise<{ assignment: unknown }>((_resolve, reject) => { rejectA = reject; }));

    const { result } = renderHook(() => useUsers({ port, translate, queryScope: "w1" }), { wrapper });
    await waitFor(() => expect(result.current.users).not.toBeNull());

    act(() => result.current.toggleExpanded(USER_A));
    act(() => result.current.setPendingRoleId(ROLE.id));
    let p!: Promise<void>;
    act(() => {
      p = result.current.onAssignRole({ principalId: USER_A.principalId });
    });
    await waitFor(() => expect(port.assignRole).toHaveBeenCalledTimes(1));

    act(() => result.current.toggleExpanded(USER_B));

    rejectA(new Error("boom-A"));
    await act(async () => {
      await p;
    });

    expect(result.current.grantError).toBeNull();
  });

  it("onAssignRole: a stale grant's finally must not clear the saving flag of a newer grant still in flight on another panel", async () => {
    let rejectA!: (e: unknown) => void;
    let resolveB!: (v: { assignment: unknown }) => void;
    const port = createFakeUsersPort({}, { users: [USER_A, USER_B], roles: [ROLE], policies: [POLICY] });
    port.assignRole = vi
      .fn()
      .mockImplementationOnce(() => new Promise<{ assignment: unknown }>((_resolve, reject) => { rejectA = reject; }))
      .mockImplementationOnce(() => new Promise<{ assignment: unknown }>((resolve) => { resolveB = resolve; }));

    const { result } = renderHook(() => useUsers({ port, translate, queryScope: "w1" }), { wrapper });
    await waitFor(() => expect(result.current.users).not.toBeNull());

    act(() => result.current.toggleExpanded(USER_A));
    act(() => result.current.setPendingRoleId(ROLE.id));
    let pA!: Promise<void>;
    act(() => {
      pA = result.current.onAssignRole({ principalId: USER_A.principalId });
    });
    await waitFor(() => expect(port.assignRole).toHaveBeenCalledTimes(1));

    act(() => result.current.toggleExpanded(USER_B));
    act(() => result.current.setPendingRoleId(ROLE.id));
    let pB!: Promise<void>;
    act(() => {
      pB = result.current.onAssignRole({ principalId: USER_B.principalId });
    });
    await waitFor(() => expect(port.assignRole).toHaveBeenCalledTimes(2));
    expect(result.current.grantSaving).toBe(true);

    rejectA(new Error("boom-A"));
    await act(async () => {
      await pA;
    });
    expect(result.current.grantSaving).toBe(true);

    await act(async () => {
      resolveB({ assignment: {} });
      await pB;
    });
    expect(result.current.grantSaving).toBe(false);
  });

  it("toggleExpanded: switching panels mid-grant clears the saving flag, and the stale grant's settle leaves it cleared", async () => {
    let resolveA!: (v: { assignment: unknown }) => void;
    const port = createFakeUsersPort({}, { users: [USER_A, USER_B], roles: [ROLE], policies: [POLICY] });
    port.assignRole = vi.fn(() => new Promise<{ assignment: unknown }>((resolve) => { resolveA = resolve; }));

    const { result } = renderHook(() => useUsers({ port, translate, queryScope: "w1" }), { wrapper });
    await waitFor(() => expect(result.current.users).not.toBeNull());

    act(() => result.current.toggleExpanded(USER_A));
    act(() => result.current.setPendingRoleId(ROLE.id));
    let pA!: Promise<void>;
    act(() => {
      pA = result.current.onAssignRole({ principalId: USER_A.principalId });
    });
    await waitFor(() => expect(port.assignRole).toHaveBeenCalledTimes(1));
    expect(result.current.grantSaving).toBe(true);

    act(() => result.current.toggleExpanded(USER_B));
    expect(result.current.grantSaving).toBe(false);

    await act(async () => {
      resolveA({ assignment: {} });
      await pA;
    });
    expect(result.current.grantSaving).toBe(false);
  });
});

describe("openOwnPasswordReset deep link (password-banner plan, 2026-09-24 Slice 3)", () => {
  it("auto-opens the reset dialog on the caller's OWN row (from me()), not another row", async () => {
    const port = createFakeUsersPort({}, { users: [USER_A, USER_B], roles: [ROLE], policies: [POLICY], meId: USER_B.principalId });
    const { result } = renderHook(() => useUsers({ port, translate, queryScope: "w1" }, { openOwnPasswordReset: true }), { wrapper });
    await waitFor(() => expect(result.current.users).not.toBeNull());

    await waitFor(() => expect(result.current.resetPasswordFor).toEqual(USER_B));
  });

  it("does not auto-open the dialog when the flag is false (or omitted)", async () => {
    const port = createFakeUsersPort({}, { users: [USER_A, USER_B], roles: [ROLE], policies: [POLICY], meId: USER_B.principalId });
    const { result } = renderHook(() => useUsers({ port, translate, queryScope: "w1" }), { wrapper });
    await waitFor(() => expect(result.current.users).not.toBeNull());

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(result.current.resetPasswordFor).toBeNull();
  });

  it("navigates to /users once the deep-link-opened dialog closes", async () => {
    const port = createFakeUsersPort({}, { users: [USER_A, USER_B], roles: [ROLE], policies: [POLICY], meId: USER_B.principalId });
    const navigate = vi.fn();
    const { result } = renderHook(() => useUsers({ port, translate, queryScope: "w1" }, { openOwnPasswordReset: true, onOwnPasswordResetClosed: () => navigate("/users") }), { wrapper });
    await waitFor(() => expect(result.current.resetPasswordFor).toEqual(USER_B));

    act(() => result.current.setResetPasswordFor(null));

    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/users"));
  });

  it("does NOT navigate when a normal (non-deep-link) reset dialog is opened and closed", async () => {
    const port = createFakeUsersPort({}, { users: [USER_A, USER_B], roles: [ROLE], policies: [POLICY] });
    const navigate = vi.fn();
    const { result } = renderHook(() => useUsers({ port, translate, queryScope: "w1" }, { onOwnPasswordResetClosed: () => navigate("/users") }), { wrapper });
    await waitFor(() => expect(result.current.users).not.toBeNull());

    act(() => result.current.openResetPassword(USER_A));
    act(() => result.current.setResetPasswordFor(null));

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(navigate).not.toHaveBeenCalled();
  });

  it("on a successful self-reset, sets the 'sign in again' notice instead of the per-username notice", async () => {
    const port = createFakeUsersPort({}, { users: [USER_A, USER_B], roles: [ROLE], policies: [POLICY], meId: USER_B.principalId });
    const { result } = renderHook(() => useUsers({ port, translate, queryScope: "w1" }, { openOwnPasswordReset: true }), { wrapper });
    await waitFor(() => expect(result.current.resetPasswordFor).toEqual(USER_B));

    act(() => result.current.setNewPassword("newpass1"));
    await act(async () => {
      await result.current.confirmResetPassword();
    });

    expect(result.current.notice).toBe("Password changed. Sign in again with your new password.");
    expect(result.current.notice).not.toContain(USER_B.username);
  });
});
