import { describe, expect, it } from "vitest";

import { themeFileRenameRoute, validateRenameTargetName, type ThemeFileRenameRouteDeps } from "../explore-file-rename.js";
import { baseDeps, FILE_ERROR_CASES, PRINCIPAL, raw, recordingAuthorize, refusalOf, signal, THEME_SET } from "./explore-helpers.js";

const entry = (path: string) => ({ path, group: "page", readable: true, editable: true, resettable: false, modified: null, published: false, collidingContent: null });

function deps(overrides: Partial<ThemeFileRenameRouteDeps> = {}) {
  const base = baseDeps();
  return {
    ...base,
    checkFileIdentityChange: ({ path, action }: { path: string; action: string }) => (path === "theme.json" ? { status: 403, error: `'theme.json' cannot be ${action}`, code: "REQUIRED_FILE" } : null),
    listThemeFiles: () => ["pages/about.html", "theme.json", "logo.svg"],
    renameThemeFileIfChanged: ({ sourcePath, destPath, existingPaths }: { sourcePath: string; destPath: string; existingPaths: ReadonlySet<string> }) => {
      base.log.push(`rename:${sourcePath}->${destPath}:${existingPaths.size}`);
      return destPath.endsWith(".txt") ? { status: 400, error: "extension change", code: "EXTENSION_CHANGE_NOT_ALLOWED" } : null;
    },
    describeThemeFile: ({ path }: { path: string }) => entry(path),
    ...overrides,
  };
}

const run = (d: ThemeFileRenameRouteDeps, path: string, name: string, authorize = recordingAuthorize().authorize) =>
  themeFileRenameRoute.handle({ input: { themeId: "t1", path, name }, deps: d, context: PRINCIPAL, authorize }, { signal });

describe("themeFileRenameRoute", () => {
  it("keeps method, path and no own body cap; parses path and name with empty fallbacks", () => {
    expect([themeFileRenameRoute.method, themeFileRenameRoute.path, themeFileRenameRoute.maxBodyBytes]).toEqual(["post", "/api/admin/v1/workspaces/:workspaceId/themes/:themeId/file/rename", undefined]);
    expect(themeFileRenameRoute.parse(raw({ themeId: "t1" }, { path: "a.css", name: "b.css" }))).toEqual({ ok: true, value: { themeId: "t1", path: "a.css", name: "b.css" } });
    expect(themeFileRenameRoute.parse(raw({}, null))).toEqual({ ok: true, value: { themeId: "", path: "", name: "" } });
  });

  it("validates the target as a bare filename", () => {
    expect(validateRenameTargetName({ name: "" })).toBe("name is required");
    for (const name of ["a/b.html", "a\\b.html", ".", ".."]) expect(validateRenameTargetName({ name })).toBe(`name '${name}' must be a plain filename in the same folder, not a path`);
    expect(validateRenameTargetName({ name: "ok.html" })).toBeNull();
  });

  it("renames within the source folder and describes the destination; a top-level file stays top-level", async () => {
    const d = deps();
    const { authorize, calls } = recordingAuthorize();
    expect(await run(d, "pages/about.html", "team.html", authorize)).toEqual({ ok: true, value: { ...entry("pages/team.html"), renamedFrom: "pages/about.html" } });
    expect(calls).toEqual([THEME_SET]);
    expect(await run(d, "logo.svg", "mark.svg")).toMatchObject({ ok: true, value: { path: "mark.svg", renamedFrom: "logo.svg" } });
    expect(d.log).toEqual(["find:t1", "rename:pages/about.html->pages/team.html:3", "find:t1", "rename:logo.svg->mark.svg:3"]);
  });

  it("refuses in order: identity lock, bad name, missing file, then the host rename's own refusal", async () => {
    const d = deps();
    expect(await refusalOf(() => run(d, "theme.json", "../x"))).toEqual({ status: 403, body: { error: "'theme.json' cannot be renamed", code: "REQUIRED_FILE" } });
    expect(await refusalOf(() => run(d, "gone.html", "a/b"))).toEqual({ status: 400, body: { error: "name 'a/b' must be a plain filename in the same folder, not a path", code: "INVALID_NAME" } });
    expect(await refusalOf(() => run(d, "gone.html", "b.html"))).toEqual({ status: 404, body: { error: "file 'gone.html' was not found in this theme", code: "FILE_NOT_FOUND" } });
    expect(await refusalOf(() => run(d, "logo.svg", "logo.txt"))).toEqual({ status: 400, body: { error: "extension change", code: "EXTENSION_CHANGE_NOT_ALLOWED" } });
  });

  it("maps file errors, rethrows the rest, and does nothing without authorization", async () => {
    for (const [err, refusal] of FILE_ERROR_CASES) expect(await refusalOf(() => run(deps({ renameThemeFileIfChanged: () => { throw err; } }), "logo.svg", "m.svg"))).toEqual(refusal);
    await expect(run(deps({ listThemeFiles: () => { throw new Error("EIO"); } }), "logo.svg", "m.svg")).rejects.toThrow("EIO");
    const d = deps();
    await expect(run(d, "logo.svg", "m.svg", recordingAuthorize(true).authorize)).rejects.toThrow("denied");
    await expect(themeFileRenameRoute.handle({ input: { themeId: "t1", path: "a", name: "b" }, deps: d, context: PRINCIPAL })).rejects.toThrow(/no authorizer/);
    expect(d.log).toEqual([]);
  });
});
