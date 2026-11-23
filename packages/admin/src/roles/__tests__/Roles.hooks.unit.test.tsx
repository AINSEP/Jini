// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { goToRolesTab } from "../Roles.hooks.js";

const originalUrl = window.location.href;
afterEach(() => window.history.replaceState(null, "", originalUrl));

it("switches to the requested roles tab without growing browser history", () => {
  // Author Checklist F2.1/F2.4/F7.5: real router, literal URL and history effect.
  // Reject: omit replace:true or navigate to /seo.
  window.history.replaceState(null, "", "/admin/roles?tab=roles");
  const entries = window.history.length;
  goToRolesTab({ tabId: "policies" });
  expect(window.location.pathname + window.location.search).toBe("/admin/roles?tab=policies");
  expect(window.history.length).toBe(entries);
  goToRolesTab({ tabId: "roles" });
  expect(window.location.pathname + window.location.search).toBe("/admin/roles?tab=roles");
  expect(window.history.length).toBe(entries);
});
