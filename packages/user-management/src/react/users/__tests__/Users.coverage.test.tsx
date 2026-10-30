import { useState } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { createFakeUsersPort } from "../../testing.js";
import { Users } from "../Users.js";
import type { UsersController } from "../hooks/use-users.hooks.js";
import type { AdminIdentityUser, AdminPolicy, AdminRole } from "../../models.js";

/**
 * Coverage lot L182b: the parts of `Users.tsx` the composition/row pins never reached — the notice
 * banners, the new-user form's field handlers, the header toggle, all three confirm dialogs'
 * confirm/cancel wiring, and the reset-password dialog's confirm field, mismatch gate and reveal
 * toggles. Everything is driven through the public `Users` component and its `useUsersHook` seam
 * with a fully typed `UsersController`; the reset dialog uses the REAL `useResetPasswordFields`
 * (Users never passes a `useFields` override), so the mismatch/reveal behaviour asserted here is the
 * shipped behaviour, not a fake's.
 */

const t = (key: string) => key;
const alice: AdminIdentityUser = { principalId: "alice", workspaceId: "w", username: "alice", email: "alice@example.test",
  status: "active", roleIds: [], policyIds: [], createdAt: "2026-10-01", isOwner: false };
const roleR1: AdminRole = { id: "r1", workspaceId: "w", name: "editor", isBuiltin: true };
const policyP1: AdminPolicy = { id: "p1", workspaceId: "w", name: "read-only", isBuiltin: false, isFrozen: false };

function fakeController(overrides: Partial<UsersController> = {}): UsersController {
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
    canManageUserTrash: false,
    rowCapabilities: () => ({ canDelete: true, canDisable: true, canEnable: true, canResetPassword: true }),
    ownProfile: null,
    confirmingDelete: null, setConfirmingDelete: noop, requestDelete: vi.fn(), deleteSaving: false, confirmDelete: asyncNoop,
    t, translate: t,
    ...overrides,
  };
}

function renderWith(useUsersHook: () => UsersController) {
  return render(<Users useUsersHook={useUsersHook} port={createFakeUsersPort({}, {})} translate={t} queryScope="w" />);
}

function renderUsers(controller: UsersController) {
  return renderWith(() => controller);
}

/** The `<dialog>` whose `<h2>` title is `title`. All three dialogs stay mounted, so every lookup of
 *  a "Cancel" button has to be scoped to one of them. */
function dialogTitled(title: string): HTMLElement {
  return screen.getByRole("heading", { name: title, hidden: true }).closest("dialog")!;
}

function dialogButton(title: string, name: string): HTMLElement {
  return within(dialogTitled(title)).getByRole("button", { name, hidden: true });
}

describe("UsersNotices", () => {
  it("shows the toggle error as an error notice", () => {
    renderUsers(fakeController({ toggleError: "Could not disable alice" }));
    expect(screen.getByText("Could not disable alice")).toHaveClass("notice", "error");
  });

  it("shows the success notice as a plain notice", () => {
    renderUsers(fakeController({ notice: "Password reset for alice" }));
    const notice = screen.getByText("Password reset for alice");
    expect(notice).toHaveClass("notice");
    expect(notice).not.toHaveClass("error");
  });

  it("renders no notice banners when neither is set", () => {
    const { container } = renderUsers(fakeController());
    expect(container.querySelectorAll(".page > .notice")).toHaveLength(0);
  });
});

describe("UsersTable empty state", () => {
  it("shows the empty state instead of a table when there are no users", () => {
    renderUsers(fakeController({ users: [] }));
    expect(screen.getByText("No users yet.")).toBeInTheDocument();
    expect(screen.getByText("Create your first operator account to get started.")).toHaveClass("page-description");
    expect(screen.queryByRole("table")).toBeNull();
  });
});

describe("UserManagePanel email editor", () => {
  it("forwards the typed email to the controller's setEditEmail", () => {
    const setEditEmail = vi.fn();
    renderUsers(fakeController({ expandedId: "alice", setEditEmail }));
    fireEvent.change(screen.getByPlaceholderText("(none)"), { target: { value: "alice2@example.test" } });
    expect(setEditEmail).toHaveBeenCalledWith("alice2@example.test");
  });

  it("disables and relabels the email save button while emailSaving", () => {
    renderUsers(fakeController({ expandedId: "alice", emailSaving: true }));
    expect(screen.queryByRole("button", { name: "Save email" })).toBeNull();
    expect(screen.getAllByRole("button", { name: "Saving…" })[0]).toBeDisabled();
  });
});

