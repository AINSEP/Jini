import { expect, it, vi } from "vitest";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { exportHostSite, type ExportSiteRouteDeps } from "../site-exporter.js";
import type { ExportSiteArgs, ExportSiteOptions } from "../../contracts.js";

const runner = vi.hoisted(() => ({ run: vi.fn() }));
vi.mock("../../entry.js", async importOriginal => ({ ...await importOriginal<object>(), exportSite: runner.run }));

function fixture() {
  const routes = [{ path: "/", kind: "home", label: "Home" }, { path: "/sitemap.xml", kind: "well-known", label: "Sitemap" }, { path: "/feed.xml", kind: "well-known", label: "Feed" }];
  const deps = { workspaceId: "w", clock: { nowIso: () => "2026-11-25T00:00:00Z" }, originRegistry: { canonicalOrigin: async () => { throw new Error("none"); } },
    fetch: globalThis.fetch,
    trackFetch: ({ fetch }: { fetch: typeof globalThis.fetch }) => fetch, createSiteApp: () => () => {},
    buildPreviewExportManifest: async () => ({ manifest: { routes, skipped: [] }, themeCount: 1 }),
    cookieConsent: { exportWarning: async () => "Consent first.", exportAssets: async () => ["/_consent/runtime.js"] },
    preflightCopy: { contactEmailPlaceholder: "CONTACT", placeholderWarning: ({ pages }: { pages: number }) => pages ? "Placeholder second." : undefined, thirdPartyWarning: ({ pages }: { pages: number }) => pages ? "Scripts third." : undefined },
    themeLayout: { resolve: () => ({ pagesDir: "pages", assetUrlPrefix: "/theme-assets/theme/" }) }, declaredThemeAssets: () => [], assetUrlPrefixes: ["/theme-assets/"], requestHeaders: { "x-tovu-static-export": "1" },
    exportHtml: ({ html }: { html: string }) => html, withoutNativeFormTools: (html: string) => html, publicPageSecurityHeaders: () => ({}),
    extractListingMoreHrefs: () => [], extractListingPageHrefs: () => [], listingJsonNextPath: () => undefined,
  } as unknown as ExportSiteRouteDeps;
  runner.run.mockImplementation(async (args: ExportSiteArgs, options: ExportSiteOptions) => {
    await args.writer.prepare({ outputDir: args.outputDir }, options.clean === undefined ? {} : { clean: options.clean });
    if (typeof args.assetUrls === "function") await args.assetUrls();
    args.security.transformHtml({ html: 'CONTACT<script src="https://other.example/script.js"></script>' });
    return { outputDir: args.outputDir, routes: { succeeded: [], failed: [] }, assets: { succeeded: [], failed: [] }, skippedManifestEntries: [], unreferencedThemeFiles: [], droppedReferences: [], basePath: options.basePath, basePathRewriteWarning: "Rewrite limit." };
  });
  return deps;
}

it("the destination public URL overrides an explicit base path, reports warning order, and uses host fetch", async () => {
  const outputDir = await mkdtemp(path.join(tmpdir(), "wmz-export-"));
  const routeDeps = fixture();
  const bytes = Buffer.from("fixture");
  const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(bytes, { headers: { "content-type": "application/octet-stream" } }));
  const globalFetch = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("unexpected global fetch"));
  try {
    const result = await exportHostSite({ routeDeps: { ...routeDeps, fetch,
      bindExportMediaUrls: () => ({ workspaceId: routeDeps.workspaceId, originRegistry: routeDeps.originRegistry,
        findMedia: vi.fn(), resolveContentTypes: vi.fn(), mediaPublicPath: vi.fn() }),
    }, outputDir, publicUrl: "https://destination.example/copy", basePath: "/ignored" });
    const [args, options] = runner.run.mock.calls.at(-1)! as [ExportSiteArgs, ExportSiteOptions];
    expect(options).toEqual({ basePath: "/copy" });
    expect(result.basePathRewriteWarning).toBe("The base path was ignored because the public URL sets the path. Rewrite limit.");
    expect(result.consentWarning).toBe("Consent first. Placeholder second. Scripts third.");
    const url = "http://localhost:1234/assets/fixture.bin";
    const init = { headers: { "x-export-fixture": "route" } };
    const response = await args.fetch({ url }, { init });
    expect(fetch.mock.calls).toEqual([[url, init]]);
    expect(Buffer.from(await response.arrayBuffer())).toEqual(bytes);
    expect(globalFetch).not.toHaveBeenCalled();
  } finally {
    globalFetch.mockRestore();
    await rm(outputDir, { recursive: true, force: true });
  }
});

it("without public origin omits discovery routes and removes their stale output", async () => {
  const outputDir = await mkdtemp(path.join(tmpdir(), "wmz-export-"));
  try {
    await writeFile(path.join(outputDir, "sitemap.xml"), "stale"); await writeFile(path.join(outputDir, "feed.xml"), "stale");
    await exportHostSite({ routeDeps: fixture(), outputDir });
    const args = runner.run.mock.calls.at(-1)![0] as ExportSiteArgs;
    expect((await args.manifest.build({})).routes.map(route => route.path)).toEqual(["/"]);
    await expect(readFile(path.join(outputDir, "sitemap.xml"))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(path.join(outputDir, "feed.xml"))).rejects.toMatchObject({ code: "ENOENT" });
  } finally { await rm(outputDir, { recursive: true, force: true }); }
});
