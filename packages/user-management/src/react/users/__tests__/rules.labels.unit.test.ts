import { describe, expect, it } from "vitest";
import { formatGrantLabel, grantOptionLabel, userAccountCapabilities } from "../rules.js";
import type { AdminIdentityUser } from "../../models.js";

const user: AdminIdentityUser = { principalId: "u1", workspaceId: "w", username: "u", status: "active", createdAt: "2026-01-01", roleIds: ["r-editor"], policyIds: [] };

describe("grant labels", () => {
  it("translates the built-in owner option and keeps every other name verbatim", () => {
    const translate = (key: string) => `t:${key}`;
    expect(grantOptionLabel({ option: { name: "owner", isBuiltin: true }, translate })).toBe("t:Owner");
    expect(grantOptionLabel({ option: { name: "owner", isBuiltin: false }, translate })).toBe("owner");
  });

  it("falls back to the raw id for a grant whose role was deleted, using identity translation by default", () => {
    const byId = new Map([["r1", { name: "owner", isBuiltin: true }], ["r2", { name: "Editors" }]]);
    expect(formatGrantLabel({ ids: ["r1", "r2", "gone"], byId })).toBe("Owner, Editors, gone");
  });
});

describe("userAccountCapabilities", () => {
  it("does not treat a built-in role other than admin/owner as protecting the account", () => {
    const roles = new Map([["r-editor", { name: "editor", isBuiltin: true }]]);
    const caps = userAccountCapabilities({ user, callerPrincipalId: "someone-else", callerIsOwner: false, canManageUserTrash: true, roles });
    expect(caps).toMatchObject({ canDelete: true, canDisable: true });
  });
});