describe("NewUserForm", () => {
  it("shows the form error above the fields", () => {
    renderUsers(fakeController({ formOpen: true, formError: "Username taken" }));
    expect(screen.getByText("Username taken")).toHaveClass("save-error");
  });

  it("forwards each field's typed value to its controller setter", () => {
    const setUsername = vi.fn();
    const setEmail = vi.fn();
    const setPassword = vi.fn();
    renderUsers(fakeController({ formOpen: true, setUsername, setEmail, setPassword }));
    fireEvent.change(screen.getByRole("textbox", { name: "Username" }), { target: { value: "carol" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Email (optional)" }), { target: { value: "carol@example.test" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "plainword" } });
    expect(setUsername).toHaveBeenCalledWith("carol");
    expect(setEmail).toHaveBeenCalledWith("carol@example.test");
    expect(setPassword).toHaveBeenCalledWith("plainword");
  });

  it("marks the new-user password field as a new-password credential, not a saved login", () => {
    renderUsers(fakeController({ formOpen: true }));
    const field = screen.getByLabelText("Password");
    expect(field).toHaveAttribute("type", "password");
    expect(field).toHaveAttribute("autocomplete", "new-password");
  });

  it("gives the new-user password the shared eye toggle without renaming the field", () => {
    renderUsers(fakeController({ formOpen: true, password: "plainword" }));
    const field = screen.getByLabelText("Password");
    expect(field).toHaveAccessibleName("Password");
    expect(field.closest('label')).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show password" }));
    expect(field).toHaveAttribute("type", "text");
    expect(screen.getByRole("button", { name: "Hide password" })).not.toHaveAttribute("aria-pressed");
  });

  it("submits through onCreate", () => {
    const onCreate = vi.fn(async (e: { preventDefault: () => void }) => { e.preventDefault(); });
    renderUsers(fakeController({ formOpen: true, username: "carol", password: "plainword", onCreate }));
    fireEvent.click(screen.getByRole("button", { name: "Create user" }));
    expect(onCreate).toHaveBeenCalledTimes(1);
  });

  it("disables the submit button and relabels it while saving", () => {
    renderUsers(fakeController({ formOpen: true, saving: true }));
    expect(screen.getByRole("button", { name: "Creating…" })).toBeDisabled();
  });
});

describe("UsersPageHeader", () => {
  it("flips formOpen through the New user toggle", () => {
    const setFormOpen = vi.fn();
    renderUsers(fakeController({ setFormOpen }));
    fireEvent.click(screen.getByRole("button", { name: "New user" }));
    const updater = setFormOpen.mock.calls[0]![0] as (open: boolean) => boolean;
    expect(updater(false)).toBe(true);
    expect(updater(true)).toBe(false);
  });

  it("reads Cancel, styled secondary, while the form is open", () => {
    renderUsers(fakeController({ formOpen: true }));
    expect(screen.getAllByRole("button", { name: "Cancel" })[0]).toHaveClass("btn-secondary");
    expect(screen.queryByRole("button", { name: "New user" })).toBeNull();
  });
});

describe("UserDisableDialog", () => {
  it("names the user being disabled", () => {
    renderUsers(fakeController({ confirmingDisable: alice }));
    expect(within(dialogTitled("Disable this user?")).getByText(/"alice"\? They will not be able to sign in/)).toBeInTheDocument();
  });

  it("clears confirmingDisable on Cancel", async () => {
    const setConfirmingDisable = vi.fn();
    renderUsers(fakeController({ confirmingDisable: alice, setConfirmingDisable }));
    fireEvent.click(dialogButton("Disable this user?", "Cancel"));
    await waitFor(() => expect(setConfirmingDisable).toHaveBeenCalledWith(null));
  });

  it("runs confirmDisable on Disable", async () => {
    const confirmDisable = vi.fn(async () => {});
    renderUsers(fakeController({ confirmingDisable: alice, confirmDisable }));
    fireEvent.click(dialogButton("Disable this user?", "Disable"));
    await waitFor(() => expect(confirmDisable).toHaveBeenCalledTimes(1));
  });

  it("is pending only while that same user's status write is in flight", () => {
    renderUsers(fakeController({ confirmingDisable: alice, toggleSavingId: "alice" }));
    expect(dialogButton("Disable this user?", "Disable")).toBeDisabled();
  });

  it("is not pending while a different row's status write is in flight", () => {
    renderUsers(fakeController({ confirmingDisable: alice, toggleSavingId: "bob" }));
    expect(dialogButton("Disable this user?", "Disable")).toBeEnabled();
  });
});

describe("UserDeleteDialog", () => {
  it("names the user and the Trash consequence", () => {
    renderUsers(fakeController({ confirmingDelete: alice }));
    expect(within(dialogTitled("Delete this user?")).getByText(/"alice"\? They will be signed out and moved to the Trash/))
      .toBeInTheDocument();
  });

  it("clears confirmingDelete on Cancel", async () => {
    const setConfirmingDelete = vi.fn();
    renderUsers(fakeController({ confirmingDelete: alice, setConfirmingDelete }));
    fireEvent.click(dialogButton("Delete this user?", "Cancel"));
    await waitFor(() => expect(setConfirmingDelete).toHaveBeenCalledWith(null));
  });

  it("runs confirmDelete on Move to trash", async () => {
    const confirmDelete = vi.fn(async () => {});
    renderUsers(fakeController({ confirmingDelete: alice, confirmDelete }));
    fireEvent.click(dialogButton("Delete this user?", "Move to trash"));
    await waitFor(() => expect(confirmDelete).toHaveBeenCalledTimes(1));
  });

  it("disables its actions while deleteSaving", () => {
    renderUsers(fakeController({ confirmingDelete: alice, deleteSaving: true }));
    expect(dialogButton("Delete this user?", "Move to trash")).toBeDisabled();
  });
});

/** A `useUsersHook` that keeps `newPassword` in real React state, the way `use-users.hooks.ts` does,
 *  so typing into "New password" re-renders the dialog and the real `useResetPasswordFields` can
 *  compare the two fields. */
function statefulResetHook(overrides: Partial<UsersController> = {}): () => UsersController {
  return function useStatefulReset() {
    const [newPassword, setNewPassword] = useState("");
    return fakeController({ resetPasswordFor: alice, newPassword, setNewPassword, ...overrides });
  };
}

const RESET = "Reset password?";

function newPasswordField(): HTMLElement {
  return within(dialogTitled(RESET)).getByLabelText("New password");
}

function confirmPasswordField(): HTMLElement {
  return within(dialogTitled(RESET)).getByLabelText("Confirm new password");
}

function revealToggles(): HTMLElement[] {
  return ["Show New password", "Show Confirm new password"].map(name => within(dialogTitled(RESET)).getByRole("button", { name, hidden: true }));
}

describe("UserResetPasswordDialog", () => {
  it("renders no password fields while closed", () => {
    renderUsers(fakeController());
    expect(document.getElementById("users-reset-password-input")).toBeNull();
    expect(document.getElementById("users-reset-password-confirm-input")).toBeNull();
  });

  it("names the user and warns that their sessions will be signed out", () => {
    renderWith(statefulResetHook());
    expect(within(dialogTitled(RESET)).getByText(/"alice"\. Every active session for this user will be signed out\./))
      .toBeInTheDocument();
  });

  it("renders both fields hidden, as new-password credentials", () => {
    renderWith(statefulResetHook());
    for (const field of [newPasswordField(), confirmPasswordField()]) {
      expect(field).toHaveAttribute("type", "password");
      expect(field).toHaveAttribute("autocomplete", "new-password");
    }
  });

  it("forwards the typed new password to setNewPassword", () => {
    const setNewPassword = vi.fn();
    renderUsers(fakeController({ resetPasswordFor: alice, setNewPassword }));
    fireEvent.change(newPasswordField(), { target: { value: "plainword" } });
    expect(setNewPassword).toHaveBeenCalledWith("plainword");
  });

  it("shows the mismatch alert while the two fields disagree", () => {
    renderWith(statefulResetHook());
    fireEvent.change(newPasswordField(), { target: { value: "plainword" } });
    fireEvent.change(confirmPasswordField(), { target: { value: "plainwor" } });
    expect(within(dialogTitled(RESET)).getByRole("alert", { hidden: true })).toHaveTextContent("Passwords do not match.");
  });

  it("blocks the reset while the two fields disagree", async () => {
    const confirmResetPassword = vi.fn(async () => {});
    renderWith(statefulResetHook({ confirmResetPassword }));
    fireEvent.change(newPasswordField(), { target: { value: "plainword" } });
    fireEvent.change(confirmPasswordField(), { target: { value: "plainwor" } });
    fireEvent.click(dialogButton(RESET, "Reset password"));
    // Give the dialog's async confirm path a chance to run before asserting it never reached the controller.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(confirmResetPassword).not.toHaveBeenCalled();
  });

  it("runs confirmResetPassword once the two fields agree", async () => {
    const confirmResetPassword = vi.fn(async () => {});
    renderWith(statefulResetHook({ confirmResetPassword }));
    fireEvent.change(newPasswordField(), { target: { value: "plainword" } });
    fireEvent.change(confirmPasswordField(), { target: { value: "plainword" } });
    expect(within(dialogTitled(RESET)).queryByRole("alert", { hidden: true })).toBeNull();
    fireEvent.click(dialogButton(RESET, "Reset password"));
    await waitFor(() => expect(confirmResetPassword).toHaveBeenCalledTimes(1));
  });

  it("shows a server passwordError in the slot when the fields agree", () => {
    renderWith(statefulResetHook({ passwordError: "Password too short" }));
    expect(within(dialogTitled(RESET)).getByRole("alert", { hidden: true })).toHaveTextContent("Password too short");
  });

  it("lets a live mismatch win the slot over a stale passwordError", () => {
    renderWith(statefulResetHook({ passwordError: "Password too short" }));
    fireEvent.change(newPasswordField(), { target: { value: "plainword" } });
    const alerts = within(dialogTitled(RESET)).getAllByRole("alert", { hidden: true });
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toHaveTextContent("Passwords do not match.");
  });

  it("reveals only the new-password field through its own toggle, flipping its icon and labels", () => {
    renderWith(statefulResetHook());
    const [newToggle] = revealToggles();
    expect(newToggle).not.toHaveAttribute("aria-pressed");
    // The shared UI-kit eye draws its outline and pupil as paths while hidden.
    expect(newToggle!.querySelectorAll("svg path")).toHaveLength(2);
    expect(newToggle!.querySelectorAll("svg circle")).toHaveLength(0);
    expect(newToggle!.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    const hiddenIcon = newToggle!.querySelector("svg")!.innerHTML;
    fireEvent.click(newToggle!);
    expect(newPasswordField()).toHaveAttribute("type", "text");
    expect(newPasswordField()).toHaveAttribute("autocomplete", "new-password");
    expect(confirmPasswordField()).toHaveAttribute("type", "password");
    expect(newToggle).not.toHaveAttribute("aria-pressed");
    expect(newToggle).toHaveAttribute("aria-label", "Hide New password");
    expect(newToggle).toHaveAttribute("title", "Hide New password");
    // The shared eye-off glyph includes the diagonal slash.
    expect(newToggle!.querySelector('svg path[d="M2 2l20 20"]')).not.toBeNull();
    expect(newToggle!.querySelector("svg")!.innerHTML).not.toBe(hiddenIcon);
  });

  it("reveals only the confirm field through its own toggle", () => {
    renderWith(statefulResetHook());
    fireEvent.click(revealToggles()[1]!);
    expect(confirmPasswordField()).toHaveAttribute("type", "text");
    expect(newPasswordField()).toHaveAttribute("type", "password");
  });

  it("hides a revealed field again on a second toggle click", () => {
    renderWith(statefulResetHook());
    const [newToggle] = revealToggles();
    fireEvent.click(newToggle!);
    fireEvent.click(newToggle!);
    expect(newPasswordField()).toHaveAttribute("type", "password");
    expect(newToggle).toHaveAttribute("aria-label", "Show New password");
  });

  it("clears the target, the new password and the error on Cancel", async () => {
    const setResetPasswordFor = vi.fn();
    const setNewPassword = vi.fn();
    const setPasswordError = vi.fn();
    renderUsers(fakeController({ resetPasswordFor: alice, setResetPasswordFor, setNewPassword, setPasswordError }));
    fireEvent.click(dialogButton(RESET, "Cancel"));
    await waitFor(() => expect(setResetPasswordFor).toHaveBeenCalledWith(null));
    expect(setNewPassword).toHaveBeenCalledWith("");
    expect(setPasswordError).toHaveBeenCalledWith(null);
  });

  it("disables its actions while passwordSaving", () => {
    renderUsers(fakeController({ resetPasswordFor: alice, passwordSaving: true }));
    expect(dialogButton(RESET, "Reset password")).toBeDisabled();
  });
});
