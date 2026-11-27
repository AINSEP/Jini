import "@testing-library/jest-dom/vitest";
import { fireEvent, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { renderWithUmKit } from "../../__tests__/fake-um-kit.js";
import type { AdminIdentityUser } from "../../models.js";
import { UsersDialogs } from "../UsersDialogs.js";
import type { useChangeUsername } from "../hooks/use-change-username.hooks.js";
import type { useResetPasswordFields } from "../hooks/use-reset-password-fields.hooks.js";
import type { UsersController } from "../hooks/use-users.hooks.js";

const t = (key: string) => key;
const alice: AdminIdentityUser = { principalId: "alice", workspaceId: "w", username: "alice", status: "active",
  roleIds: [], policyIds: [], createdAt: "2026-10-01", isOwner: false };

/** Every field the dialogs read is a spy or a value the test sets; the rest stay inert. */
function controller(overrides: Partial<UsersController> = {}): UsersController {
  const noop = vi.fn();
  const asyncNoop = vi.fn(async () => {});
  return {
    users: [alice], roles: [], policies: [], canGrant: false, error: null,
    formOpen: false, setFormOpen: noop, username: "", setUsername: noop, email: "", setEmail: noop,
    password: "", setPassword: noop, saving: false, formError: null, onCreate: asyncNoop,
    expandedId: null, toggleExpanded: noop, pendingRoleId: "", setPendingRoleId: noop,
    pendingPolicyId: "", setPendingPolicyId: noop, grantSaving: false, grantError: null,
    onAssignRole: asyncNoop, onAttachPolicy: asyncNoop, editEmail: "", setEditEmail: noop, emailSaving: false, onSaveEmail: asyncNoop,
    toggleSavingId: null, toggleError: null, notice: null,
    confirmingDisable: null, setConfirmingDisable: vi.fn(), requestDisable: noop, confirmDisable: vi.fn(async () => {}),
    onToggleStatus: asyncNoop,
    resetPasswordFor: null, setResetPasswordFor: vi.fn(), newPassword: "", setNewPassword: vi.fn(),
    passwordSaving: false, passwordError: null, setPasswordError: vi.fn(), openResetPassword: noop,
    confirmResetPassword: vi.fn(async () => {}),
    canManageUserTrash: true,
    rowCapabilities: () => ({ canDelete: true, canDisable: true, canEnable: true, canResetPassword: true }),
    confirmingDelete: null, setConfirmingDelete: vi.fn(), requestDelete: noop, deleteSaving: false, confirmDelete: vi.fn(async () => {}),
    t, translate: t,
    ...overrides,
  };
}

type Fields = ReturnType<typeof useResetPasswordFields>;
function fields(overrides: Partial<Fields> = {}): Fields {
  return { confirmPassword: "", setConfirmPassword: vi.fn(), mismatch: false, showNewPassword: false,
    toggleShowNewPassword: vi.fn(), showConfirmPassword: false, toggleShowConfirmPassword: vi.fn(), ...overrides };
}

const dialogs = (container: HTMLElement) => [...container.querySelectorAll<HTMLElement>('[data-um-kit="ConfirmDialog"]')];

describe("UsersDialogs", () => {
  it("keeps every dialog closed and renders no rename dialog without a pending action", () => {
    const { container } = renderWithUmKit(<UsersDialogs controller={controller()} useFields={() => fields()} />);
    expect(dialogs(container).map((d) => d.getAttribute("data-open"))).toEqual(["false", "false", "false"]);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("asks to disable the named user, pending only while that user's status write is in flight", () => {
    const c = controller({ confirmingDisable: alice, toggleSavingId: "someone-else" });
    const { rerender } = renderWithUmKit(<UsersDialogs controller={c} useFields={() => fields()} />);
    const dialog = screen.getByRole("dialog", { name: "Disable this user?" });
    expect(dialog).toHaveAttribute("data-tone", "warning");
    expect(dialog).toHaveTextContent('Disable "alice"? They will not be able to sign in until re-enabled.');
    fireEvent.click(within(dialog).getByRole("button", { name: "Disable" }));
    expect(c.confirmDisable).toHaveBeenCalledTimes(1);
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(c.setConfirmingDisable).toHaveBeenCalledWith(null);

    rerender(<UsersDialogs controller={{ ...c, toggleSavingId: "alice" }} useFields={() => fields()} />);
    expect(within(screen.getByRole("dialog", { name: "Disable this user?" })).getByRole("button", { name: "Disable" })).toBeDisabled();
  });

  it("asks to move the named user to the Trash and forwards confirm and cancel", () => {
    const c = controller({ confirmingDelete: alice, deleteSaving: false });
    renderWithUmKit(<UsersDialogs controller={c} useFields={() => fields()} />);
    const dialog = screen.getByRole("dialog", { name: "Delete this user?" });
    expect(dialog).toHaveAttribute("data-tone", "danger");
    expect(dialog).toHaveTextContent('Delete "alice"? They will be signed out and moved to the Trash.');
    fireEvent.click(within(dialog).getByRole("button", { name: "Move to trash" }));
    expect(c.confirmDelete).toHaveBeenCalledTimes(1);
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(c.setConfirmingDelete).toHaveBeenCalledWith(null);
  });

  it("disables the delete buttons while the delete is saving", () => {
    renderWithUmKit(<UsersDialogs controller={controller({ confirmingDelete: alice, deleteSaving: true })} useFields={() => fields()} />);
    expect(within(screen.getByRole("dialog", { name: "Delete this user?" })).getByRole("button", { name: "Move to trash" })).toBeDisabled();
  });

  it("drives the reset-password fields through the controller and the injected field state", () => {
    const f = fields({ confirmPassword: "typed" });
    const useFields = vi.fn(() => f);
    const c = controller({ resetPasswordFor: alice, newPassword: "typed" });
    const { container } = renderWithUmKit(<UsersDialogs controller={c} useFields={useFields} />);
    expect(useFields).toHaveBeenCalledWith({ resetPasswordFor: alice, newPassword: "typed" });
    const dialog = screen.getByRole("dialog", { name: "Reset password?" });
    expect(dialog).toHaveTextContent('Set a new password for "alice". Every active session for this user will be signed out.');
    expect(within(dialog).queryByRole("alert")).toBeNull();
    const fresh = container.querySelector<HTMLInputElement>("#users-reset-password-input");
    const retype = container.querySelector<HTMLInputElement>("#users-reset-password-confirm-input");
    expect(fresh?.value).toBe("typed");
    expect(fresh).toHaveAttribute("autocomplete", "new-password");
    expect(retype?.value).toBe("typed");
    fireEvent.change(fresh!, { target: { value: "next" } });
    expect(c.setNewPassword).toHaveBeenCalledWith("next");
    fireEvent.change(retype!, { target: { value: "again" } });
    expect(f.setConfirmPassword).toHaveBeenCalledWith("again");
    fireEvent.click(within(dialog).getByRole("button", { name: "Reset password" }));
    expect(c.confirmResetPassword).toHaveBeenCalledTimes(1);
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(c.setResetPasswordFor).toHaveBeenCalledWith(null);
    expect(c.setNewPassword).toHaveBeenLastCalledWith("");
    expect(c.setPasswordError).toHaveBeenCalledWith(null);
  });

  it("shows a live mismatch over a stale server error and refuses to submit it", () => {
    const c = controller({ resetPasswordFor: alice, newPassword: "a", passwordError: "server refused" });
    renderWithUmKit(<UsersDialogs controller={c} useFields={() => fields({ mismatch: true })} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Passwords do not match.");
    fireEvent.click(screen.getByRole("button", { name: "Reset password" }));
    expect(c.confirmResetPassword).not.toHaveBeenCalled();
  });

  it("shows the stale server error once the fields agree", () => {
    renderWithUmKit(<UsersDialogs controller={controller({ resetPasswordFor: alice, passwordError: "server refused" })} useFields={() => fields()} />);
    expect(screen.getByRole("alert")).toHaveTextContent("server refused");
  });

  it("falls back to the real field-state hook when none is injected", () => {
    renderWithUmKit(<UsersDialogs controller={controller({ resetPasswordFor: alice, newPassword: "abc" })} />);
    // The real hook starts with an empty confirm field, which does not match "abc".
    expect(screen.getByRole("alert")).toHaveTextContent("Passwords do not match.");
  });

  it("renders the rename dialog when the controller carries a rename flow", () => {
    const rename: ReturnType<typeof useChangeUsername> = { target: alice, username: "alice.new", setUsername: vi.fn(), error: null,
      pending: false, open: vi.fn(), cancel: vi.fn(), confirm: vi.fn(async () => {}) };
    renderWithUmKit(<UsersDialogs controller={controller({ changeUsername: rename })} useFields={() => fields()} />);
    expect(screen.getByRole("dialog", { name: "Change username" })).toBeInTheDocument();
    expect(screen.getByDisplayValue("alice.new")).toBeInTheDocument();
  });
});
