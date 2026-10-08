import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { Members } from "../../index.js";
import { createFakeMembersPort } from "../../testing.js";
const translate = (key: string) => key;
it("host terminology changes visible copy; removing the options restores generic member copy", async () => {
  const port = createFakeMembersPort({}, {});
  const { rerender } = render(<Members port={port} translate={translate}
    description="Host account roster." emptyDescription="Host accounts appear here." />);
  await screen.findByText("Host accounts appear here.");
  expect(screen.getByText("Host account roster.")).toBeTruthy();
  rerender(<Members port={port} translate={translate} />);
  expect(screen.getByText("Registered members will show up here.")).toBeTruthy();
  expect(screen.getByText("People who have registered an account — review status, resend a sign-in link, or disable access.")).toBeTruthy();
  expect(screen.queryByText("Host accounts appear here.")).toBeNull();
});
it("host status rendering changes the cell and preserves the member's agent handle", async () => {
  const port = createFakeMembersPort({}, { members: [{ id: "m", workspaceId: "w", email: "alice@example.com",
    status: "active", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z", version: 1 }] });
  const { rerender } = render(<Members port={port} translate={translate} renderServerLabel={() => <span>Active label</span>} />);
  await screen.findByText("Active label");
  const handle = screen.getByRole("button", { name: "alice@example.com" }).getAttribute("data-agent-element");
  expect(handle).toBe("members-row-m-toggle-detail");
  rerender(<Members port={port} translate={translate} />);
  expect(screen.getByText("active")).toBeTruthy();
  expect(screen.queryByText("Active label")).toBeNull();
  expect(screen.getByRole("button", { name: "alice@example.com" }).getAttribute("data-agent-element")).toBe(handle);
});
