import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FetchQueryProvider } from "@jini-ai/ui/panel-kit";
import { Users, useUsers, userAccountCapabilities, isOwnerAccount, userRowMenuItems, formatGrantLabel } from "../../index.js";
import { createFakeUsersPort } from "../../testing.js";
import type { AdminIdentityUser } from "../../models.js";

const translate = (key: string) => key;
const owner: AdminIdentityUser = { principalId: "owner", workspaceId: "w", username: "admin", status: "active",
  createdAt: "now", roleIds: ["owner-role"], policyIds: [], isOwner: true, isProtectedAccount: true };
const ordinary: AdminIdentityUser = { ...owner, principalId: "ordinary", username: "alice", roleIds: [], isOwner: false, isProtectedAccount: false };
const role = { id: "owner-role", workspaceId: "w", name: "owner", isBuiltin: true };
const handlers = { onRequestDisable() {}, onEnable() {}, onManage() {}, onResetPassword() {}, onRequestDelete() {} };
function wrapper({ children }: { children: React.ReactNode }) { return <FetchQueryProvider>{children}</FetchQueryProvider>; }

// Owner/self protections are courtesy mirrors. The host's server remains the authorization boundary.
describe("account row capabilities", () => {
  it("owner's own row only offers Manage and Reset password", () => {
    const capabilities = userAccountCapabilities({ user: owner, callerPrincipalId: "owner", callerIsOwner: true,
      canManageUserTrash: true, roles: new Map() });
    expect(capabilities).toEqual({ canDelete: false, canDisable: false, canEnable: true, canResetPassword: true });
    expect(userRowMenuItems({ user: owner, toggleSaving: false, handlers, translate, canDelete: true, capabilities }).map(i => i.key))
      .toEqual(["manage", "reset-password"]);
  });
  it("non-owner has no Delete, Disable or Reset password on protected rows", () => {
    const capabilities = userAccountCapabilities({ user: owner, callerPrincipalId: "admin-caller", callerIsOwner: false,
      canManageUserTrash: true, roles: new Map() });
    expect(userRowMenuItems({ user: owner, toggleSaving: false, handlers, translate, canDelete: true, capabilities }).map(i => i.key))
      .toEqual(["manage"]);
  });
  it("owner can act on another admin", () => {
    expect(userAccountCapabilities({ user: owner, callerPrincipalId: "another-owner", callerIsOwner: true,
      canManageUserTrash: true, roles: new Map() }))
      .toEqual({ canDelete: true, canDisable: true, canEnable: true, canResetPassword: true });
  });
  it("admin caller cannot act on protected targets, including owners granted by policy", () => {
    for (const user of [owner, { ...owner, roleIds: [] }]) {
      expect(userAccountCapabilities({ user, callerPrincipalId: "admin-caller", callerIsOwner: false,
        canManageUserTrash: true, roles: new Map() }))
        .toEqual({ canDelete: false, canDisable: false, canEnable: false, canResetPassword: false });
    }
  });
  it("admin may act on ordinary users; unknown caller/role fails closed", () => {
    expect(userAccountCapabilities({ user: ordinary, callerPrincipalId: "admin-caller", callerIsOwner: false,
      canManageUserTrash: true, roles: new Map() }))
      .toEqual({ canDelete: true, canDisable: true, canEnable: true, canResetPassword: true });
    // The server classification remains authoritative when grant options are unavailable.
    expect(userAccountCapabilities({ user: { ...ordinary, roleIds: ["unknown"] }, callerPrincipalId: "admin-caller",
      callerIsOwner: false, canManageUserTrash: true, roles: new Map() }))
      .toEqual({ canDelete: true, canDisable: true, canEnable: true, canResetPassword: true });
    // Omit the server classification to exercise the legacy unknown-role fallback.
    for (const user of [ordinary, { ...ordinary, isProtectedAccount: undefined, roleIds: ["unknown"] }]) {
      expect(userAccountCapabilities({ user, callerPrincipalId: user === ordinary ? null : "admin-caller",
        callerIsOwner: false, canManageUserTrash: true, roles: new Map() }))
        .toEqual({ canDelete: false, canDisable: false, canEnable: false, canResetPassword: false });
    }
  });
  it("Owner badge uses server owner classification or builtin role; never username", () => {
    expect(isOwnerAccount({ user: { ...owner, roleIds: [] }, roles: new Map() })).toBe(true);
    expect(isOwnerAccount({ user: { ...ordinary, username: "admin" }, roles: new Map() })).toBe(false);
    expect(isOwnerAccount({ user: { ...owner, isOwner: undefined }, roles: new Map([[role.id, role]]) })).toBe(true);
    expect(formatGrantLabel({ ids: [role.id], byId: new Map([[role.id, role]]), translate })).toBe("Owner");
    expect(formatGrantLabel({ ids: [role.id], byId: new Map([[role.id, { ...role, isBuiltin: false }]]), translate })).toBe("owner");
  });
});

