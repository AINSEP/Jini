import { render, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { renderWithUmKit } from "../../__tests__/fake-um-kit.js";
import { UserManagementKitMissingError } from "../../kit.js";
import type { AdminMember } from "../../models.js";
import { createFakeMembersPort } from "../../testing.js";
import { Members } from "../Members.js";

const ALICE: AdminMember = { id: "m1", workspaceId: "w1", email: "alice@example.com", name: "Alice", status: "active",
  createdAt: "2026-08-01T00:00:00.000Z", updatedAt: "2026-08-01T00:00:00.000Z", version: 1 };
const BOB: AdminMember = { ...ALICE, id: "m2", email: "bob@example.com", name: "Bob", status: "disabled" };
const translate = (key: string) => key;
const portWith = (members: AdminMember[] = []) => createFakeMembersPort({}, { members });

/** Page-level coverage through the fake kit: the members screen renders its row menus and disable confirmation through the kit's RowMenu/ConfirmDialog slots. */
describe("Members through the user-management kit", () => {
  it("shows the loading notice until the roster settles", () => {
    const port = portWith();
    port.listMembers = () => new Promise(() => {});
    const { getByText } = renderWithUmKit(<Members port={port} translate={translate} />);
    expect(getByText("Loading members…")).toBeInTheDocument();
  });

  it("shows the plain-words failure when the roster cannot be read", async () => {
    const port = portWith();
    port.listMembers = () => Promise.reject(new Error("backend unreachable"));
    const { findByText, container } = renderWithUmKit(<Members port={port} translate={translate} />);
    expect(await findByText(/backend unreachable|failed to load members/)).toBeInTheDocument();
    expect(container.querySelector('[data-um-kit="RowMenu"]')).toBeNull();
  });

  it("renders one RowMenu slot per member under its full trigger name, with items that depend on the member's status", async () => {
    const { findByText, container, getAllByRole } = renderWithUmKit(<Members port={portWith([ALICE, BOB])} translate={translate} />);
    await findByText("alice@example.com");
    const menus = [...container.querySelectorAll('[data-um-kit="RowMenu"]')];
    expect(menus.map((menu) => menu.getAttribute("aria-label"))).toEqual(['Actions for member "alice@example.com"', 'Actions for member "bob@example.com"']);
    expect([...menus[0]!.querySelectorAll('[role="menuitem"]')].map((item) => item.textContent)).toEqual(["Resend sign-in link", "Disable"]);
    expect([...menus[1]!.querySelectorAll('[role="menuitem"]')].map((item) => item.textContent)).not.toContain("Disable");
    expect(getAllByRole("menuitem").length).toBeGreaterThan(2);
  });

  it("keeps the ConfirmDialog slot closed, opens it from the Disable item, and disables only after Confirm", async () => {
    const user = userEvent.setup();
    const port = portWith([ALICE]);
    const disable = vi.spyOn(port, "disableMember");
    const { findByText, container, getByRole } = renderWithUmKit(<Members port={port} translate={translate} />);
    await findByText("alice@example.com");
    const dialog = () => container.querySelector('[data-um-kit="ConfirmDialog"]') as HTMLElement;
    expect(dialog()).toHaveAttribute("data-open", "false");
    await user.click(getByRole("menuitem", { name: "Disable" }));
    expect(dialog()).toHaveAttribute("data-open", "true");
    expect(dialog()).toHaveAttribute("data-tone", "warning");
    expect(dialog()).toHaveAccessibleName("Disable this member?");
    expect(dialog()).toHaveTextContent('Disable "alice@example.com"? They will no longer be able to sign in.');
    expect(disable).not.toHaveBeenCalled();
    await user.click(dialog().querySelectorAll("button")[1]!);
    await waitFor(() => expect(disable).toHaveBeenCalledWith({ id: "m1" }));
    await waitFor(() => expect(dialog()).toHaveAttribute("data-open", "false"));
  });

  it("cancelling the dialog closes it without disabling", async () => {
    const user = userEvent.setup();
    const port = portWith([ALICE]);
    const disable = vi.spyOn(port, "disableMember");
    const { findByText, container, getByRole } = renderWithUmKit(<Members port={port} translate={translate} />);
    await findByText("alice@example.com");
    await user.click(getByRole("menuitem", { name: "Disable" }));
    await user.click(container.querySelectorAll('[data-um-kit="ConfirmDialog"] button')[0]!);
    expect(container.querySelector('[data-um-kit="ConfirmDialog"]')).toHaveAttribute("data-open", "false");
    expect(disable).not.toHaveBeenCalled();
  });

  it("an empty roster shows the empty state and still mounts the closed dialog", async () => {
    const { findByText, container } = renderWithUmKit(<Members port={portWith()} translate={translate} />);
    expect(await findByText("No members yet.")).toBeInTheDocument();
    expect(container.querySelector('[data-um-kit="RowMenu"]')).toBeNull();
    expect(container.querySelector('[data-um-kit="ConfirmDialog"]')).toHaveAttribute("data-open", "false");
  });

  it("throws the typed missing-provider error when no kit is mounted", () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(() => render(<Members port={portWith()} translate={translate} />)).toThrow(UserManagementKitMissingError);
    } finally { quiet.mockRestore(); }
  });
});
