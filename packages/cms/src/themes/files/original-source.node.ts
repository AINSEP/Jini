import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { resolveThemeLayout, THEME_CATALOG_DIR } from "../layout.js";
import { orFallbackSync } from "@jini-ai/core/errors/idioms";


/**
 * Design C (ADS-memory w4-theme-lifecycle-designs.md §5 / w6 dispatch, 2026-09-16): which folder
 * `resetThemeFileToOriginal`/`themeFileDiffersFromOriginal`/`hasThemeOriginalLayoutMismatch` should treat
 * as one theme's catalog original, and where that folder came from. `"site"` is today's ONLY source
 * (`<siteThemesRoot>/__original-themes__/<tier>/<id>`) and always wins when it exists at all —
 * `"package"` (`<packageThemesRoot>/__original-themes__/<tier>/<id>`) is a READ-ONLY fallback,
 * reached only when the site has no catalog folder for this theme whatsoever. See
 * {@link resolveThemeOriginalSource}.
 */
export type ThemeOriginalSource = {
  readonly source: "site" | "package";
  readonly originalDir: string;
  readonly originalsRoot: string;
};

/**
 * Resolve which catalog original a theme should reset against/compare against: the site's own copy
 * when it exists at all, or — only when the site has none — the package's own read-only copy.
 *
 * This is Design C's entire mechanism. Before this, every caller (`explore.ts`'s detail/copy/rename/
 * reset routes, `tool-registrations.ts`'s `theme_reset_file`) derived
 * `join(siteThemesRoot, THEME_CATALOG_DIR, tier, id)` directly and asked only whether THAT folder
 * exists. Seven of the eight shipped themes never had one on an already-seeded site (Design D fixed
 * this for NEW sites by generating `content/themes/__original-themes__/<tier>/<id>` for all eight at
 * build time; an already-seeded site's own copy, made once at `seedSiteThemes()` time, never gets
 * the backfill). This function adds exactly one more place to look — the package's own generated
 * catalog — without writing anything anywhere: both branches are `existsSync` on a directory, never a
 * copy, a rename, or a stamp. A site's own original is therefore never displaced, only supplemented
 * by a fallback that answers `null` today's `catalogDir`-then-`existsSync` shape already answered
 * `null` for.
 *
 * `packageThemesRoot` is deliberately `string | undefined`, not required: only the SQLite composition
 * root (`apps/website/src/server/runtime/composition/deps.ts`'s `createSiteRouteDeps`) and the CLI install-dir boot know the package's
 * own themes root at all (`builtInThemesDir()`) — the hermetic in-memory composition root
 * (`apps/website/src/server/runtime/composition/app.ts`'s `createRouteDeps`) and every hand-built `RouteDeps`/`ContentRouteDeps`/
 * `ThemeToolDeps` test fixture predate this field and have no reason to set it. `undefined` is
 * therefore "no package fallback configured," answered the same as "the package has no original for
 * this theme id" (`null`), never thrown.
 *
 * @param required.manifest - Supplies the theme's own `tier`/`id` — where each catalog stores its
 * per-theme folder, on either side.
 * @param required.siteThemesRoot - The site's own themes root (`RouteDeps.themesDir`), checked first.
 * @param required.packageThemesRoot - The package's own stock themes root
 * (`RouteDeps.packageThemesDir`, ultimately `builtInThemesDir()`), or `undefined`.
 * @returns `null` when neither side has a catalog folder for this theme id — identical to today's
 * "no original" state. Otherwise the folder to read from and which side answered: `"package"` is
 * returned only when `"site"` would have been `null`.
 * @throws Never. Two `existsSync` calls, no reads, no writes.
 * @complexity O(1).
 */
export function resolveThemeOriginalSource(
  required: {
    manifest: { id: string; tier: string };
    siteThemesRoot: string;
    packageThemesRoot: string | undefined;
  },
  _optional: Record<string, never> = {}
): ThemeOriginalSource | null {
  const { manifest, siteThemesRoot, packageThemesRoot } = required;

  const siteOriginalsRoot = join(siteThemesRoot, THEME_CATALOG_DIR);
  const siteOriginalDir = join(siteOriginalsRoot, manifest.tier, manifest.id);
  if (existsSync(siteOriginalDir)) {
    return { source: "site", originalDir: siteOriginalDir, originalsRoot: siteOriginalsRoot };
  }

  if (packageThemesRoot === undefined) return null;
  const packageOriginalsRoot = join(packageThemesRoot, THEME_CATALOG_DIR);
  const packageOriginalDir = join(packageOriginalsRoot, manifest.tier, manifest.id);
  if (existsSync(packageOriginalDir)) {
    return { source: "package", originalDir: packageOriginalDir, originalsRoot: packageOriginalsRoot };
  }

  return null;
}

