import { describe, expect, it } from "vitest";
import { resolveDirectoryHome } from "../directory-home.js";
import { selectWorkspaceDirectory } from "../workspace-directory.js";

const input = { homeDir: "/users/owner", defaultFolder: "Product Sites", envName: "PRODUCT_HOME", env: {} };
describe("operator-visible directory home", () => {
  it("resolves default, setting, environment, tilde and relative overrides in precedence order", () => {
    expect(resolveDirectoryHome(input, {})).toBe("/users/owner/Product Sites");
    expect(resolveDirectoryHome({ ...input, setting: "/saved" }, {})).toBe("/saved");
    expect(resolveDirectoryHome({ ...input, setting: "/saved", env: { PRODUCT_HOME: "~/shared" } }, {})).toBe("/users/owner/shared");
    expect(resolveDirectoryHome({ ...input, env: { PRODUCT_HOME: "shared" } }, { cwd: "/checkout" })).toBe("/checkout/shared");
    expect(() => resolveDirectoryHome({ ...input, env: { PRODUCT_HOME: "" } }, {})).toThrow("PRODUCT_HOME must name a directory");
  });
  it("keeps the checkout fallback until a valid home site exists, and selects adopted sites by ID", () => {
    const args = { home: "/home/sites", fallback: "/repo/sites/dev", entries: [], listDirectories: () => ["/home/sites/partial"], isInitialized: () => false };
    expect(selectWorkspaceDirectory(args, {})).toBe("/repo/sites/dev");
    expect(selectWorkspaceDirectory({ ...args, listDirectories: () => ["/home/sites/one"], isInitialized: () => true }, {})).toBe("/home/sites/one");
    const entries = [{ id: "outside-id", name: "Outside", path: "/external/one", createdBy: "Desktop", lastOpened: null }];
    expect(selectWorkspaceDirectory({ ...args, entries, selected: "outside-id" }, {})).toBe("/external/one");
  });
});
