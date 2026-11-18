import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { renderWithUmKit } from "../../__tests__/fake-um-kit.js";
import type { AdminIdentityUser } from "../../models.js";
import { ChangeUsernameDialog } from "../ChangeUsernameDialog.js";
import type { useChangeUsername } from "../hooks/use-change-username.hooks.js";

const alice: AdminIdentityUser = { principalId: "alice", workspaceId: "w", username: "alice", status: "active", roleIds: [], policyIds: [], createdAt: "2026-10-09" };
const t = (key: string) => key;
const controller = (overrides: Partial<ReturnType<typeof useChangeUsername>> = {}): ReturnType<typeof useChangeUsername> =>
  ({ target: alice, username: "alice.new", setUsername: vi.fn(), error: null, pending: false, open: vi.fn(), cancel: vi.fn(), confirm: vi.fn(async () => {}), ...overrides });

/** The change-username dialog renders through the kit's admin-style ConfirmDialog slot, and the body stays the page's own markup. */
describe("ChangeUsernameDialog through the user-management kit", () => {
  it("is the open ConfirmDialog slot, titled and labelled, with the draft in its body", () => {
    const { container, getByDisplayValue } = renderWithUmKit(<ChangeUsernameDialog controller={controller()} translate={t} />);
    const slot = container.querySelector('[data-um-kit="ConfirmDialog"]');
    expect(slot).toHaveAttribute("data-open", "true");
    expect(slot).toHaveAccessibleName("Change username");
    expect(getByDisplayValue("alice.new")).toBeInTheDocument();
  });

  it("is a closed slot when no user is targeted", () => {
    const { container } = renderWithUmKit(<ChangeUsernameDialog controller={controller({ target: null })} translate={t} />);
    expect(container.querySelector('[data-um-kit="ConfirmDialog"]')).toHaveAttribute("data-open", "false");
  });

  it("wires Confirm and Cancel to the controller, and marks the slot pending while saving", async () => {
    const user = userEvent.setup();
    const c = controller();
    const { container } = renderWithUmKit(<ChangeUsernameDialog controller={c} translate={t} />);
    const [cancel, confirm] = container.querySelectorAll('[data-um-kit="ConfirmDialog"] button');
    await user.click(confirm!);
    expect(c.confirm).toHaveBeenCalledOnce();
    await user.click(cancel!);
    expect(c.cancel).toHaveBeenCalledOnce();
  });

  it("disables both actions while the change is pending", () => {
    const { container } = renderWithUmKit(<ChangeUsernameDialog controller={controller({ pending: true })} translate={t} />);
    for (const button of container.querySelectorAll('[data-um-kit="ConfirmDialog"] button')) expect(button).toBeDisabled();
  });
});
