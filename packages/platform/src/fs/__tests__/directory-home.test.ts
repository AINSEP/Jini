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
  it("selects by name: an initialized home site first, then one unique registered or extra-root match, else beside the fallback", () => {
    const base = { home: "/home/sites", fallback: "/repo/sites/dev", entries: [], listDirectories: () => [], roots: ["/home/sites", "/extra"] };
    const initialized = (paths: string[]) => ({ path }: { path: string }) => paths.includes(path);
    expect(selectWorkspaceDirectory({ ...base, selected: "blog", isInitialized: initialized(["/home/sites/blog", "/extra/blog"]) }, {})).toBe("/home/sites/blog");
    const entries = [{ id: "adopted-id", name: "Blog", path: "/external/blog", createdBy: "Desktop", lastOpened: null }];
    expect(selectWorkspaceDirectory({ ...base, entries, selected: "blog", isInitialized: initialized([]) }, {})).toBe("/external/blog");
    expect(selectWorkspaceDirectory({ ...base, selected: "blog", isInitialized: initialized(["/extra/blog"]) }, {})).toBe("/extra/blog");
    expect(() => selectWorkspaceDirectory({ ...base, entries, selected: "blog", isInitialized: initialized(["/extra/blog"]) }, {}))
      .toThrow("More than one registered directory has this name. Select its registry ID.");
    expect(selectWorkspaceDirectory({ ...base, selected: "new-site", isInitialized: initialized([]) }, {})).toBe("/repo/sites/new-site");
  });
  it.each([false, true])("resolves a duplicate basename to its sole available site in either registry order (reverse=%s)", (reverse) => {
    const live = { id: "live", name: "Site", path: "/external/blog", createdBy: "Web", lastOpened: null };
    const stale = { ...live, id: "stale", path: "/scratch/blog" };
    const entries = reverse ? [stale, live] : [live, stale];
    const before = structuredClone(entries);
    const input = { home: "/home/sites", fallback: "/repo/sites/dev", selected: "blog", entries,
      listDirectories: () => [], isInitialized: () => false };
    const options = { isAvailable: ({ path }: { path: string }) => path === live.path };
    expect(selectWorkspaceDirectory(input, options)).toBe(live.path);
    expect(entries).toEqual(before);
    // An explicit identity still names an offline site; availability must not redirect it.
    expect(selectWorkspaceDirectory({ ...input, selected: stale.id }, options)).toBe(stale.path);
  });
  it("keeps ambiguous live or offline names explicit and propagates availability failures", () => {
    const entries = ["/external/blog", "/scratch/blog"].map((path, index) => ({ id: String(index), name: "Site", path, createdBy: "Web", lastOpened: null }));
    const input = { home: "/home/sites", fallback: "/repo/sites/dev", selected: "blog", entries,
      listDirectories: () => [], isInitialized: () => false };
    for (const available of [false, true]) {
      expect(() => selectWorkspaceDirectory(input, { isAvailable: () => available })).toThrow("Select its registry ID");
    }
    expect(() => selectWorkspaceDirectory(input, { isAvailable: () => { throw new Error("storage unavailable"); } })).toThrow("storage unavailable");
    expect(() => selectWorkspaceDirectory(input)).toThrow("Select its registry ID");
  });
});
