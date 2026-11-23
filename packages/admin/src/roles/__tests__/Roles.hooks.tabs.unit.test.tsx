// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { ROLES_TAB_IDS, resolveRolesTabId, resolveRolesTabs } from "../Roles.hooks.js";

// Characterization of the roles tab descriptors, written when the file moved into this package:
// the host's screen test exercised them only through the rendered TabBar.
describe("roles tab descriptors", () => {
  it("keeps the two tab ids in render order", () => {
    expect([...ROLES_TAB_IDS]).toEqual(["roles", "policies"]);
  });

  it("opens a known ?tab= value and falls back to roles for an absent or unknown one", () => {
    expect(resolveRolesTabId({ tabId: "policies" })).toBe("policies");
    expect(resolveRolesTabId({ tabId: "roles" })).toBe("roles");
    expect(resolveRolesTabId({ tabId: null })).toBe("roles");
    expect(resolveRolesTabId({ tabId: undefined })).toBe("roles");
    expect(resolveRolesTabId({ tabId: "seo" })).toBe("roles");
  });

  it("labels each tab through the bound translator and carries its agent handle", () => {
    const tabs = resolveRolesTabs({ t: (key) => `[${key}]` });
    expect(tabs.map(({ id, label, handle }) => ({ id, label, handle }))).toEqual([
      { id: "roles", label: "[Roles]", handle: "roles-tab-roles" },
      { id: "policies", label: "[Policies]", handle: "roles-tab-policies" },
    ]);
    expect(tabs.every((tab) => tab.icon !== undefined && typeof tab.handleLabel === "string")).toBe(true);
    expect(tabs.some((tab) => tab.count !== undefined)).toBe(false);
  });
});