/**
 * Whether this theme id ships with the package itself — the package's own generated originals
 * catalog has a folder for it. The Themes screen keeps such a theme out of its Delete menu item.
 *
 * Deliberately the PACKAGE catalog only, not {@link resolveThemeOriginalSource}'s site-first lookup:
 * a Duplicate writes the copy's own site original (`duplicate-theme.ts`), so "has an original" is
 * true for every copy and cannot tell a shipped theme from the owner's own.
 *
 * @returns `false` when `packageThemesRoot` is `undefined` (no package fallback configured — see
 *   {@link resolveThemeOriginalSource}'s doc) or the catalog has no folder for this tier/id.
 * @throws Never. One `existsSync`.
 * @complexity O(1).
 */
export function isPackageShippedTheme(
  required: { manifest: { id: string; tier: string }; packageThemesRoot: string | undefined },
  _optional: Record<string, never> = {}
): boolean {
  const { manifest, packageThemesRoot } = required;
  if (packageThemesRoot === undefined) return false;
  return existsSync(join(packageThemesRoot, THEME_CATALOG_DIR, manifest.tier, manifest.id));
}

/**
 * The layout version one theme folder's own `theme.json` declares: `2`, or `undefined` for v1, the
 * same normalization `loadTheme` applies (`theme.ts`, `parseRawManifestFields`). `null` when the
 * manifest is missing, is not a regular file, is past {@link maxManifestBytes}, cannot be read, or
 * is not a JSON object. Never throws.
 *
 * @complexity O(s) in the manifest size, bounded by {@link maxManifestBytes}.
 */
function manifestApiVersionOnDisk({ themeDir, maxManifestBytes }: { themeDir: string; maxManifestBytes: number }, _optional = {}): 2 | undefined | null {
  const manifestPath = join(themeDir, "theme.json");
  return orFallbackSync({
    work: (): 2 | undefined | null => {
      const stat = statSync(manifestPath);
      if (!stat.isFile() || stat.size > maxManifestBytes) return null;
      const raw: unknown = JSON.parse(readFileSync(manifestPath, "utf8"));
      if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
      return (raw as { apiVersion?: unknown }).apiVersion === 2 ? 2 : undefined;
    },
    fallback: null,
    step: "read theme layout manifest",
  });
}

/**
 * The one guard both per-file resets share (`explore.ts`'s reset route and `theme_reset_file`), and
 * what the Explore listing uses to decide `resettable`. Refuses when a theme's catalog original cannot
 * stand in for the live theme file by file: its `theme.json` resolves a different layout
 * (`@jini-ai/cms/themes/layout`) than the live one, or cannot be read, so its layout is unknown.
 *
 * The refusal covers every file, not only `theme.json`. Copying a v1 original's `theme.json` over a v2
 * theme writes a manifest with no `apiVersion`, and `loadTheme` then requires v1's `pages/index.html`
 * and marks the theme invalid; copying any other file mixes one layout's file into the other. Found on
 * `basic`, 2026-09-14, whose saved original is still the layout from before `497c9d35`.
 *
 * An unreadable LIVE `theme.json` does not refuse: that theme already loads invalid, and resetting the
 * file from its original is how it gets repaired.
 *
 * Both manifests are read from disk on every call rather than taken from `DiscoveredTheme.manifest`.
 * That snapshot is stale whenever another process wrote the theme, and has no `apiVersion` at all when
 * the live manifest failed to parse.
 *
 * @param required.themeDir - The live theme's own folder (`DiscoveredTheme.dir`).
 * @param required.originalDir - The theme's catalog folder (`<themesRoot>/__original-themes__/<tier>/<id>`).
 * @returns `true` when the original cannot repair the live layout; otherwise `false`.
 * @complexity O(s) in the two manifests' sizes, each bounded by {@link maxManifestBytes}.
 */
export function hasThemeOriginalLayoutMismatch(
  required: { themeDir: string; originalDir: string; maxManifestBytes: number },
  _optional: Record<string, never> = {}
): boolean {
  const original = manifestApiVersionOnDisk({ themeDir: required.originalDir, maxManifestBytes: required.maxManifestBytes });
  if (original !== null) {
    const live = manifestApiVersionOnDisk({ themeDir: required.themeDir, maxManifestBytes: required.maxManifestBytes });
    if (live === null || resolveThemeLayout({}, { apiVersion: live }) === resolveThemeLayout({}, { apiVersion: original })) return false;
  }
  return true;
}
