import { expect, it } from "vitest";
import { adminSitePreviewUrl, authenticatedAdminUrl } from "../urls.js";

it("preserves the path and query under the same-origin admin API", () => {
  expect(authenticatedAdminUrl({ path: "/settings?namespace=core.language" })).toBe("/api/admin/v1/settings?namespace=core.language");
});

it("escapes the whole site name as one segment and changes the URL on a new capture", () => {
  const name = "Studio / café?x=#1";
  const prefix = "/api/admin/v1/workspaces/workspace-local/system/sites/Studio%20%2F%20caf%C3%A9%3Fx%3D%231/preview";
  expect(adminSitePreviewUrl({ name, version: 42 })).toBe(prefix + "?v=42");
  expect(adminSitePreviewUrl({ name, version: 43 })).toBe(prefix + "?v=43");
});
