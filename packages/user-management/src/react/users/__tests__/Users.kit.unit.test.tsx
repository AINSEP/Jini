import { render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { renderWithUmKit } from "../../__tests__/fake-um-kit.js";
import { UserManagementKitMissingError } from "../../kit.js";
import type { AdminIdentityUser, AdminPolicy, AdminRole } from "../../models.js";
import { createFakeUsersPort } from "../../testing.js";
import { Users } from "../Users.js";
import type { UsersController } from "../hooks/use-users.hooks.js";

const t = (key: string) => key;
const alice: AdminIdentityUser = { principalId: "alice", workspaceId: "w", username: "alice", email: "alice@example.test",
  status: "active", roleIds: [], policyIds: [], createdAt: "2026-10-01", isOwner: false };
const roleR1: AdminRole = { id: "r1", workspaceId: "w", name: "editor", isBuiltin: true };
const policyP1: AdminPolicy = { id: "p1", workspaceId: "w", name: "read-only", isBuiltin: false, isFrozen: false };

/** A fully typed controller (the page's `useUsersHook` seam) so each conditional slot can be driven open deterministically. */
function controller(overrides: Partial<UsersController> = {}): UsersController {
  const noop = vi.fn();
  const asyncNoop = vi.fn(async () => {});
  return {
    users: [alice], roles: [roleR1], policies: [policyP1], canGrant: true, error: null,
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
    canManageUserTrash: true,
    rowCapabilities: () => ({ canDelete: true, canDisable: true, canEnable: true, canResetPassword: true }),
    ownProfile: null,
    confirmingDelete: null, setConfirmingDelete: noop, requestDelete: vi.fn(), deleteSaving: false, confirmDelete: asyncNoop,
    t, translate: t,
    ...overrides,
  };
}
const withController = (c: UsersController) => <Users useUsersHook={() => c} port={createFakeUsersPort({}, {})} translate={t} queryScope="w" />;
const slots = (container: HTMLElement, name: string) => [...container.querySelectorAll<HTMLElement>(`[data-um-kit="${name}"]`)];
const dialog = (container: HTMLElement, title: string) => slots(container, "ConfirmDialog").find((el) => el.getAttribute("aria-label") === title);

/** Page-level coverage through the fake kit: the users screen renders its row menus, confirm dialogs, password fields and info tips through the kit's slots. */
describe("Users through the user-management kit (real hook, fake port)", () => {
  it("shows the loading notice until the lists settle", () => {
    const port = createFakeUsersPort({}, { users: [alice] });
    port.listUsers = () => new Promise(() => {});
    const { getByText } = renderWithUmKit(<Users port={port} translate={t} queryScope="w" />);
    expect(getByText("Loading users…")).toBeInTheDocument();
  });

  it("shows a plain-words failure when the lists cannot be read", async () => {
    const port = createFakeUsersPort({}, { users: [alice] });
    port.listUsers = () => Promise.reject(new Error("backend unreachable"));
    const { findByText, container } = renderWithUmKit(<Users port={port} translate={t} queryScope="w" />);
    expect(await findByText(/backend unreachable|failed to load users/i)).toBeInTheDocument();
    expect(slots(container, "RowMenu")).toHaveLength(0);
  });

  it("renders the loaded roster with a RowMenu slot per user and the dialogs closed", async () => {
    const port = createFakeUsersPort({}, { users: [alice], roles: [roleR1], policies: [policyP1] });
    const { findByText, container } = renderWithUmKit(<Users port={port} translate={t} queryScope="w" />);
    await findByText("alice@example.test");
    expect(slots(container, "RowMenu").map((menu) => menu.getAttribute("aria-label"))).toEqual(['Actions for user "alice"']);
    expect(slots(container, "ConfirmDialog").map((el) => el.getAttribute("data-open"))).not.toContain("true");
  });
});

describe("Users through the user-management kit (driven controller)", () => {
  it("offers the row actions as RowMenu items and keeps the roles InfoTip slot in the header", () => {
    const { container } = renderWithUmKit(withController(controller()));
    const items = [...slots(container, "RowMenu")[0]!.querySelectorAll('[role="menuitem"]')].map((item) => item.textContent);
    expect(items).toEqual(expect.arrayContaining(["Reset password"]));
    expect(items.length).toBeGreaterThanOrEqual(3);
    expect(slots(container, "InfoTip").some((tip) => tip.getAttribute("aria-label") === "About roles")).toBe(true);
  });

  it("opens the disable dialog from the controller's state and wires Confirm and Cancel", async () => {
    const user = userEvent.setup();
    const confirmDisable = vi.fn(async () => {});
    const setConfirmingDisable = vi.fn();
    const { container } = renderWithUmKit(withController(controller({ confirmingDisable: alice, confirmDisable, setConfirmingDisable })));
    const open = dialog(container, "Disable this user?")!;
    expect(open).toHaveAttribute("data-open", "true");
    const [cancel, confirm] = open.querySelectorAll("button");
    await user.click(confirm!);
    expect(confirmDisable).toHaveBeenCalledOnce();
    await user.click(cancel!);
    expect(setConfirmingDisable).toHaveBeenCalledWith(null);
  });

  it("opens the delete dialog with the danger tone", () => {
    const { container } = renderWithUmKit(withController(controller({ confirmingDelete: alice })));
    expect(dialog(container, "Delete this user?")).toHaveAttribute("data-open", "true");
    expect(dialog(container, "Delete this user?")).toHaveAttribute("data-tone", "danger");
  });

  it("renders both new-password fields as SecretInput slots inside the reset dialog", () => {
    const { container } = renderWithUmKit(withController(controller({ resetPasswordFor: alice })));
    const reset = dialog(container, "Reset password?")!;
    expect(reset).toHaveAttribute("data-open", "true");
    expect(reset.querySelectorAll('[data-um-kit="SecretInput"]')).toHaveLength(2);
  });

  it("renders the new-user password as a SecretInput slot when the form is open", () => {
    const { container } = renderWithUmKit(withController(controller({ formOpen: true, password: "pw" })));
    const fields = slots(container, "SecretInput");
    expect(fields).toHaveLength(1);
    expect(fields[0]!.querySelector("input")).toHaveValue("pw");
  });

  it("mounts three closed ConfirmDialog slots: disable, delete and reset password", () => {
    const { container } = renderWithUmKit(withController(controller()));
    expect(slots(container, "ConfirmDialog").map((el) => el.getAttribute("data-open"))).toEqual(["false", "false", "false"]);
  });

  it("throws the typed missing-provider error when no kit is mounted", () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    try { expect(() => render(withController(controller()))).toThrow(UserManagementKitMissingError); }
    finally { quiet.mockRestore(); }
  });
});
