import { describe, expect, it } from "vitest";

import { themeFileResetRoute, type ThemeFileResetRouteDeps } from "../explore-file-reset.js";
import { baseDeps, FakePathError, FakeReadOnlyError, FILE_ERROR_CASES, PRINCIPAL, raw, recordingAuthorize, refusalOf, signal, THEME_SET } from "./explore-helpers.js";

const ORIGINAL = { originalDir: "/catalog/t1" };

function deps(overrides: Partial<ThemeFileResetRouteDeps> = {}) {
  const base = baseDeps();
  return {
    ...base,
    resolveWriteScope: ({ path }: { path: string }) => (path.startsWith("dist/") ? { kind: "generated-readonly", reason: "built" } : { kind: "editable" }),
    reloadTheme: ({ themeId }: { themeId: string }) => { base.log.push(`reload:${themeId}`); },
    restoreGeneratedTree: () => { base.log.push("restore-tree"); return { restoredFiles: ["dist/a.js"] }; },
    isGeneratedThemePath: ({ path }: { path: string }) => path.startsWith("preview/"),
    resolveOriginalSource: (): unknown => ORIGINAL,
    originalLayoutMismatch: (): { message: string; code: string } | null => null,
    resetFileFromOriginal: ({ path, originalSource }: { path: string; originalSource: unknown }) => { base.log.push(`reset:${path}:${originalSource === ORIGINAL}`); return { wasModified: true, bytes: 4 }; },
    readThemeFile: ({ path }: { path: string }) => `text of ${path}`,
    maxThemeFileBytes: 10,
    ...overrides,
  };
}

const run = (d: ThemeFileResetRouteDeps, path = "styles.css", authorize = recordingAuthorize().authorize) =>
  themeFileResetRoute.handle({ input: { themeId: "t1", path }, deps: d, context: PRINCIPAL, authorize }, { signal });

describe("themeFileResetRoute", () => {
  it("keeps method, path and no own body cap; parses path with empty fallbacks", () => {
    expect([themeFileResetRoute.method, themeFileResetRoute.path, themeFileResetRoute.maxBodyBytes]).toEqual(["post", "/api/admin/v1/workspaces/:workspaceId/themes/:themeId/file/reset", undefined]);
    expect(themeFileResetRoute.parse(raw({}, null))).toEqual({ ok: true, value: { themeId: "", path: "" } });
  });

  it("resets one file from the resolved original, reloads, and answers its restored text", async () => {
    const d = deps();
    const { authorize, calls } = recordingAuthorize();
    expect(await run(d, "styles.css", authorize)).toEqual({ ok: true, value: { scope: "file", path: "styles.css", wasModified: true, bytes: 4, content: "text of styles.css" } });
    expect(calls).toEqual([THEME_SET]);
    expect(d.log).toEqual(["find:t1", "reset:styles.css:true", "reload:t1"]);
  });

  it("reports 0 bytes for an unmodified file, still reloads, and nulls content past the text limit", async () => {
    const d = deps({ resetFileFromOriginal: () => ({ wasModified: false, bytes: 11 }) });
    expect(await run(d)).toEqual({ ok: true, value: { scope: "file", path: "styles.css", wasModified: false, bytes: 0, content: null } });
    expect(d.log).toContain("reload:t1");
  });

  it("restores a built theme's generated tree whole, and a missing release is 409 NO_ORIGINAL", async () => {
    const d = deps();
    expect(await run(d, "dist/a.js")).toEqual({ ok: true, value: { scope: "release", restoredFiles: ["dist/a.js"] } });
    expect(d.log).toEqual(["find:t1", "restore-tree", "reload:t1"]);
    expect(await refusalOf(() => run(deps({ restoreGeneratedTree: () => { throw new FakePathError("no release"); } }), "dist/a.js"))).toEqual({ status: 409, body: { error: "no release", code: "NO_ORIGINAL" } });
    // Other failures fall through to the route's own mapping.
    expect(await refusalOf(() => run(deps({ restoreGeneratedTree: () => { throw new FakeReadOnlyError("ro"); } }), "dist/a.js"))).toEqual({ status: 403, body: { error: "ro", code: "GENERATED_READONLY" } });
  });

  it("refuses preview/, a theme with no original, a layout mismatch and a file not in the original — all 409", async () => {
    expect(await refusalOf(() => run(deps(), "preview/x.html"))).toEqual({ status: 409, body: { error: "'preview/x.html' is generated output and cannot be reset here", code: "READ_ONLY_FILE" } });
    expect(await refusalOf(() => run(deps({ resolveOriginalSource: () => null })))).toEqual({ status: 409, body: { error: "theme 't1' has no stored original, so nothing can be reset", code: "NO_ORIGINAL" } });
    const mismatch = deps({ originalLayoutMismatch: () => ({ message: "layout differs", code: "ORIGINAL_LAYOUT_MISMATCH" }) });
    expect(await refusalOf(() => run(mismatch))).toEqual({ status: 409, body: { error: "layout differs", code: "ORIGINAL_LAYOUT_MISMATCH" } });
    expect(mismatch.log).toEqual(["find:t1"]);
    expect(await refusalOf(() => run(deps({ resetFileFromOriginal: () => null }), "mine.css"))).toEqual({ status: 409, body: { error: "'mine.css' is not in this theme's original, so there is nothing to reset it to", code: "NOT_IN_ORIGINAL" } });
  });

  it("maps file errors, rethrows the rest, and does nothing without authorization", async () => {
    for (const [err, refusal] of FILE_ERROR_CASES) expect(await refusalOf(() => run(deps({ resetFileFromOriginal: () => { throw err; } })))).toEqual(refusal);
    await expect(run(deps({ readThemeFile: () => { throw new Error("EIO"); } }))).rejects.toThrow("EIO");
    const d = deps();
    await expect(run(d, "styles.css", recordingAuthorize(true).authorize)).rejects.toThrow("denied");
    await expect(themeFileResetRoute.handle({ input: { themeId: "t1", path: "a" }, deps: d, context: PRINCIPAL })).rejects.toThrow(/no authorizer/);
    expect(d.log).toEqual([]);
  });
});
