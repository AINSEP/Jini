import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { resolveThemeLayout, THEME_CATALOG_DIR } from "../layout.js";
import { orFallbackSync } from "@jini-ai/core/errors/idioms";


/** A site catalog wins when present; the package catalog is a read-only fallback. */
export type ThemeOriginalSource = {
  readonly source: "site" | "package";
  readonly originalDir: string;
  readonly originalsRoot: string;
};

/** Resolve the site catalog first, falling back to the package catalog without writing either.
 * An existing site original must never be displaced by the package copy; an unconfigured package
 * root has the same result as a missing package original. */
export function resolveThemeOriginalSource(
  required: {
    manifest: { tier: string; id: string };
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

/** Check the package catalog only: site copies may have their own originals. */
export function isPackageShippedTheme(
  required: { manifest: { tier: string; id: string }; packageThemesRoot: string | undefined },
  _optional: Record<string, never> = {}
): boolean {
  const { manifest, packageThemesRoot } = required;
  if (packageThemesRoot === undefined) return false;
  return existsSync(join(packageThemesRoot, THEME_CATALOG_DIR, manifest.tier, manifest.id));
}

/**
 * The layout version one theme folder's own `theme.json` declares: `2`, or `undefined` for v1, the
 * same normalization `loadTheme` applies (`theme.ts`, `parseRawManifestFields`). `null` when the
 * manifest is missing, is not a regular file, is past the supplied byte limit, cannot be read, or
 * is not a JSON object. Never throws.
 *
 * @complexity O(s) in the manifest size, bounded by the supplied byte limit.
 */
function manifestApiVersionOnDisk({ themeDir, maxManifestBytes }: { themeDir: string; maxManifestBytes: number }, _optional = {}): 2 | undefined | null {
  const manifestPath = join(themeDir, "theme.json");
  return orFallbackSync({ work: () => {
    const stat = statSync(manifestPath);
    if (!stat.isFile() || stat.size > maxManifestBytes) return null;
    const raw: unknown = JSON.parse(readFileSync(manifestPath, "utf8"));
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
    return (raw as { apiVersion?: unknown }).apiVersion === 2 ? 2 : undefined;
  }, fallback: null, step: "read theme layout manifest" });
}

/**
 * Refuse a reset when the original cannot be read or its layout differs from the live layout.
 * A mismatched original can replace the live manifest with one requiring different paths, or mix
 * files from incompatible layouts. An unreadable live manifest allows repair from the original.
 * Read both from disk because a cached snapshot can be stale or omit the version after a parse failure.
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
