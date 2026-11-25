import type { ManifestRoute, RouteManifest } from "./ports.js";

export interface PreviewExportManifestPorts<Deps> {
  readonly buildManifest: (
    required: { routeDeps: Deps; themeId?: string },
    optional?: Record<string, never>,
  ) => Promise<RouteManifest>;
  readonly readPreviewConfig: (
    required: { routeDeps: Deps; activeThemeId: string },
    optional?: Record<string, never>,
  ) => Promise<{ enabled: boolean; themes: readonly { themeId: string }[] } | null>;
  readonly previewThemePath: (
    required: { themeId: string; activeThemeId: string; path: string },
    optional?: Record<string, never>,
  ) => string;
}

function isHtmlPage({ route }: { route: ManifestRoute }, _options = {}): boolean {
  return !["well-known", "redirect", "not-found"].includes(route.kind);
}

/** Extend the existing route enumerator for each theme; the exporter still fetches the real app.
 * O(themes × routes), at most 8 themes. Only normal routes own sitemap/feed/robots/404 outputs. */
export async function buildPreviewExportManifest<Deps extends { readonly siteTitleReady?: Promise<void> | undefined }>({ routeDeps, ports }: {
  routeDeps: Deps; ports: PreviewExportManifestPorts<Deps>;
}, options: { includeThemePreviews?: boolean } = {}): Promise<{ manifest: RouteManifest; themeCount: number }> {
  await routeDeps.siteTitleReady;
  const manifest = await ports.buildManifest({ routeDeps });
  // A portable static copy represents the active theme, even when the live preview switcher is on.
  if (options.includeThemePreviews === false) return { manifest, themeCount: 1 };
  if (!manifest.activeTheme) return { manifest, themeCount: 1 };
  const activeThemeId = manifest.activeTheme.id;
  const config = await ports.readPreviewConfig({ routeDeps, activeThemeId });
  if (config === null || !config.enabled) return { manifest, themeCount: 1 };
  const normalPages = manifest.routes.filter(route => isHtmlPage({ route }));
  for (const { themeId } of config.themes) {
    if (themeId === activeThemeId) continue;
    const variant = await ports.buildManifest({ routeDeps, themeId });
    const pages = new Map([...normalPages, ...variant.routes.filter(route => isHtmlPage({ route }))].map(route => [route.path, route]));
    manifest.routes.push(...[...pages.values()].map(route => ({ ...route, path: ports.previewThemePath({ themeId, activeThemeId, path: route.path }) })));
  }
  return { manifest, themeCount: config.themes.length };
}
