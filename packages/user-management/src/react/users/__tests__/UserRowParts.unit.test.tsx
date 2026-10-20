import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { UserGrantCells, UserNameCell, UserStatusCell, userRowMenuItemsFor } from "../UserRowParts.js";
import type { UserRowActionsController } from "../Users.js";
import type { AdminIdentityUser, AdminPolicy, AdminRole } from "../../models.js";

const t = (key: string) => `T:${key}`;
const alice: AdminIdentityUser = { principalId: "alice", workspaceId: "w", username: "alice", status: "active",
  roleIds: ["r1"], policyIds: ["p1"], createdAt: "2026-10-01", isOwner: false };
const roleById = new Map<string, AdminRole>([["r1", { id: "r1", workspaceId: "w", name: "editor", isBuiltin: false }]]);
const policyById = new Map<string, AdminPolicy>([["p1", { id: "p1", workspaceId: "w", name: "read-only", isBuiltin: false, isFrozen: false }]]);

function inRow(node: React.ReactNode) {
  return render(<table><tbody><tr>{node}</tr></tbody></table>);
}

function actions(overrides: Partial<UserRowActionsController> = {}): UserRowActionsController {
  return { expandedId: null, toggleExpanded: vi.fn(), savingId: null, requestDisable: vi.fn(),
    toggleStatus: vi.fn(async () => {}), openResetPassword: vi.fn(), canDelete: false, requestDelete: vi.fn(), ...overrides };
}

describe("UserNameCell", () => {
  it("toggles the row with the user and mirrors expanded on aria-expanded", () => {
    const onToggle = vi.fn();
    inRow(<UserNameCell user={alice} isOwn={false} expanded onToggle={onToggle} agentBase="row" t={t} />);
    const button = screen.getByRole("button", { name: "alice" });
    expect(button).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(button);
    expect(onToggle).toHaveBeenCalledWith(alice);
  });

  it("marks the caller's own row with a translated (you)", () => {
    inRow(<UserNameCell user={alice} isOwn expanded={false} onToggle={vi.fn()} agentBase="row" t={t} />);
    expect(screen.getByText("T:(you)")).toBeInTheDocument();
  });

  it("shows no (you) marker on another user's row", () => {
    inRow(<UserNameCell user={alice} isOwn={undefined} expanded={false} onToggle={vi.fn()} agentBase="row" t={t} />);
    expect(screen.queryByText("T:(you)")).toBeNull();
  });
});

describe("UserStatusCell", () => {
  it("renders the host's server label when it returns one", () => {
    inRow(<UserStatusCell status="disabled" t={t} renderServerLabel={({ value }) => `S:${value}`} />);
    expect(screen.getByText("S:disabled")).toHaveClass("status", "status-disabled");
  });

  it("falls back to t(status) when the host label is nullish", () => {
    inRow(<UserStatusCell status="active" t={t} renderServerLabel={() => undefined} />);
    expect(screen.getByText("T:active")).toHaveClass("status-active");
  });

  it("translates the status without a host label renderer", () => {
    inRow(<UserStatusCell status="active" t={t} renderServerLabel={undefined} />);
    expect(screen.getByText("T:active")).toBeInTheDocument();
  });
});

describe("UserGrantCells", () => {
  it("renders the role label through renderServerLabel and the policy label as-is", () => {
    const renderServerLabel = vi.fn(({ value }: { value: string }) => `S:${value}`);
    inRow(<UserGrantCells user={alice} roleById={roleById} policyById={policyById} t={t} translate={t} renderServerLabel={renderServerLabel} />);
    expect(screen.getByRole("cell", { name: "S:editor" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "read-only" })).toBeInTheDocument();
    expect(renderServerLabel).toHaveBeenCalledTimes(1);
  });

  it("keeps the raw role label when renderServerLabel renders nullish or is absent", () => {
    inRow(<UserGrantCells user={alice} roleById={roleById} policyById={policyById} t={t} translate={t} renderServerLabel={() => null} />);
    expect(screen.getByRole("cell", { name: "editor" })).toBeInTheDocument();
  });

  it("renders the raw role label without a renderer", () => {
    inRow(<UserGrantCells user={alice} roleById={roleById} policyById={policyById} t={t} translate={t} renderServerLabel={undefined} />);
    expect(screen.getByRole("cell", { name: "editor" })).toBeInTheDocument();
  });

  it("renders a muted translated none in both cells for a user without grants", () => {
    inRow(<UserGrantCells user={{ ...alice, roleIds: [], policyIds: [] }} roleById={roleById} policyById={policyById} t={t}
      translate={t} renderServerLabel={undefined} />);
    const nones = screen.getAllByText("T:none");
    expect(nones).toHaveLength(2);
    for (const none of nones) expect(none).toHaveClass("muted-cell");
  });
});

describe("userRowMenuItemsFor", () => {
  const keys = (items: { key: string }[]) => items.map((item) => item.key);

  it("falls back to canDelete as the capability without rowCapabilities", () => {
    expect(keys(userRowMenuItemsFor({ user: alice, actions: actions({ canDelete: true }), translate: t })))
      .toEqual(["toggle", "manage", "reset-password", "delete"]);
  });

  it("uses rowCapabilities over canDelete when present", () => {
    const rowCapabilities = vi.fn(() => ({ canDelete: false, canDisable: false, canEnable: true, canResetPassword: true }));
    expect(keys(userRowMenuItemsFor({ user: alice, actions: actions({ canDelete: true, rowCapabilities }), translate: t })))
      .toEqual(["manage", "reset-password"]);
    expect(rowCapabilities).toHaveBeenCalledWith(alice);
  });

  it("adds Change username with the handler renameUserHandler returns for the row", () => {
    const rename = vi.fn();
    const renameUserHandler = vi.fn(() => rename);
    const items = userRowMenuItemsFor({ user: alice, actions: actions({ renameUserHandler }), translate: t });
    items.find((item) => item.key === "change-username")!.onSelect();
    expect(renameUserHandler).toHaveBeenCalledWith({ user: alice });
    expect(rename).toHaveBeenCalledWith(alice);
  });

  it("routes Enable to toggleStatus for a disabled user", () => {
    const toggleStatus = vi.fn(async () => {});
    const disabled = { ...alice, status: "disabled" as const };
    userRowMenuItemsFor({ user: disabled, actions: actions({ toggleStatus }), translate: t })[0]!.onSelect();
    expect(toggleStatus).toHaveBeenCalledWith(disabled);
  });

  it("swallows the toggle while this row's own status write is in flight", () => {
    const requestDisable = vi.fn();
    userRowMenuItemsFor({ user: alice, actions: actions({ requestDisable, savingId: "alice" }), translate: t })[0]!.onSelect();
    expect(requestDisable).not.toHaveBeenCalled();
  });

  it("does not treat another row's in-flight write as this row's", () => {
    const requestDisable = vi.fn();
    userRowMenuItemsFor({ user: alice, actions: actions({ requestDisable, savingId: "bob" }), translate: t })[0]!.onSelect();
    expect(requestDisable).toHaveBeenCalledWith(alice);
  });
});
