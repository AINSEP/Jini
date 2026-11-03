import { describe, expect, it, vi } from "vitest";
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
    // Two live folders: the one inside a configured sites folder wins, with a warning naming both.
    const report = vi.fn();
    expect(selectWorkspaceDirectory({ ...base, entries, selected: "blog", isInitialized: initialized(["/extra/blog"]) }, { report })).toBe("/extra/blog");
    expect(report).toHaveBeenCalledOnce();
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
  it("names every offline duplicate and its ID, and propagates availability failures", () => {
    const entries = ["/external/blog", "/scratch/blog"].map((path, index) => ({ id: `id-${index}`, name: "Site", path, createdBy: "Web", lastOpened: null }));
    const input = { home: "/home/sites", fallback: "/repo/sites/dev", selected: "blog", entries,
      listDirectories: () => [], isInitialized: () => false };
    expect(() => selectWorkspaceDirectory(input, { isAvailable: () => false })).toThrow(/\/external\/blog \(id-0\).*\/scratch\/blog \(id-1\)/);
    expect(() => selectWorkspaceDirectory(input, { isAvailable: () => { throw new Error("storage unavailable"); } })).toThrow("storage unavailable");
  });
  it.each([false, true])("never dies on two live folders with one name: picks a configured root, then the newest open, warning with paths and IDs (reverse=%s)", (reverse) => {
    // A scratch copy of a site (another agent's sandbox) stays registered and initialized beside the real one.
    const real = { id: "real-id", name: "Site", path: "/docs/Workspace/fake-test-site", createdBy: "Web", lastOpened: "2026-11-01T00:00:00.000Z" };
    const scratch = { id: "scratch-id", name: "Site", path: "/users/owner/.agent/scratchpad/fake-test-site", createdBy: "Web", lastOpened: "2026-11-02T00:00:00.000Z" };
    const entries = reverse ? [scratch, real] : [real, scratch];
    const report = vi.fn();
    const input = { home: "/docs/Workspace/sites", roots: ["/docs/Workspace/sites", "/docs/Workspace"], fallback: "/repo/sites/dev", selected: "fake-test-site", entries,
      listDirectories: () => [], isInitialized: ({ path }: { path: string }) => path === real.path || path === scratch.path };
    expect(selectWorkspaceDirectory(input, { report })).toBe(real.path);
    const message = String(report.mock.calls[0]?.[0]?.message);
    for (const text of [real.path, scratch.path, "real-id", "scratch-id"]) expect(message).toContain(text);
    // Neither inside a configured root: the most recently opened one wins, independent of row order.
    expect(selectWorkspaceDirectory({ ...input, roots: ["/docs/Workspace/sites"] }, { report })).toBe(scratch.path);
  });
});
