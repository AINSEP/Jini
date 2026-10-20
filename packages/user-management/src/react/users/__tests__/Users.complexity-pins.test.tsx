import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { createFakeUsersPort } from "../../testing.js";
import { Users, type UsersProps } from "../Users.js";
import type { UsersController } from "../hooks/use-users.hooks.js";
import type { ChangeUsernameController } from "../hooks/use-change-username.hooks.js";
import type { AdminIdentityUser, AdminPolicy, AdminRole } from "../../models.js";

/**
 * Characterization pins for `Users` and its per-row `UserRow` (complexity lot L182a). They drive the
 * screen through the injected `useUsersHook` seam with a hand-built, fully typed `UsersController`,
 * so every branch of the row and of `Users`' own composition is reachable without a network fake.
 */

const t = (key: string) => key;
const alice: AdminIdentityUser = { principalId: "alice", workspaceId: "w", username: "alice", email: "alice@example.test",
  status: "active", roleIds: ["r1"], policyIds: ["p1"], createdAt: "2026-10-01", isOwner: false };
const bob: AdminIdentityUser = { ...alice, principalId: "bob", username: "bob", email: undefined, status: "disabled",
  roleIds: [], policyIds: [] };
const roleR1: AdminRole = { id: "r1", workspaceId: "w", name: "editor", isBuiltin: true };
const policyP1: AdminPolicy = { id: "p1", workspaceId: "w", name: "read-only", isBuiltin: false, isFrozen: false };

function fakeController(overrides: Partial<UsersController> = {}): UsersController {
  const noop = vi.fn();
  const asyncNoop = vi.fn(async () => {});
  return {
    users: [alice, bob], roles: [roleR1], policies: [policyP1], canGrant: true, error: null,
    formOpen: false, setFormOpen: noop, username: "", setUsername: noop, email: "", setEmail: noop,
    password: "", setPassword: noop, saving: false, formError: null, onCreate: asyncNoop,
    expandedId: null, toggleExpanded: vi.fn(), pendingRoleId: "", setPendingRoleId: noop,
    pendingPolicyId: "", setPendingPolicyId: noop, grantSaving: false, grantError: null,
    onAssignRole: asyncNoop, onAttachPolicy: asyncNoop,
    editEmail: "", setEditEmail: noop, emailSaving: false, onSaveEmail: asyncNoop,
    toggleSavingId: null, toggleError: null, notice: null,
    confirmingDisable: null, setConfirmingDisable: noop, requestDisable: vi.fn(), confirmDisable: asyncNoop,
    onToggleStatus: vi.fn(async () => {}),
    resetPasswordFor: null, setResetPasswordFor: noop, newPassword: "", setNewPassword: noop,
    passwordSaving: false, passwordError: null, setPasswordError: noop, openResetPassword: vi.fn(),
    confirmResetPassword: asyncNoop,
    canManageUserTrash: false,
    rowCapabilities: () => ({ canDelete: false, canDisable: true, canEnable: true, canResetPassword: true }),
    ownProfile: null,
    confirmingDelete: null, setConfirmingDelete: noop, requestDelete: vi.fn(), deleteSaving: false, confirmDelete: asyncNoop,
    t, translate: t,
    ...overrides,
  };
}

function renderUsers(controller: UsersController, extra: Partial<UsersProps> = {}) {
  const port = createFakeUsersPort({}, {});
  return render(<Users useUsersHook={() => controller} port={port} translate={t} queryScope="w" {...extra} />);
}

function rowOf(username: string): HTMLTableRowElement {
  return screen.getByRole("button", { name: username }).closest("tr")!;
}

function openMenu(username: string) {
  fireEvent.click(screen.getByRole("button", { name: `Actions for user "${username}"` }));
}

