import { render, screen, waitFor, within } from '../../__tests__/fetch-query-support.js';
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { Members } from "../Members.js";
import { createFakeMembersPort } from "../../testing.js";
import type { AdminMember } from "../../models.js";

const translate = (key: string) => key;
const MEMBER: AdminMember = {
  id: "m1", workspaceId: "w1", email: "alice@example.com", name: "Alice", status: "active",
  createdAt: "2026-08-01T00:00:00.000Z", updatedAt: "2026-08-02T00:00:00.000Z", version: 3,
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

describe("Members detail panel", () => {
  it("shows a loading notice while the detail request is in flight, then the fetched fields", async () => {
    const user = userEvent.setup();
    const port = createFakeMembersPort({}, { members: [MEMBER] });
    const pending = deferred<{ member: AdminMember }>();
    port.getMember = () => pending.promise;
    render(<Members port={port} translate={translate} />);

    const toggle = await screen.findByRole("button", { name: "alice@example.com" });
    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(await screen.findByText("Loading detail…")).toBeInTheDocument();

    pending.resolve({ member: MEMBER });
    const detail = (await screen.findByText("Email verified")).closest("dl") as HTMLElement;
    expect(within(detail).getByText("m1")).toBeInTheDocument();
    expect(within(detail).getByText("not verified")).toBeInTheDocument();
    expect(within(detail).getByText("2026-08-02T00:00:00.000Z")).toBeInTheDocument();
    expect(within(detail).getByText("3")).toBeInTheDocument();
    expect(screen.queryByText("Loading detail…")).toBeNull();
  });

  it("shows the verification timestamp when the member has verified their email", async () => {
    const user = userEvent.setup();
    const verified = { ...MEMBER, emailVerifiedAt: "2026-08-03T00:00:00.000Z" };
    const port = createFakeMembersPort({}, { members: [verified] });
    render(<Members port={port} translate={translate} />);

    await user.click(await screen.findByRole("button", { name: "alice@example.com" }));
    expect(await screen.findByText("2026-08-03T00:00:00.000Z")).toBeInTheDocument();
    expect(screen.queryByText("not verified")).toBeNull();
  });

  it("surfaces a detail fetch failure inside the expanded row instead of the fields", async () => {
    const user = userEvent.setup();
    const port = createFakeMembersPort({}, { members: [MEMBER] });
    port.getMember = () => Promise.reject(new Error("detail exploded"));
    render(<Members port={port} translate={translate} />);

    await user.click(await screen.findByRole("button", { name: "alice@example.com" }));
    const notice = await screen.findByText("detail exploded");
    expect(notice).toHaveClass("notice", "error");
    expect(screen.queryByText("Email verified")).toBeNull();
  });

  it("collapses the expanded row on a second click", async () => {
    const user = userEvent.setup();
    const port = createFakeMembersPort({}, { members: [MEMBER] });
    render(<Members port={port} translate={translate} />);

    const toggle = await screen.findByRole("button", { name: "alice@example.com" });
    await user.click(toggle);
    await screen.findByText("Email verified");
    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Email verified")).toBeNull();
  });
});

describe("Members load and row failures", () => {
  it("replaces the table with an error banner when the roster cannot be loaded", async () => {
    const port = createFakeMembersPort({}, { members: [MEMBER] });
    port.listMembers = () => Promise.reject(new Error("roster down"));
    const { container } = render(<Members port={port} translate={translate} />);

    await waitFor(() => expect(container.querySelector(".notice.error")).not.toBeNull());
    expect(container.querySelector(".notice.error")?.textContent).toBe("roster down");
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("shows a per-row alert when resending the sign-in link fails", async () => {
    const user = userEvent.setup();
    const port = createFakeMembersPort({}, { members: [MEMBER] });
    port.requestMemberMagicLink = () => Promise.reject(new Error("mailer down"));
    render(<Members port={port} translate={translate} />);

    await user.click(await screen.findByRole("button", { name: 'Actions for member "alice@example.com"' }));
    await user.click(within(screen.getByRole("menu")).getByRole("menuitem", { name: "Resend sign-in link" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).not.toBe("");
    expect(alert).toHaveClass("notice", "error");
  });

  it("loads through a host-supplied query scope", async () => {
    const port = createFakeMembersPort({}, { members: [MEMBER] });
    render(<Members port={port} translate={translate} queryScope="tenant-a" />);
    expect(await screen.findByText("alice@example.com")).toBeInTheDocument();
  });
});
