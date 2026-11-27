import { describe, expect, it } from "vitest";

import { themeFilePutRoute, type ThemeFilePutInput, type ThemeFilePutRouteDeps } from "../explore-file-put.js";
import { baseDeps, FILE_ERROR_CASES, PRINCIPAL, raw, recordingAuthorize, refusalOf, signal, THEME_SET } from "./explore-helpers.js";

function deps(overrides: Partial<ThemeFilePutRouteDeps> = {}) {
  const base = baseDeps();
  return {
    ...base,
    resolveWriteScope: ({ path }: { path: string }) => (path.startsWith("dist/") ? { kind: "generated-readonly", reason: "built output" } : { kind: "editable" }),
    isPutWritable: ({ path }: { path: string }) => !path.endsWith(".md"),
    writeThemeFile: ({ path, content, overwriteOversized }: { path: string; content: string; overwriteOversized: boolean }) => { base.log.push(`write:${path}:${content}:${overwriteOversized}`); },
    reloadTheme: ({ themeId }: { themeId: string }) => { base.log.push(`reload:${themeId}`); },
    ...overrides,
  };
}

const input = (over: Partial<ThemeFilePutInput> = {}): ThemeFilePutInput => ({ themeId: "t1", path: "styles.css", content: "a{}", overwriteOversized: false, ...over });
const run = (d: ThemeFilePutRouteDeps, i = input(), authorize = recordingAuthorize().authorize) =>
  themeFilePutRoute.handle({ input: i, deps: d, context: PRINCIPAL, authorize }, { signal });

describe("themeFilePutRoute", () => {
  it("keeps method, path and no own body cap; overwriteOversized is only the boolean true", () => {
    expect([themeFilePutRoute.method, themeFilePutRoute.path, themeFilePutRoute.maxBodyBytes]).toEqual(["put", "/api/admin/v1/workspaces/:workspaceId/themes/:themeId/file", undefined]);
    expect(themeFilePutRoute.parse(raw({ themeId: "t1" }, { path: "a.css", content: "x", overwriteOversized: true }))).toEqual({ ok: true, value: { themeId: "t1", path: "a.css", content: "x", overwriteOversized: true } });
    expect(themeFilePutRoute.parse(raw({ themeId: "t1" }, { path: "a.css", content: 5, overwriteOversized: "true" }))).toEqual({ ok: true, value: { themeId: "t1", path: "a.css", content: 5, overwriteOversized: false } });
    expect(themeFilePutRoute.parse(raw({}, null))).toEqual({ ok: true, value: { themeId: "", path: "", content: undefined, overwriteOversized: false } });
  });

  it("authorizes, writes, reloads, and answers the UTF-8 byte length", async () => {
    const d = deps();
    const { authorize, calls } = recordingAuthorize();
    expect(await run(d, input({ content: "é€😀", overwriteOversized: true }), authorize)).toEqual({ ok: true, value: { path: "styles.css", bytes: 9 } });
    expect(calls).toEqual([THEME_SET]);
    expect(d.log).toEqual(["find:t1", "write:styles.css:é€😀:true", "reload:t1"]);
  });

  it("refuses in the host's order: theme 404, content 400, inherited 403, generated 403, read-only 403 — writing nothing", async () => {
    const d = deps();
    expect(await refusalOf(() => run(d, input({ themeId: "x", content: 1 })))).toEqual({ status: 404, body: { error: "theme 'x' was not found" } });
    expect(await refusalOf(() => run(d, input({ path: "templates/base.liquid", content: 1 })))).toEqual({ status: 400, body: { error: "content must be a string", code: "INVALID_BODY" } });
    expect(await refusalOf(() => run(d, input({ path: "templates/base.liquid" })))).toEqual({ status: 403, body: { error: "'templates/base.liquid' is inherited from the bundled theme and is read-only", code: "READ_ONLY_FILE" } });
    expect(await refusalOf(() => run(d, input({ path: "dist/a.md" })))).toEqual({ status: 403, body: { error: "'dist/a.md' is read-only: built output", code: "GENERATED_READONLY" } });
    expect(await refusalOf(() => run(d, input({ path: "README.md" })))).toEqual({ status: 403, body: { error: "'README.md' is read-only in Explore and cannot be saved", code: "READ_ONLY_FILE" } });
    expect(d.log.filter((entry) => !entry.startsWith("find:"))).toEqual([]);
  });

  it("maps file errors from the write and rethrows anything else", async () => {
    for (const [err, refusal] of FILE_ERROR_CASES) expect(await refusalOf(() => run(deps({ writeThemeFile: () => { throw err; } })))).toEqual(refusal);
    await expect(run(deps({ reloadTheme: () => { throw new Error("ENOSPC"); } }))).rejects.toThrow("ENOSPC");
  });

  it("writes nothing when authorization refuses, and fails closed without an authorizer", async () => {
    const d = deps();
    await expect(run(d, input(), recordingAuthorize(true).authorize)).rejects.toThrow("denied");
    await expect(themeFilePutRoute.handle({ input: input(), deps: d, context: PRINCIPAL })).rejects.toThrow(/no authorizer/);
    expect(d.log).toEqual([]);
  });
});

it("edits a physical file even when the theme has no inherited-source inventory", async () => {
  const d = deps({ findTheme: ({ themeId }) => themeId === "plain" ? { manifest: { id: "plain" } } : undefined });
  expect(await run(d, input({ themeId: "plain", path: "plain.css", content: ".f{}" })))
    .toEqual({ ok: true, value: { path: "plain.css", bytes: 4 } });
  expect(d.log).toEqual(["write:plain.css:.f{}:false", "reload:plain"]);
});

it("relays a classified string as the host's invalid path refusal without reloading", async () => {
  const reason = "The file is not inside the theme directory.";
  const d = deps({ writeThemeFile: () => { throw reason; }, isThemePathError: ({ err }) => err === reason });
  expect(await refusalOf(() => run(d))).toEqual({ status: 400, body: { error: reason, code: "INVALID_THEME_PATH" } });
  expect(d.log).toEqual(["find:t1"]);
});
