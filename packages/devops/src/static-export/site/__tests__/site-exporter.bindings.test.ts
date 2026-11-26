import { expect, test, vi } from "vitest";
import { exportHostSite, selectDeclaredThemeScripts, type ExportSiteRouteDeps } from "../site-exporter.js";
import type { ExportSiteArgs } from "../../contracts.js";

const runner = vi.hoisted(() => ({ run: vi.fn(async (_args: ExportSiteArgs, _options: unknown) => ({
  routes: { succeeded: [], failed: [] }, assets: { succeeded: [], failed: [] },
  skippedManifestEntries: [], unreferencedThemeFiles: [], droppedReferences: [],
})) }));
vi.mock("../../entry.js", () => ({ exportSite: runner.run }));

test("only the active theme's single-slash root-relative scripts are selected", () => {
  const themes = [{ manifest: { id: "active", scripts: [
    { src: "/theme-assets/active.js" }, { src: "//external.example/script.js" },
    { src: "https://external.example/script.js" }, { src: "relative.js" },
  ] } }, { manifest: { id: "inactive", scripts: [{ src: "/theme-assets/inactive.js" }] } }];
  expect(selectDeclaredThemeScripts({ themes, activeThemeId: "active" })).toEqual(["/theme-assets/active.js"]);
  expect(selectDeclaredThemeScripts({ themes, activeThemeId: "inactive" })).toEqual(["/theme-assets/inactive.js"]);
  expect(selectDeclaredThemeScripts({ themes, activeThemeId: undefined })).toEqual([]);
});

function fixture() {
  const buildPreviewExportManifest = vi.fn(async (_required: Parameters<ExportSiteRouteDeps["buildPreviewExportManifest"]>[0], _optional: Parameters<ExportSiteRouteDeps["buildPreviewExportManifest"]>[1]) => ({ manifest: { routes: [], skipped: [], activeTheme: { id: "active" } }, themeCount: 1 }));
  const routeDeps = { workspaceId: "site", clock: { nowIso: () => "now" },
    originRegistry: { canonicalOrigin: async () => { throw new Error("none"); } },
    fetch: globalThis.fetch,
    trackFetch: ({ fetch }: { fetch: typeof globalThis.fetch }) => fetch,
    createSiteApp: vi.fn(() => () => {}), buildPreviewExportManifest,
    cookieConsent: { exportAssets: async () => ["/_consent/runtime.js"] },
    preflightCopy: { contactEmailPlaceholder: "CONTACT", placeholderWarning: () => undefined, thirdPartyWarning: () => undefined },
    declaredThemeAssets: ({ activeThemeId }: { activeThemeId: string | undefined }) => selectDeclaredThemeScripts({
      themes: [{ manifest: { id: "active", scripts: [{ src: "/theme-assets/active.js" }] } }], activeThemeId,
    }),
  } as unknown as ExportSiteRouteDeps;
  return { routeDeps, buildPreviewExportManifest };
}

test("consent assets join declared scripts, the destination URL owns the prefix, and export uses host fetch", async () => {
  const { routeDeps } = fixture();
  const bytes = Buffer.from("fixture");
  const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(bytes, { headers: { "content-type": "application/octet-stream" } }));
  const globalFetch = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("unexpected global fetch"));
  try {
    await exportHostSite({ routeDeps: { ...routeDeps, fetch,
      bindExportMediaUrls: () => ({ workspaceId: routeDeps.workspaceId, originRegistry: routeDeps.originRegistry,
        findMedia: vi.fn(), resolveContentTypes: vi.fn(), mediaPublicPath: vi.fn() }),
    }, outputDir: "/unused-export", publicUrl: "https://destination.example/copy", basePath: "/ignored" });
    const [args, options] = runner.run.mock.calls.at(-1)!;
    expect(options).toEqual({ basePath: "/copy" });
    expect(typeof args.assetUrls === "function" ? await args.assetUrls() : args.assetUrls).toEqual(["/theme-assets/active.js", "/_consent/runtime.js"]);
    const url = "http://localhost:1234/assets/fixture.bin";
    const init = { headers: { "x-export-fixture": "binding" } };
    const response = await args.fetch({ url }, { init });
    expect(fetch.mock.calls).toEqual([[url, init]]);
    expect(Buffer.from(await response.arrayBuffer())).toEqual(bytes);
    expect(globalFetch).not.toHaveBeenCalled();
  } finally { globalFetch.mockRestore(); }
});

test("an explicit theme suppresses previews and is passed only to the fresh app", async () => {
  const { routeDeps, buildPreviewExportManifest } = fixture();
  await exportHostSite({ routeDeps, outputDir: "/unused-export", themeId: "selected", includeThemePreviews: true });
  expect(buildPreviewExportManifest.mock.calls.at(-1)?.[1]).toEqual({ includeThemePreviews: false });
  expect(routeDeps.createSiteApp).toHaveBeenCalledWith({ themeId: "selected" });
});
