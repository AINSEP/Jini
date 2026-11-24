import { describe, expect, it } from "vitest";

import { themeFileDeleteRoute, type ThemeFileDeleteRouteDeps } from "../explore-file-delete.js";
import { baseDeps, FILE_ERROR_CASES, PRINCIPAL, raw, recordingAuthorize, refusalOf, signal, THEME_SET } from "./explore-helpers.js";

function deps(overrides: Partial<ThemeFileDeleteRouteDeps> = {}) {
  const base = baseDeps();
  return {
    ...base,
    checkFileIdentityChange: ({ path, action }: { path: string; action: string }) => { base.log.push(`lock:${action}:${path}`); return null; },
    listThemeFiles: () => { base.log.push("list"); return ["pages/about.html", "theme.json"]; },
    trashThemeFile: ({ path }: { path: string }) => { base.log.push(`trash:${path}`); },
    ...overrides,
  };
}

const run = (d: ThemeFileDeleteRouteDeps, path = "pages/about.html", authorize = recordingAuthorize().authorize) =>
  themeFileDeleteRoute.handle({ input: { themeId: "t1", path }, deps: d, context: PRINCIPAL, authorize }, { signal });

describe("themeFileDeleteRoute", () => {
  it("keeps method, path and no own body cap; parses path from the body with empty fallbacks", () => {
    expect([themeFileDeleteRoute.method, themeFileDeleteRoute.path, themeFileDeleteRoute.maxBodyBytes]).toEqual(["post", "/api/admin/v1/workspaces/:workspaceId/themes/:themeId/file/delete", undefined]);
    expect(themeFileDeleteRoute.parse(raw({ themeId: "t1" }, { path: "a.css" }))).toEqual({ ok: true, value: { themeId: "t1", path: "a.css" } });
    expect(themeFileDeleteRoute.parse(raw({}, undefined))).toEqual({ ok: true, value: { themeId: "", path: "" } });
  });

  it("authorizes, lock-checks as a delete, confirms the file exists, then trashes it", async () => {
    const d = deps();
    const { authorize, calls } = recordingAuthorize();
    expect(await run(d, "pages/about.html", authorize)).toEqual({ ok: true, value: { path: "pages/about.html", deleted: true } });
    expect(calls).toEqual([THEME_SET]);
    expect(d.log).toEqual(["find:t1", "lock:deleted:pages/about.html", "list", "trash:pages/about.html"]);
  });

  it("answers the lock's own refusal and a missing file's 404, trashing nothing", async () => {
    const locked = deps({ checkFileIdentityChange: () => ({ status: 403, error: "'theme.json' is required", code: "REQUIRED_FILE" }) });
    expect(await refusalOf(() => run(locked, "theme.json"))).toEqual({ status: 403, body: { error: "'theme.json' is required", code: "REQUIRED_FILE" } });
    const d = deps();
    expect(await refusalOf(() => run(d, "gone.css"))).toEqual({ status: 404, body: { error: "file 'gone.css' was not found in this theme", code: "FILE_NOT_FOUND" } });
    expect(d.log).not.toContain("trash:gone.css");
  });

  it("maps file errors from the trash move and rethrows anything else", async () => {
    for (const [err, refusal] of FILE_ERROR_CASES) expect(await refusalOf(() => run(deps({ trashThemeFile: () => { throw err; } })))).toEqual(refusal);
    await expect(run(deps({ trashThemeFile: () => { throw new Error("EACCES"); } }))).rejects.toThrow("EACCES");
  });

  it("does nothing when authorization refuses or the theme is unknown", async () => {
    const d = deps();
    await expect(run(d, "pages/about.html", recordingAuthorize(true).authorize)).rejects.toThrow("denied");
    expect(d.log).toEqual([]);
    expect(await refusalOf(() => themeFileDeleteRoute.handle({ input: { themeId: "x", path: "a" }, deps: d, context: PRINCIPAL, authorize: recordingAuthorize().authorize }))).toEqual({ status: 404, body: { error: "theme 'x' was not found" } });
    await expect(themeFileDeleteRoute.handle({ input: { themeId: "t1", path: "a" }, deps: d, context: PRINCIPAL })).rejects.toThrow(/no authorizer/);
  });
});