describe("Users composition", () => {
  it("shows only the error notice when the controller reports an error", () => {
    const { container } = renderUsers(fakeController({ error: "Could not load users" }));
    expect(container.innerHTML).toBe('<div class="notice error">Could not load users</div>');
  });

  it.each([
    ["users", { users: null }],
    ["roles", { roles: null }],
    ["policies", { policies: null }],
  ] as const)("shows the loading notice while %s is still null", (_name, overrides) => {
    const { container } = renderUsers(fakeController(overrides));
    expect(container.innerHTML).toBe('<div class="notice">Loading users…</div>');
  });

  it("renders the new-user form only while formOpen", () => {
    renderUsers(fakeController({ formOpen: true }));
    expect(screen.getByRole("button", { name: "Create user" })).toBeInTheDocument();
  });

  it("omits the new-user form while closed", () => {
    renderUsers(fakeController());
    expect(screen.queryByRole("button", { name: "Create user" })).toBeNull();
  });

  it("marks the row matching ownProfile as the caller's own", () => {
    renderUsers(fakeController({ ownProfile: alice }));
    expect(rowOf("alice")).toHaveAttribute("aria-current", "true");
    expect(within(rowOf("alice")).getByText("(you)")).toBeInTheDocument();
    expect(rowOf("bob")).not.toHaveAttribute("aria-current");
  });

  it("marks no row as own when ownProfile is undefined", () => {
    const { ownProfile: _ownProfile, ...withoutOwnProfile } = fakeController();
    renderUsers(withoutOwnProfile);
    expect(screen.queryByText("(you)")).toBeNull();
    expect(rowOf("alice")).not.toHaveAttribute("aria-current");
  });

  it("gives the open Manage panel role and policy grant selects when canGrant", () => {
    renderUsers(fakeController({ expandedId: "alice" }));
    expect(screen.getByRole("option", { name: "editor (built-in)" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "read-only" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Assign" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Attach" })).toBeInTheDocument();
  });

  it("hands the Manage panel the grant pending ids, setters and submits from the controller", () => {
    const onAssignRole = vi.fn(async () => {});
    const onAttachPolicy = vi.fn(async () => {});
    const setPendingRoleId = vi.fn();
    renderUsers(fakeController({ expandedId: "alice", pendingRoleId: "r1", pendingPolicyId: "p1", onAssignRole,
      onAttachPolicy, setPendingRoleId }));
    fireEvent.click(screen.getByRole("button", { name: "Assign" }));
    fireEvent.click(screen.getByRole("button", { name: "Attach" }));
    fireEvent.change(screen.getAllByRole("combobox")[0]!, { target: { value: "" } });
    expect(onAssignRole).toHaveBeenCalledWith({ principalId: "alice" });
    expect(onAttachPolicy).toHaveBeenCalledWith({ principalId: "alice" });
    expect(setPendingRoleId).toHaveBeenCalledWith("");
  });

  it("hands the Manage panel the email editor and the shared grant error/saving", () => {
    const onSaveEmail = vi.fn(async () => {});
    renderUsers(fakeController({ expandedId: "alice", editEmail: "new@example.test", onSaveEmail,
      grantError: "Grant failed", grantSaving: true }));
    expect(screen.getByDisplayValue("new@example.test")).toBeInTheDocument();
    expect(screen.getByText("Grant failed")).toHaveClass("save-error");
    expect(screen.getAllByRole("button", { name: "Saving…" })).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "Save email" }));
    expect(onSaveEmail).toHaveBeenCalledWith({ principalId: "alice" });
  });

  it("gives the open Manage panel no grant selects without canGrant", () => {
    renderUsers(fakeController({ expandedId: "alice", canGrant: false }));
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.getByRole("button", { name: "Save email" })).toBeInTheDocument();
  });

  it("renders the change-username dialog only when the controller has one", () => {
    const changeUsername: ChangeUsernameController = { target: alice, username: "alice2", setUsername: vi.fn(),
      error: null, pending: false, open: vi.fn(), cancel: vi.fn(), confirm: vi.fn(async () => {}) };
    renderUsers(fakeController({ changeUsername }));
    expect(screen.getByDisplayValue("alice2")).toBeInTheDocument();
  });

  it("renders no change-username dialog without one", () => {
    renderUsers(fakeController({ changeUsername: undefined }));
    expect(screen.queryByDisplayValue("alice2")).toBeNull();
  });
});

