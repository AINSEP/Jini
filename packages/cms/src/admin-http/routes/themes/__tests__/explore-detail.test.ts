import { describe, expect, it } from "vitest";

import { themeDetailRoute, type ExploreThemeDetailSource, type ThemeDetailRouteDeps } from "../explore-detail.js";
import { PRINCIPAL, raw, recordingAuthorize, refusalOf, signal, THEME_SET } from "./explore-helpers.js";

const THEME: ExploreThemeDetailSource = {
  manifest: { id: "t1", name: "Theme One", tier: "static", apiVersion: 2 },
  status: "valid", errors: [], pages: { index: "", about: "" }, partials: { nav: "", footer: "" },
  inheritedTemplateSources: { "templates/post.liquid": "{{ post }}" },
};
const FILE = { path: "pages/index.html", group: "page", readable: true, editable: true, resettable: false, modified: null, published: null, collidingContent: null };

function deps(theme: ExploreThemeDetailSource = THEME, describe: ThemeDetailRouteDeps["describeThemeFiles"] = async () => ({ files: [FILE], hasOriginal: true })): ThemeDetailRouteDeps {
  return { findTheme: ({ themeId }) => (themeId === theme.manifest.id ? theme : undefined), describeThemeFiles: describe };
}

const run = (d: ThemeDetailRouteDeps, themeId = "t1", authorize = recordingAuthorize().authorize) =>
  themeDetailRoute.handle({ input: { themeId }, deps: d, context: PRINCIPAL, authorize }, { signal });

describe("themeDetailRoute", () => {
  it("keeps method and path, reading :themeId with an empty fallback", () => {
    expect([themeDetailRoute.method, themeDetailRoute.path]).toEqual(["get", "/api/admin/v1/workspaces/:workspaceId/themes/:themeId"]);
    expect(themeDetailRoute.parse(raw({}))).toEqual({ ok: true, value: { themeId: "" } });
  });

  it("authorizes theme.set and answers the manifest, sorted pages/partials, described files then inherited sources", async () => {
    const { authorize, calls } = recordingAuthorize();
    const result = await run(deps(), "t1", authorize);
    expect(calls).toEqual([THEME_SET]);
    expect(result).toEqual({ ok: true, value: {
      id: "t1", name: "Theme One", tier: "static", apiVersion: 2, status: "valid", errors: [],
      pages: ["about", "index"], partials: ["footer", "nav"],
      files: [FILE, { path: "templates/post.liquid", group: "page", readable: true, editable: false, resettable: false, modified: null, published: null, collidingContent: null, inherited: true }],
      hasOriginal: true,
    } });
    // Key order is the wire's key order.
    expect(Object.keys((result as { value: object }).value)).toEqual(["id", "name", "tier", "apiVersion", "status", "errors", "pages", "partials", "files", "hasOriginal"]);
  });

  it("lists no inherited entries for a theme without inherited sources", async () => {
    const plain: ExploreThemeDetailSource = { manifest: THEME.manifest, status: THEME.status, errors: [], pages: {}, partials: {} };
    const result = await run(deps(plain, async () => ({ files: [], hasOriginal: false })));
    expect(result).toMatchObject({ ok: true, value: { files: [], hasOriginal: false } });
  });

  it("refuses an unknown theme 404 and lets every describe failure reach the host 500 unmapped", async () => {
    expect(await refusalOf(() => run(deps(), "nope"))).toEqual({ status: 404, body: { error: "theme 'nope' was not found" } });
    await expect(run(deps(THEME, async () => { throw new Error("content store offline"); }))).rejects.toThrow("content store offline");
  });

  it("describes nothing when authorization refuses, and fails closed without an authorizer", async () => {
    let described = 0;
    const d = deps(THEME, async () => { described += 1; return { files: [], hasOriginal: false }; });
    await expect(run(d, "t1", recordingAuthorize(true).authorize)).rejects.toThrow("denied");
    await expect(themeDetailRoute.handle({ input: { themeId: "t1" }, deps: d, context: PRINCIPAL })).rejects.toThrow(/no authorizer/);
    expect(described).toBe(0);
  });
});
