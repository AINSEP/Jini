import { describe, expect, it, vi } from "vitest";
import type { RouteManifest } from "../ports.js";
import { buildPreviewExportManifest, type PreviewExportManifestPorts } from "../theme-preview-manifest.js";

describe("preview export manifest", () => {
  it("waits for site-title readiness before baseline enumeration", async () => {
    let ready!: () => void;
    const routeDeps = { siteTitleReady: new Promise<void>(resolve => { ready = resolve; }) };
    const manifest: RouteManifest = { routes: [], skipped: [] };
    const ports: PreviewExportManifestPorts<typeof routeDeps> = {
      buildManifest: vi.fn(async () => manifest),
      readPreviewConfig: vi.fn(async () => null),
      previewThemePath: ({ path }) => path,
    };
    const result = buildPreviewExportManifest({ routeDeps, ports });
    await Promise.resolve();
    expect(ports.buildManifest).not.toHaveBeenCalled();
    ready();
    expect(await result).toEqual({ manifest, themeCount: 1 });
    expect(ports.buildManifest).toHaveBeenCalledWith({ routeDeps });
  });

  it("does not read config when previews are explicitly disabled", async () => {
    const manifest: RouteManifest = { routes: [], skipped: [], activeTheme: { id: "active", dir: "/active" } };
    const ports: PreviewExportManifestPorts<{}> = {
      buildManifest: async () => manifest,
      readPreviewConfig: vi.fn(async () => ({ enabled: true, themes: [{ themeId: "variant" }] })),
      previewThemePath: ({ path }) => path,
    };
    expect(await buildPreviewExportManifest({ routeDeps: {}, ports }, { includeThemePreviews: false })).toEqual({ manifest, themeCount: 1 });
    expect(ports.readPreviewConfig).not.toHaveBeenCalled();
  });

  it.each([null, { enabled: false, themes: [{ themeId: "variant" }] }])("keeps one theme for config %j", async config => {
    const manifest: RouteManifest = { routes: [], skipped: [], activeTheme: { id: "active", dir: "/active" } };
    const ports: PreviewExportManifestPorts<{}> = {
      buildManifest: async () => manifest,
      readPreviewConfig: async () => config,
      previewThemePath: ({ path }) => path,
    };
    expect(await buildPreviewExportManifest({ routeDeps: {}, ports })).toEqual({ manifest, themeCount: 1 });
  });

  it("merges the variant after active routes, prefers its duplicate and excludes discovery routes", async () => {
    const manifest: RouteManifest = {
      activeTheme: { id: "active", dir: "/active" }, skipped: [],
      routes: [
        { path: "/shared", kind: "page", label: "active shared" },
        { path: "/active-only", kind: "page", label: "active only" },
        { path: "/robots.txt", kind: "well-known", label: "robots" },
        { path: "/old", kind: "redirect", label: "redirect" },
        { path: "/404", kind: "not-found", label: "404" },
      ],
    };
    const variant: RouteManifest = { skipped: [], routes: [
      { path: "/shared", kind: "page", label: "variant shared" },
      { path: "/variant-only", kind: "theme-page", label: "variant only" },
      { path: "/feed.xml", kind: "well-known", label: "feed" },
      { path: "/variant-old", kind: "redirect", label: "redirect" },
      { path: "/variant-404", kind: "not-found", label: "404" },
    ] };
    const ports: PreviewExportManifestPorts<{}> = {
      buildManifest: async ({ themeId }) => themeId === "variant" ? variant : manifest,
      readPreviewConfig: async () => ({ enabled: true, themes: [{ themeId: "active" }, { themeId: "variant" }] }),
      previewThemePath: vi.fn(({ themeId, path }) => `/_themes/${themeId}${path}`),
    };
    const result = await buildPreviewExportManifest({ routeDeps: {}, ports });
    expect(result.themeCount).toBe(2);
    expect(result.manifest.routes.slice(5)).toEqual([
      { path: "/_themes/variant/shared", kind: "page", label: "variant shared" },
      { path: "/_themes/variant/active-only", kind: "page", label: "active only" },
      { path: "/_themes/variant/variant-only", kind: "theme-page", label: "variant only" },
    ]);
    expect(ports.previewThemePath).toHaveBeenCalledWith({ themeId: "variant", activeThemeId: "active", path: "/variant-only" });
    expect(ports.previewThemePath).toHaveBeenCalledTimes(3);
  });
});
