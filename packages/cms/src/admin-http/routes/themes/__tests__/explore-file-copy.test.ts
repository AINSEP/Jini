import { describe, expect, it } from "vitest";

import { themeFileCopyRoute, type ThemeFileCopyRouteDeps } from "../explore-file-copy.js";
import { baseDeps, FILE_ERROR_CASES, PRINCIPAL, raw, recordingAuthorize, refusalOf, signal, THEME_SET } from "./explore-helpers.js";

const entry = (path: string) => ({ path, group: "style", readable: true, editable: true, resettable: false, modified: null, published: null, collidingContent: null });

function deps(overrides: Partial<ThemeFileCopyRouteDeps> = {}) {
  const base = baseDeps();
  return {
    ...base,
    resolveWriteScope: ({ path }: { path: string }) => (path.startsWith("dist/") ? { kind: "generated-readonly", reason: "built" } : { kind: "editable" }),
    reloadTheme: ({ themeId }: { themeId: string }) => { base.log.push(`reload:${themeId}`); },
    isGeneratedThemePath: ({ path }: { path: string }) => path.startsWith("preview/"),
    listThemeFiles: () => ["css/site.css", "css/site-1.css", "dist/a.js", "preview/p.html"],
    nextAvailableFileName: ({ desiredPath, existingPaths }: { desiredPath: string; existingPaths: ReadonlySet<string> }) => (existingPaths.has("css/site-1.css") ? desiredPath.replace(".css", "-2.css") : "?"),
    copyThemeFile: ({ sourcePath, destPath }: { sourcePath: string; destPath: string }) => { base.log.push(`copy:${sourcePath}->${destPath}`); },
    describeThemeFile: ({ path }: { path: string }) => { base.log.push(`describe:${path}`); return entry(path); },
    ...overrides,
  };
}

const run = (d: ThemeFileCopyRouteDeps, path = "css/site.css", authorize = recordingAuthorize().authorize) =>
  themeFileCopyRoute.handle({ input: { themeId: "t1", path }, deps: d, context: PRINCIPAL, authorize }, { signal });

describe("themeFileCopyRoute", () => {
  it("keeps method, path and no own body cap; parses path with empty fallbacks", () => {
    expect([themeFileCopyRoute.method, themeFileCopyRoute.path, themeFileCopyRoute.maxBodyBytes]).toEqual(["post", "/api/admin/v1/workspaces/:workspaceId/themes/:themeId/file/copy", undefined]);
    expect(themeFileCopyRoute.parse(raw({ themeId: "t1" }, { path: "a.css", name: "ignored" }))).toEqual({ ok: true, value: { themeId: "t1", path: "a.css" } });
  });

  it("copies to the next free name, reloads, then describes the copy", async () => {
    const d = deps();
    const { authorize, calls } = recordingAuthorize();
    expect(await run(d, "css/site.css", authorize)).toEqual({ ok: true, value: { ...entry("css/site-2.css"), copiedFrom: "css/site.css" } });
    expect(calls).toEqual([THEME_SET]);
    expect(d.log).toEqual(["find:t1", "copy:css/site.css->css/site-2.css", "reload:t1", "describe:css/site-2.css"]);
  });

  it("refuses a generated-tree source, a preview/ source and a missing file, copying nothing", async () => {
    const d = deps();
    expect(await refusalOf(() => run(d, "dist/a.js"))).toEqual({ status: 409, body: { error: "'dist/a.js' is read-only: built", code: "GENERATED_READONLY" } });
    expect(await refusalOf(() => run(d, "preview/p.html"))).toEqual({ status: 409, body: { error: "'preview/p.html' is generated output and cannot be copied", code: "READ_ONLY_FILE" } });
    expect(await refusalOf(() => run(d, "gone.css"))).toEqual({ status: 404, body: { error: "file 'gone.css' was not found in this theme", code: "FILE_NOT_FOUND" } });
    expect(d.log).toEqual(["find:t1", "find:t1", "find:t1"]);
  });

  it("maps file errors, rethrows the rest, and does nothing without authorization", async () => {
    for (const [err, refusal] of FILE_ERROR_CASES) expect(await refusalOf(() => run(deps({ copyThemeFile: () => { throw err; } })))).toEqual(refusal);
    await expect(run(deps({ copyThemeFile: () => { throw new Error("EXDEV"); } }))).rejects.toThrow("EXDEV");
    const d = deps();
    await expect(run(d, "css/site.css", recordingAuthorize(true).authorize)).rejects.toThrow("denied");
    await expect(themeFileCopyRoute.handle({ input: { themeId: "t1", path: "a" }, deps: d, context: PRINCIPAL })).rejects.toThrow(/no authorizer/);
    expect(await refusalOf(() => run({ ...deps(), findTheme: () => undefined }))).toEqual({ status: 404, body: { error: "theme 't1' was not found" } });
    expect(d.log).toEqual([]);
  });
});
