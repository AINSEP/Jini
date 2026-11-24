import { describe, expect, it } from "vitest";

import { themeSaveOriginalRoute, type ThemeSaveOriginalRouteDeps } from "../explore-save-original.js";
import { baseDeps, FILE_ERROR_CASES, fakeTheme, PRINCIPAL, raw, recordingAuthorize, refusalOf, signal, THEME_SET } from "./explore-helpers.js";

function deps(save: ThemeSaveOriginalRouteDeps["saveThemeAsOriginal"] = () => ({ ok: true })) {
  return { ...baseDeps(), saveThemeAsOriginal: save };
}

const run = (d: ThemeSaveOriginalRouteDeps, themeId = "t1", authorize = recordingAuthorize().authorize) =>
  themeSaveOriginalRoute.handle({ input: { themeId }, deps: d, context: PRINCIPAL, authorize }, { signal });

describe("themeSaveOriginalRoute", () => {
  it("keeps method, path and no own body cap, reading :themeId with an empty fallback", () => {
    expect([themeSaveOriginalRoute.method, themeSaveOriginalRoute.path, themeSaveOriginalRoute.maxBodyBytes]).toEqual(["post", "/api/admin/v1/workspaces/:workspaceId/themes/:themeId/original", undefined]);
    expect(themeSaveOriginalRoute.parse(raw({}))).toEqual({ ok: true, value: { themeId: "" } });
  });

  it("authorizes theme.set, saves the found theme and answers its id", async () => {
    const seen: unknown[] = [];
    const { authorize, calls } = recordingAuthorize();
    const result = await run(deps(({ theme }) => { seen.push(theme); return { ok: true }; }), "t1", authorize);
    expect(calls).toEqual([THEME_SET]);
    expect(seen).toEqual([fakeTheme()]);
    expect(result).toEqual({ ok: true, value: { themeId: "t1", saved: true } });
  });

  it("refuses an unknown theme 404 and a refused save 409 with the service's own message and code", async () => {
    expect(await refusalOf(() => run(deps(), "nope"))).toEqual({ status: 404, body: { error: "theme 'nope' was not found" } });
    expect(await refusalOf(() => run(deps(() => ({ ok: false, message: "already has an original", code: "ORIGINAL_EXISTS" }))))).toEqual({
      status: 409, body: { error: "already has an original", code: "ORIGINAL_EXISTS" },
    });
  });

  it("maps file errors and rethrows anything else for the host 500", async () => {
    for (const [err, refusal] of FILE_ERROR_CASES) expect(await refusalOf(() => run(deps(() => { throw err; })))).toEqual(refusal);
    await expect(run(deps(() => { throw new Error("EIO"); }))).rejects.toThrow("EIO");
  });

  it("does not save when authorization refuses, and fails closed without an authorizer", async () => {
    let saves = 0;
    const d = deps(() => { saves += 1; return { ok: true }; });
    await expect(run(d, "t1", recordingAuthorize(true).authorize)).rejects.toThrow("denied");
    await expect(themeSaveOriginalRoute.handle({ input: { themeId: "t1" }, deps: d, context: PRINCIPAL })).rejects.toThrow(/no authorizer/);
    expect(saves).toBe(0);
  });
});
