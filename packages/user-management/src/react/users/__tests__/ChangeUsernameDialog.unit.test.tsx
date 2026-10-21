import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { ChangeUsernameDialog } from "../ChangeUsernameDialog.js";
import type { useChangeUsername } from "../hooks/use-change-username.hooks.js";
import type { AdminIdentityUser } from "../../models.js";

const alice: AdminIdentityUser = { principalId: "alice", workspaceId: "w", username: "alice", status: "active", roleIds: [], policyIds: [], createdAt: "2026-10-09" };
const t = (key: string) => key;

function controller(overrides: Partial<ReturnType<typeof useChangeUsername>> = {}): ReturnType<typeof useChangeUsername> {
  return { target: alice, username: "alice.new", setUsername: vi.fn(), error: null, pending: false,
    open: vi.fn(), cancel: vi.fn(), confirm: vi.fn(async () => {}), ...overrides };
}

it("shows the server failure as an alert alongside the kept draft", () => {
  render(<ChangeUsernameDialog controller={controller({ error: "username already taken" })} translate={t} />);
  expect(screen.getByRole("alert")).toHaveTextContent("username already taken");
  expect(screen.getByDisplayValue("alice.new")).toBeInTheDocument();
});

it("renders no alert without an error and forwards edits to the controller", async () => {
  const c = controller();
  render(<ChangeUsernameDialog controller={c} translate={t} />);
  expect(screen.queryByRole("alert")).toBeNull();
  await userEvent.type(screen.getByDisplayValue("alice.new"), "x");
  expect(c.setUsername).toHaveBeenCalledWith("alice.newx");
});
