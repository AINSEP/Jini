import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";

import { Members } from "../Members.js";

const ACTIVE_MEMBER = {
  id: "m1",
  workspaceId: "w1",
  email: "alice@example.com",
  name: "Alice",
  status: "active" as const,
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
  version: 1,
};

const DISABLED_MEMBER = { ...ACTIVE_MEMBER, id: "m2", email: "bob@example.com", name: "Bob", status: "disabled" as const };

import { createFakeMembersPort } from "../../testing.js";
const translate = (key: string) => key;
let port: ReturnType<typeof createFakeMembersPort>;
let disable: MockInstance<typeof port.disableMember>;
let requestLink: MockInstance<typeof port.requestMemberMagicLink>;

function dialogFor(titleRe: RegExp): HTMLElement {
  return screen.getByText(titleRe).closest("dialog") as HTMLElement;
}

beforeEach(() => {
  port = createFakeMembersPort({}, { members: [] });
  disable = vi.spyOn(port, "disableMember");
  requestLink = vi.spyOn(port, "requestMemberMagicLink");
});

async function openMenu(user: ReturnType<typeof userEvent.setup>, email: string) {
  await user.click(screen.getByRole("button", { name: `Actions for member "${email}"` }));
  return screen.getByRole("menu");
}

describe("an active member's menu", () => {
  it("offers both Resend sign-in link and Disable", async () => {
    const user = userEvent.setup();
    port.members.push(ACTIVE_MEMBER);
    render(<Members port={port} translate={translate} />);

    await screen.findByText("alice@example.com");
    const menu = await openMenu(user, "alice@example.com");
    expect(within(menu).getByRole("menuitem", { name: "Resend sign-in link" })).toBeInTheDocument();
    expect(within(menu).getByRole("menuitem", { name: "Disable" })).toBeInTheDocument();
  });
});

describe("an already-disabled member's menu", () => {
  it("omits Disable entirely rather than showing it as a no-op", async () => {
    const user = userEvent.setup();
    port.members.push(DISABLED_MEMBER);
    render(<Members port={port} translate={translate} />);

    await screen.findByText("bob@example.com");
    const menu = await openMenu(user, "bob@example.com");
    expect(within(menu).getByRole("menuitem", { name: "Resend sign-in link" })).toBeInTheDocument();
    expect(within(menu).queryByRole("menuitem", { name: "Disable" })).not.toBeInTheDocument();
  });
});

describe("Disable — via RowMenu, confirm-gated", () => {
  it("opens a ConfirmDialog instead of acting immediately, and only disables on confirm", async () => {
    const user = userEvent.setup();
    const otherMember = { ...DISABLED_MEMBER, status: "active" as const };
    port.members.push(ACTIVE_MEMBER, otherMember);
    render(<Members port={port} translate={translate} />);

    await screen.findByText("alice@example.com");
    const menu = await openMenu(user, "alice@example.com");
    await user.click(within(menu).getByRole("menuitem", { name: "Disable" }));

    const dialog = dialogFor(/disable this member\?/i);
    expect(dialog).toHaveAttribute("open");
    expect(disable).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole("button", { name: /^disable$/i }));

    expect(disable).toHaveBeenCalledWith({ id: ACTIVE_MEMBER.id });
    await screen.findByText("disabled");
    const aliceRow = screen.getByText("alice@example.com").closest("tr")!;
    const bobRow = screen.getByText("bob@example.com").closest("tr")!;
    expect(within(aliceRow).getByText("disabled")).toBeInTheDocument();
    expect(within(bobRow).getByText("active")).toBeInTheDocument();
    expect(dialog).not.toHaveAttribute("open");
  });

  it("cancelling leaves the member untouched", async () => {
    const user = userEvent.setup();
    port.members.push(ACTIVE_MEMBER);
    render(<Members port={port} translate={translate} />);

    await screen.findByText("alice@example.com");
    const menu = await openMenu(user, "alice@example.com");
    await user.click(within(menu).getByRole("menuitem", { name: "Disable" }));

    const dialog = dialogFor(/disable this member\?/i);
    await user.click(within(dialog).getByRole("button", { name: /^cancel$/i }));

    expect(dialog).not.toHaveAttribute("open");
    expect(screen.getByText("active")).toBeInTheDocument();
    expect(disable).not.toHaveBeenCalled();
  });
});

describe("Resend sign-in link — via RowMenu, immediate", () => {
  it("fires immediately with no dialog and shows a per-row notice", async () => {
    const user = userEvent.setup();
    port.members.push(ACTIVE_MEMBER, { ...DISABLED_MEMBER, status: "active" });
    render(<Members port={port} translate={translate} />);

    await screen.findByText("alice@example.com");
    const menu = await openMenu(user, "alice@example.com");
    await user.click(within(menu).getByRole("menuitem", { name: "Resend sign-in link" }));

    expect(dialogFor(/disable this member\?/i)).not.toHaveAttribute("open");
    expect(await screen.findByText("Sign-in link sent.")).toBeInTheDocument();
    expect(requestLink).toHaveBeenCalledWith({ email: "alice@example.com" });
    const aliceRow = screen.getByText("alice@example.com").closest("tr")!;
    const bobRow = screen.getByText("bob@example.com").closest("tr")!;
    expect(within(aliceRow).getByText("Sign-in link sent.")).toBeInTheDocument();
    expect(within(bobRow).queryByText("Sign-in link sent.")).not.toBeInTheDocument();
  });
});
