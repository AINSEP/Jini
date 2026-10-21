import { describe, expect, it, vi } from "vitest";
import { emptyRowState, memberRowMenuItems } from "../rules.js";
import type { AdminMember } from "../../models.js";

const member: AdminMember = { id: "m1", workspaceId: "w", email: "a@example.test", status: "active", createdAt: "2026-01-01", updatedAt: "2026-01-01", version: 1 };
const translate = (key: string) => key;

describe("memberRowMenuItems while a row action is in flight", () => {
  it("ignores a second resend while one is already sending", () => {
    const handlers = { onResendSignInLink: vi.fn(), onRequestDisable: vi.fn() };
    const items = memberRowMenuItems({ member, rs: { ...emptyRowState({}), resending: true }, handlers, translate });
    items.find((item) => item.key === "resend")!.onSelect();
    expect(handlers.onResendSignInLink).not.toHaveBeenCalled();
  });

  it("ignores a disable request while the disable is already pending", () => {
    const handlers = { onResendSignInLink: vi.fn(), onRequestDisable: vi.fn() };
    const items = memberRowMenuItems({ member, rs: { ...emptyRowState({}), disabling: true }, handlers, translate });
    items.find((item) => item.key === "disable")!.onSelect();
    expect(handlers.onRequestDisable).not.toHaveBeenCalled();
  });
});