it("rendered owner row keeps admin login, shows Owner badge, and hides Delete/Disable", async () => {
  const port = createFakeUsersPort({}, { users: [owner], roles: [role], meId: "owner" });
  render(<FetchQueryProvider><Users port={port} translate={translate} queryScope="w" /></FetchQueryProvider>);
  await waitFor(() => expect(screen.getAllByText("Owner").length).toBeGreaterThanOrEqual(2));
  expect(screen.getByRole("button", { name: "admin" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: 'Actions for user "admin"' }));
  await screen.findByRole("menuitem", { name: "Reset password" });
  expect(screen.queryByRole("menuitem", { name: "Delete" })).toBeNull();
  expect(screen.queryByRole("menuitem", { name: "Disable" })).toBeNull();
});
it("rendered admin sees only Manage on an owner target", async () => {
  const port = createFakeUsersPort({}, { users: [owner], roles: [role], meId: "another-admin" });
  render(<FetchQueryProvider><Users port={port} translate={translate} queryScope="w" /></FetchQueryProvider>);
  await screen.findByRole("button", { name: "admin" });
  fireEvent.click(screen.getByRole("button", { name: 'Actions for user "admin"' }));
  expect(screen.getByRole("menuitem", { name: "Manage" })).toBeTruthy();
  for (const name of ["Delete", "Disable", "Reset password"]) expect(screen.queryByRole("menuitem", { name })).toBeNull();
});
it("direct controller calls cannot bypass protected targets or destructive self guards", async () => {
  const port = createFakeUsersPort({}, { users: [owner, ordinary], roles: [role], meId: ordinary.principalId });
  const disable = vi.spyOn(port, "disableUser"), remove = vi.spyOn(port, "deleteUser"), reset = vi.spyOn(port, "resetUserPassword");
  const { result } = renderHook(() => useUsers({ port, translate, queryScope: "w" }), { wrapper });
  await waitFor(() => expect(result.current.canManageUserTrash).toBe(true));
  await waitFor(() => expect(result.current.users).not.toBeNull());
  for (const target of [owner, ordinary]) {
    act(() => { result.current.requestDisable(target); result.current.requestDelete(target); });
    expect(result.current.confirmingDisable).toBeNull();
    expect(result.current.confirmingDelete).toBeNull();
    await act(async () => result.current.onToggleStatus(target));
  }
  act(() => result.current.openResetPassword(owner));
  expect(result.current.resetPasswordFor).toBeNull();
  act(() => { result.current.setResetPasswordFor(owner); result.current.setNewPassword("new-pass"); result.current.setConfirmingDelete(owner); });
  await act(async () => { await result.current.confirmResetPassword(); await result.current.confirmDelete(); });
  expect(disable).not.toHaveBeenCalled(); expect(remove).not.toHaveBeenCalled(); expect(reset).not.toHaveBeenCalled();
});
it.each(["listRoles", "listPolicies"] as const)("403 from %s keeps the roster and hides grant columns", async method => {
  const port = createFakeUsersPort({}, { users: [owner], roles: [role], meId: "another-admin" });
  port[method] = vi.fn().mockRejectedValue(Object.assign(new Error("forbidden"), { status: 403 }));
  render(<FetchQueryProvider><Users port={port} translate={translate} queryScope="w" /></FetchQueryProvider>);
  await screen.findByRole("button", { name: "admin" });
  expect(screen.queryByRole("columnheader", { name: "Roles" })).toBeNull();
  expect(screen.queryByRole("columnheader", { name: "Policies" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "admin" }));
  expect(screen.queryByLabelText("Assign role")).toBeNull();
  expect(screen.queryByLabelText("Attach policy")).toBeNull();
  expect(screen.getByRole("textbox")).toBeTruthy();
});
it("a grant service outage still reports a page error", async () => {
  const port = createFakeUsersPort({}, { users: [ordinary] });
  port.listRoles = vi.fn().mockRejectedValue(new Error("network down"));
  const { result } = renderHook(() => useUsers({ port, translate, queryScope: "w" }), { wrapper });
  await waitFor(() => expect(result.current.error).toBe("network down"));
  expect(result.current.users).toBeNull();
});
it("self reset uses the sign-in notice and closes the deep link once", async () => {
  const port = createFakeUsersPort({}, { users: [owner], meId: "owner" });
  const closed = vi.fn();
  const { result } = renderHook(() => useUsers({ port, translate, queryScope: "w" }, {
    openOwnPasswordReset: true, onOwnPasswordResetClosed: closed,
  }), { wrapper });
  await waitFor(() => expect(result.current.resetPasswordFor).toEqual(owner));
  act(() => result.current.setNewPassword("new-pass"));
  await act(async () => result.current.confirmResetPassword());
  expect(result.current.notice).toBe("Password changed. Sign in again with your new password.");
  expect(result.current.newPassword).toBe(""); expect(closed).toHaveBeenCalledTimes(1);
});
it("host password-result copy changes the notice; removing the port restores the shared fallback", async () => {
  const port = createFakeUsersPort({}, { users: [ordinary], meId: "another-admin" });
  const { result, rerender } = renderHook(({ host }: { host: boolean }) => useUsers({ port, translate, queryScope: "w" },
    host ? { passwordResetNotice: ({ username }) => `Restablecido para ${username}.` } : {}), { wrapper, initialProps: { host: true } });
  await waitFor(() => expect(result.current.rowCapabilities(ordinary).canResetPassword).toBe(true));
  act(() => result.current.openResetPassword(ordinary)); act(() => result.current.setNewPassword("new-pass"));
  await act(async () => result.current.confirmResetPassword());
  expect(result.current.notice).toBe("Restablecido para alice.");
  rerender({ host: false });
  act(() => result.current.openResetPassword(ordinary)); act(() => result.current.setNewPassword("another-pass"));
  await act(async () => result.current.confirmResetPassword());
  expect(result.current.notice).toBe('Password reset for "alice" — every active session for this user was revoked.');
});
it("failed password reset keeps its dialog and draft for retry", async () => {
  const port = createFakeUsersPort({}, { users: [ordinary], meId: "another-admin", resetPasswordError: new Error("cannot reset") });
  const { result } = renderHook(() => useUsers({ port, translate, queryScope: "w" }), { wrapper });
  await waitFor(() => expect(result.current.rowCapabilities(ordinary).canResetPassword).toBe(true));
  act(() => result.current.openResetPassword(ordinary)); act(() => result.current.setNewPassword("new-pass"));
  await act(async () => result.current.confirmResetPassword());
  expect(result.current.resetPasswordFor).toEqual(ordinary); expect(result.current.newPassword).toBe("new-pass");
  expect(result.current.passwordError).toBe("cannot reset"); expect(result.current.notice).toBeNull();
});
it("host status rendering changes the cell; removing the slot restores the shared translation", async () => {
  const port = createFakeUsersPort({}, { users: [ordinary], meId: "another-admin" });
  const { rerender } = render(<FetchQueryProvider><Users port={port} translate={translate} queryScope="w"
    renderServerLabel={() => <span>Active label</span>} /></FetchQueryProvider>);
  await screen.findByText("Active label");
  expect(screen.queryByText("active")).toBeNull();
  rerender(<FetchQueryProvider><Users port={port} translate={translate} queryScope="w" /></FetchQueryProvider>);
  expect(screen.getByText("active")).toBeTruthy();
  expect(screen.queryByText("Active label")).toBeNull();
});
