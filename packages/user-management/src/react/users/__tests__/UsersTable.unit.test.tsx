import "@testing-library/jest-dom/vitest";
import { fireEvent, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { renderWithUmKit } from "../../__tests__/fake-um-kit.js";
import type { AdminIdentityUser, AdminPolicy, AdminRole } from "../../models.js";
import { UserManagePanel, UsersTable, type GrantSelectController, type UserManageController, type UserRowActionsController, type UsersTableProps } from "../UsersTable.js";

const t = (key: string) => key;
const alice: AdminIdentityUser = { principalId: "alice", workspaceId: "w", username: "alice", email: "alice@example.test", status: "active",
  roleIds: ["r1"], policyIds: ["p1"], createdAt: "2026-10-01", isOwner: false };
const bob: AdminIdentityUser = { principalId: "bob", workspaceId: "w", username: "bob", status: "disabled",
  roleIds: [], policyIds: [], createdAt: "2026-10-02", isOwner: false };
const editor: AdminRole = { id: "r1", workspaceId: "w", name: "editor", isBuiltin: false, version: 1 };
const readOnly: AdminPolicy = { id: "p1", workspaceId: "w", name: "read-only", isBuiltin: false, isFrozen: false, version: 1 };

function actions(overrides: Partial<UserRowActionsController> = {}): UserRowActionsController {
  return { expandedId: null, toggleExpanded: vi.fn(), savingId: null, requestDisable: vi.fn(),
    toggleStatus: vi.fn(async () => {}), openResetPassword: vi.fn(), canDelete: false, requestDelete: vi.fn(), ...overrides };
}

function grant(overrides: Partial<GrantSelectController> = {}): GrantSelectController {
  return { options: [{ id: "r1", name: "editor", isBuiltin: false }, { id: "r2", name: "viewer", isBuiltin: true }],
    pendingId: "", setPendingId: vi.fn(), submit: vi.fn(async () => {}), ...overrides };
}

function manage(overrides: Partial<UserManageController> = {}): UserManageController {
  return { error: null, saving: false, email: { value: "alice@example.test", set: vi.fn(), saving: false, save: vi.fn(async () => {}) },
    roleGrant: null, policyGrant: null, ...overrides };
}

function table(overrides: Partial<UsersTableProps> = {}) {
  const props: UsersTableProps = { users: [alice, bob], ownPrincipalId: "alice", roles: [editor], policies: [readOnly], showGrants: true,
    actions: actions(), manage: manage(), t, translate: t, ...overrides };
  return renderWithUmKit(<UsersTable {...props} />);
}

const panelCell = (container: HTMLElement) => container.querySelector<HTMLTableCellElement>("td[colspan]");

describe("UsersTable", () => {
  it("shows the empty state instead of a table when there are no users", () => {
    const { container } = table({ users: [] });
    expect(screen.getByText("No users yet.")).toBeInTheDocument();
    expect(screen.getByText("Create your first operator account to get started.")).toBeInTheDocument();
    expect(container.querySelector("table")).toBeNull();
  });

  it("renders one row per user with the caller's own row marked and a dash for a missing email", () => {
    const { container } = table();
    expect(screen.getAllByRole("columnheader").map((th) => th.textContent)).toEqual(["Username", "Email", "Status", "Roles", "Policies", "More"]);
    expect(container.querySelector('[data-um-kit="InfoTip"]')).toHaveAttribute("aria-label", "About roles");
    const rows = [...container.querySelectorAll("tbody > tr")];
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveAttribute("aria-current", "true");
    expect(rows[1]).not.toHaveAttribute("aria-current");
    expect(rows[0]).toHaveTextContent("alice@example.test");
    expect(within(rows[1] as HTMLElement).getByText("—")).toHaveClass("muted-cell");
    expect(screen.getAllByRole("menu").map((menu) => menu.getAttribute("aria-label"))).toEqual(['Actions for user "alice"', 'Actions for user "bob"']);
    expect(rows[0]).toHaveTextContent("editor");
    expect(panelCell(container)).toBeNull();
  });

  it("leaves out the Roles and Policies columns without grant access, and narrows the Manage panel to match", () => {
    const { container } = table({ showGrants: false, actions: actions({ expandedId: "alice" }) });
    expect(screen.getAllByRole("columnheader").map((th) => th.textContent)).toEqual(["Username", "Email", "Status", "More"]);
    expect(container.querySelector('[data-um-kit="InfoTip"]')).toBeNull();
    expect(panelCell(container)).toHaveAttribute("colspan", "4");
  });

  it("expands only the row whose Manage panel is open, spanning all six columns", () => {
    const { container } = table({ actions: actions({ expandedId: "bob" }) });
    const rows = [...container.querySelectorAll("tbody > tr")];
    expect(rows).toHaveLength(3);
    expect(rows[2]?.querySelector("td")).toHaveAttribute("colspan", "6");
  });
});

describe("UserManagePanel", () => {
  const renderPanel = (m: UserManageController, colSpan?: number) => renderWithUmKit(
    <table><tbody>{colSpan === undefined ? <UserManagePanel principalId="alice" manage={m} t={t} /> : <UserManagePanel principalId="alice" manage={m} t={t} colSpan={colSpan} />}</tbody></table>);

  it("edits and saves this user's email, showing the shared error line", () => {
    const m = manage({ error: "email taken" });
    const { container } = renderPanel(m);
    expect(panelCell(container)).toHaveAttribute("colspan", "6");
    expect(screen.getByText("email taken")).toHaveClass("save-error");
    const input = screen.getByDisplayValue("alice@example.test");
    expect(input).toHaveAttribute("placeholder", "(none)");
    fireEvent.change(input, { target: { value: "new@example.test" } });
    expect(m.email.set).toHaveBeenCalledWith("new@example.test");
    fireEvent.click(screen.getByRole("button", { name: "Save email" }));
    expect(m.email.save).toHaveBeenCalledWith({ principalId: "alice" });
    expect(screen.queryByRole("combobox")).toBeNull();
  });

  it("disables the email save while it is in flight", () => {
    renderPanel(manage({ email: { value: "", set: vi.fn(), saving: true, save: vi.fn(async () => {}) } }), 4);
    expect(screen.getByRole("button", { name: "Saving…" })).toBeDisabled();
  });

  it("grants the selected role and policy to this user, marking built-in options", () => {
    const role = grant({ pendingId: "r2" });
    const policy = grant({ options: [{ id: "p1", name: "read-only", isBuiltin: false }] });
    renderPanel(manage({ roleGrant: role, policyGrant: policy }));
    const [roleSelect, policySelect] = screen.getAllByRole("combobox");
    expect(within(roleSelect!).getAllByRole("option").map((o) => o.textContent)).toEqual(["Select a role…", "editor", "viewer (built-in)"]);
    expect(within(policySelect!).getAllByRole("option").map((o) => o.textContent)).toEqual(["Select a policy…", "read-only"]);
    fireEvent.change(roleSelect!, { target: { value: "r1" } });
    expect(role.setPendingId).toHaveBeenCalledWith("r1");
    fireEvent.click(screen.getByRole("button", { name: "Assign" }));
    expect(role.submit).toHaveBeenCalledWith({ principalId: "alice" });
    // Nothing picked yet: the policy's Attach stays disabled.
    expect(screen.getByRole("button", { name: "Attach" })).toBeDisabled();
  });

  it("disables both grant buttons and says Saving while a grant is in flight", () => {
    renderPanel(manage({ saving: true, roleGrant: grant({ pendingId: "r1" }), policyGrant: grant({ pendingId: "r1" }) }));
    const saving = screen.getAllByRole("button", { name: "Saving…" });
    expect(saving).toHaveLength(2);
    for (const button of saving) expect(button).toBeDisabled();
  });
});