describe("UserRow", () => {
  it("shows the email or a muted dash when there is none", () => {
    renderUsers(fakeController());
    expect(within(rowOf("alice")).getByRole("cell", { name: "alice@example.test" })).toBeInTheDocument();
    expect(within(rowOf("bob")).getByText("—")).toHaveClass("muted-cell");
  });

  it("translates the status without a renderServerLabel", () => {
    renderUsers(fakeController({ t: (key) => `T:${key}` }));
    expect(within(rowOf("alice")).getByText("T:active")).toHaveClass("status", "status-active");
  });

  it("uses renderServerLabel for the status and role label when it renders something", () => {
    renderUsers(fakeController(), { renderServerLabel: ({ value }) => `S:${value}` });
    expect(within(rowOf("alice")).getByText("S:active")).toHaveClass("status");
    expect(within(rowOf("alice")).getByRole("cell", { name: "S:editor" })).toBeInTheDocument();
  });

  it("falls back to t(status) and the raw role label when renderServerLabel renders nullish", () => {
    renderUsers(fakeController({ t: (key) => `T:${key}` }), { renderServerLabel: () => null });
    expect(within(rowOf("alice")).getByText("T:active")).toHaveClass("status");
    expect(within(rowOf("alice")).getByRole("cell", { name: "editor" })).toBeInTheDocument();
  });

  it("shows role and policy labels, or a muted 'none' when a user has no grants", () => {
    renderUsers(fakeController());
    expect(within(rowOf("alice")).getByRole("cell", { name: "editor" })).toBeInTheDocument();
    expect(within(rowOf("alice")).getByRole("cell", { name: "read-only" })).toBeInTheDocument();
    const nones = within(rowOf("bob")).getAllByText("none");
    expect(nones).toHaveLength(2);
    for (const none of nones) expect(none).toHaveClass("muted-cell");
  });

  it("leaves out the Roles/Policies cells without grants and spans 4 columns in the panel", () => {
    renderUsers(fakeController({ canGrant: false, expandedId: "alice" }));
    expect(rowOf("alice").children).toHaveLength(4);
    expect(document.querySelector("td[colspan]")).toHaveAttribute("colspan", "4");
  });

  it("renders the Roles/Policies cells with grants and spans 6 columns in the panel", () => {
    renderUsers(fakeController({ expandedId: "alice" }));
    expect(rowOf("alice").children).toHaveLength(6);
    expect(document.querySelector("td[colspan]")).toHaveAttribute("colspan", "6");
  });

  it("opens the Manage panel only under the expanded row and mirrors it on aria-expanded", () => {
    renderUsers(fakeController({ expandedId: "bob" }));
    expect(screen.getByRole("button", { name: "alice" })).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByRole("button", { name: "bob" })).toHaveAttribute("aria-expanded", "true");
    expect(rowOf("bob").nextElementSibling!.querySelector("td[colspan]")).not.toBeNull();
    expect(rowOf("alice").nextElementSibling).toBe(rowOf("bob"));
  });

  it("renders no Manage panel while every row is collapsed", () => {
    renderUsers(fakeController());
    expect(document.querySelector("td[colspan]")).toBeNull();
  });

  it("toggles the row through the username button", () => {
    const toggleExpanded = vi.fn();
    renderUsers(fakeController({ toggleExpanded }));
    fireEvent.click(screen.getByRole("button", { name: "alice" }));
    expect(toggleExpanded).toHaveBeenCalledWith(alice);
  });

  it("toggles the row through the menu's Manage item", () => {
    const toggleExpanded = vi.fn();
    renderUsers(fakeController({ toggleExpanded }));
    openMenu("alice");
    fireEvent.click(screen.getByRole("menuitem", { name: "Manage" }));
    expect(toggleExpanded).toHaveBeenCalledWith(alice);
  });

  it("routes Disable on an active user to requestDisable", () => {
    const requestDisable = vi.fn();
    renderUsers(fakeController({ requestDisable }));
    openMenu("alice");
    fireEvent.click(screen.getByRole("menuitem", { name: "Disable" }));
    expect(requestDisable).toHaveBeenCalledWith(alice);
  });

  it("routes Enable on a disabled user to toggleStatus", () => {
    const onToggleStatus = vi.fn(async () => {});
    renderUsers(fakeController({ onToggleStatus }));
    openMenu("bob");
    fireEvent.click(screen.getByRole("menuitem", { name: "Enable" }));
    expect(onToggleStatus).toHaveBeenCalledWith(bob);
  });

  it("swallows the toggle item while that row's status write is in flight", () => {
    const onToggleStatus = vi.fn(async () => {});
    renderUsers(fakeController({ onToggleStatus, toggleSavingId: "bob" }));
    openMenu("bob");
    fireEvent.click(screen.getByRole("menuitem", { name: "Enable" }));
    expect(onToggleStatus).not.toHaveBeenCalled();
  });

  it("routes Reset password to openResetPassword", () => {
    const openResetPassword = vi.fn();
    renderUsers(fakeController({ openResetPassword }));
    openMenu("alice");
    fireEvent.click(screen.getByRole("menuitem", { name: "Reset password" }));
    expect(openResetPassword).toHaveBeenCalledWith(alice);
  });

  it("offers Change username only when renameUserHandler returns a handler for the row", () => {
    const rename = vi.fn();
    const renameUserHandler = vi.fn(({ user }: { user: AdminIdentityUser }) => (user.principalId === "alice" ? rename : undefined));
    renderUsers(fakeController({ renameUserHandler }));
    openMenu("alice");
    fireEvent.click(screen.getByRole("menuitem", { name: "Change username" }));
    expect(rename).toHaveBeenCalledWith(alice);
  });

  it("offers no Change username for a row renameUserHandler declines", () => {
    renderUsers(fakeController({ renameUserHandler: () => undefined }));
    openMenu("bob");
    expect(screen.queryByRole("menuitem", { name: "Change username" })).toBeNull();
  });

  it("offers no Change username without a renameUserHandler", () => {
    renderUsers(fakeController({ renameUserHandler: undefined }));
    openMenu("alice");
    expect(screen.queryByRole("menuitem", { name: "Change username" })).toBeNull();
  });

  it("filters menu items through rowCapabilities and routes Delete to requestDelete", () => {
    const requestDelete = vi.fn();
    renderUsers(fakeController({ requestDelete, canManageUserTrash: true,
      rowCapabilities: () => ({ canDelete: true, canDisable: false, canEnable: true, canResetPassword: false }) }));
    openMenu("alice");
    expect(screen.queryByRole("menuitem", { name: "Disable" })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: "Reset password" })).toBeNull();
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
    expect(requestDelete).toHaveBeenCalledWith(alice);
  });

  it("falls back to canDelete as the row capability when rowCapabilities is missing", () => {
    // Malformed-input fixture: `UsersController.rowCapabilities` is typed as required, but the row
    // keeps a `?? canDelete` fallback for a controller without it — this pins that fallback.
    const controller = { ...fakeController({ canManageUserTrash: true }), rowCapabilities: undefined } as unknown as UsersController;
    renderUsers(controller);
    openMenu("alice");
    expect(screen.getByRole("menuitem", { name: "Delete" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Disable" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Reset password" })).toBeInTheDocument();
  });
});
