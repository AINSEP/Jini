import { describe, expect, it } from "vitest";

import { themeFileGetRoute, type ThemeFileGetRouteDeps } from "../explore-file-get.js";
import { baseDeps, FILE_ERROR_CASES, fakeTheme, PRINCIPAL, raw, recordingAuthorize, refusalOf, signal, THEME_SET } from "./explore-helpers.js";

function deps(read: ThemeFileGetRouteDeps["readThemeFile"] = ({ path }) => `<!-- ${path} -->`) {
  return { ...baseDeps(), readThemeFile: read };
}

const run = (d: ThemeFileGetRouteDeps, path: string, authorize = recordingAuthorize().authorize) =>
  themeFileGetRoute.handle({ input: { themeId: "t1", path }, deps: d, context: PRINCIPAL, authorize }, { signal });

describe("themeFileGetRoute", () => {
  it("keeps method and path; parses ?path= with empty fallbacks", () => {
    expect([themeFileGetRoute.method, themeFileGetRoute.path]).toEqual(["get", "/api/admin/v1/workspaces/:workspaceId/themes/:themeId/file"]);
    expect(themeFileGetRoute.parse(raw({ themeId: "t1" }, {}, { path: "a.css" }))).toEqual({ ok: true, value: { themeId: "t1", path: "a.css" } });
    expect(themeFileGetRoute.parse(raw({}))).toEqual({ ok: true, value: { themeId: "", path: "" } });
  });

  it("authorizes theme.set and reads the physical file through the injected reader", async () => {
    const { authorize, calls } = recordingAuthorize();
    expect(await run(deps(), "pages/index.html", authorize)).toEqual({ ok: true, value: { path: "pages/index.html", content: "<!-- pages/index.html -->" } });
    expect(calls).toEqual([THEME_SET]);
  });

  it("answers an inherited template source read-only, without touching disk", async () => {
    let reads = 0;
    const d = deps(() => { reads += 1; return ""; });
    expect(await run(d, "templates/base.liquid")).toEqual({ ok: true, value: { path: "templates/base.liquid", content: "{{ x }}", inherited: true, editable: false } });
    expect(reads).toBe(0);
    // An own-property check: a prototype key is not an inherited source.
    expect(await run(d, "toString")).toEqual({ ok: true, value: { path: "toString", content: "" } });
    const noInherited = { ...deps(), findTheme: () => ({ manifest: fakeTheme().manifest }) };
    expect(await run(noInherited, "templates/base.liquid")).toEqual({ ok: true, value: { path: "templates/base.liquid", content: "<!-- templates/base.liquid -->" } });
  });

  it("refuses an unknown theme 404, maps file errors and rethrows the rest", async () => {
    expect(await refusalOf(() => themeFileGetRoute.handle({ input: { themeId: "x", path: "a" }, deps: deps(), context: PRINCIPAL, authorize: recordingAuthorize().authorize }))).toEqual({ status: 404, body: { error: "theme 'x' was not found" } });
    for (const [err, refusal] of FILE_ERROR_CASES) expect(await refusalOf(() => run(deps(() => { throw err; }), "a"))).toEqual(refusal);
    await expect(run(deps(() => { throw new Error("EIO"); }), "a")).rejects.toThrow("EIO");
  });

  it("reads nothing when authorization refuses, and fails closed without an authorizer", async () => {
    const d = deps();
    await expect(run(d, "a", recordingAuthorize(true).authorize)).rejects.toThrow("denied");
    await expect(themeFileGetRoute.handle({ input: { themeId: "t1", path: "a" }, deps: d, context: PRINCIPAL })).rejects.toThrow(/no authorizer/);
    expect(d.log).toEqual([]);
  });
});
