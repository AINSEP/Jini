/**
 * @file The v1/v2 disk contract for static theme pages, partials, scripts, stylesheets and required
 * files. All paths are theme-relative: v1 uses `pages/`, root `*.html` partials, `js/` and
 * `css/styles.css`; v2 uses `render/pages/`, `render/partials/`, `scripts/` and `css/theme.css`.
 *
 * Rendering, file classification, template URLs, missing-template diagnostics and portability
 * must share these facts. Independent copies drift when a disk layout changes, leaving a loader
 * and its other consumers disagreeing about the same theme.
 *
 * Only string operations belong here. The host joins these paths against its filesystem root;
 * keeping this leaf free of Node imports lets browser and server consumers use the same rules.
 */

/** Install-local recovery root; never part of a theme's live pages or generated artifacts. */
export const TRASH_DIR_NAME = ".trash";

/** One schema version's resolved layout. Every path here is theme-RELATIVE (no leading `/`, no
 *  `themeDir` prefix) — callers that need a real filesystem path still `join()` it themselves. */
export interface ThemeLayout {
  /** Folder holding this theme's page HTML files (`pagesDir/index.html`, `pagesDir/about.html`, …). */
  readonly pagesDir: string;
  /**
   * Folder holding this theme's partial HTML files (nav, footer, …) — `""` for v1, whose partials sit
   * AT the theme's own root rather than in a subfolder (the host loader's own `partialsDir`
   * choice). Every other layout field is a real folder name; this one is the one case a
   * caller must branch on before treating it as a normal path segment — see {@link isPartialFilePath}.
   */
  readonly partialsDir: string;
  /** Folder holding this theme's client-side scripts (`js` in v1, `scripts` in v2 — the folder itself
   *  renamed, not just its contents). */
  readonly scriptsDir: string;
  /** Folder holding CSS — identical name in both schema versions; only the stylesheet's own filename
   *  differs (see {@link stylesheetFilename}). */
  readonly cssDir: string;
  /** This theme's one required stylesheet's bare filename (`styles.css` v1, `theme.css` v2). */
  readonly stylesheetFilename: string;
  /** `${cssDir}/${stylesheetFilename}`, theme-relative — what a page's own `<link>` resolves to from
   *  the theme's root (a render-relative `../` prefix, if needed, is the caller's own concern — see
   *  the host's stylesheet sentinel, which adds it). */
  readonly stylesheetPath: string;
  /** `${pagesDir}/index.html` — the one page every static theme must ship (`loadStaticTierAssets`'s
   *  own `pages.index` requirement). */
  readonly indexPagePath: string;
  /** Every file `loadTheme` cannot start without — its absence flips a theme's `status` to `"invalid"`
   *  (the host loader's index-page check and manifest/token reads).
   *  Renaming any of these away reproduces that same breakage — the set the Explore rename route
   *  hard-blocks (derived from here instead of hand-copied).
   */
  readonly requiredFiles: readonly string[];
}

const V1_LAYOUT: ThemeLayout = {
  pagesDir: "pages",
  partialsDir: "",
  scriptsDir: "js",
  cssDir: "css",
  stylesheetFilename: "styles.css",
  stylesheetPath: "css/styles.css",
  indexPagePath: "pages/index.html",
  requiredFiles: ["pages/index.html", "theme.json", "tokens.json"],
};

const V2_LAYOUT: ThemeLayout = {
  pagesDir: "render/pages",
  partialsDir: "render/partials",
  scriptsDir: "scripts",
  cssDir: "css",
  stylesheetFilename: "theme.css",
  stylesheetPath: "css/theme.css",
  indexPagePath: "render/pages/index.html",
  requiredFiles: ["render/pages/index.html", "theme.json", "tokens.json"],
};

/**
 * Resolve a theme's layout from its manifest's `apiVersion`. `2` gets the v2 nested layout;
 * anything else (`undefined`, or any value other than `2` — every real theme on disk before the
 * v2 migration) gets v1's flat layout, matching `ThemeManifest.apiVersion`'s own documented
 * default in the host loader.
 *
 * @complexity O(1) — returns one of two frozen constants, no allocation.
 */
export function resolveThemeLayout(_required: Record<string, never> = {}, { apiVersion }: { apiVersion?: 2 | undefined } = {}): ThemeLayout {
  return apiVersion === 2 ? V2_LAYOUT : V1_LAYOUT;
}

/**
 * Whether a theme-relative path is one of this layout's own page files — a prefix check only (no
 * extension requirement), matching the exact rule the host's original classifier used for
 * v1 (`relativePath.startsWith("pages/")`) so this is behavior-preserving for every already-shipped
 * v1 theme, not just a v2 addition.
 *
 * @complexity O(k) in `relativePath`'s length (one `startsWith` check).
 */
export function isPageFilePath({ relativePath }: { relativePath: string }, { apiVersion }: { apiVersion?: 2 | undefined } = {}): boolean {
  return relativePath.startsWith(`${resolveThemeLayout({}, { apiVersion }).pagesDir}/`);
}

/**
 * Whether a theme-relative path is one of this layout's own partial files. v1's `partialsDir` is `""`
 * (the theme's own root — see {@link ThemeLayout.partialsDir}'s own doc), so a v1 partial is "a `.html`
 * file with no `/` in its path at all" (the host's original rule, preserved verbatim); a v2
 * partial is a `.html` file under `render/partials/`.
 *
 * @complexity O(k) in `relativePath`'s length.
 */
export function isPartialFilePath({ relativePath }: { relativePath: string }, { apiVersion }: { apiVersion?: 2 | undefined } = {}): boolean {
  if (!relativePath.endsWith(".html")) return false;
  const { partialsDir } = resolveThemeLayout({}, { apiVersion });
  return partialsDir === "" ? !relativePath.includes("/") : relativePath.startsWith(`${partialsDir}/`);
}

/**
 * Named engine-specific subfolders under a themes root, one per {@link ThemeTier} except `code`
 * (not built yet) — every tier's themes live under its own subfolder so `themes/` doesn't mix
 * formats in one flat listing (2026-08-10: `declarative` moved off the bare top level, and the
 * LiquidJS-tier folder renamed from `liquidjs/` to `templated/` to match its `ThemeTier` value —
 * `templated` names the tier, not the engine, so more templating engines can land under this same
 * folder later without another rename). Scanning a missing subfolder is a no-op (`discoverThemes`'s
 * own missing-dir ⇒ empty-list behavior), so adding an engine here ahead of its first theme costs
 * nothing.
 *
 * Exported because it is also the containment boundary the `themes` agent-tool domain enforces
 * (the host's tool registrations): a theme folder that is not a direct child of the
 * themes root or of one of THESE subfolders is not a recognized theme root, and no agent-driven file
 * write may resolve into it.
 */
// Keeping these constants in the layout leaf avoids a loader/discovery dependency cycle.
// That cycle was safe only while the host consumed the values inside its loader, never at module
// evaluation; sharing this leaf removes that evaluation-order dependency.
export const ENGINE_SUBFOLDERS = ["declarative", "templated", "handlebars", "static"] as const;

/**
 * The pristine-originals catalog under a themes root: shipped themes kept untouched so a copy can
 * always be compared against, reset to, or re-forked from what it started as.
 *
 * It is NOT a tier and NOT a theme — it holds its own `<tier>/<theme>/` tree — so discovery skips it
 * outright. A catalog theme is never runnable, never listed, and never the active theme; it becomes
 * either of those only by being COPIED into a real tier folder, which is the whole point: editing
 * your copy can never damage the thing you'd want to compare it against.
 *
 * The `__` prefix is load-bearing rather than decorative. It makes "this is not an installed theme"
 * a property of the name that any code path can check, instead of a list every new write path has to
 * remember to consult — see the containment note on {@link ENGINE_SUBFOLDERS}, which already refuses
 * agent-driven writes to anything that isn't a direct child of the root or of an engine subfolder.
 */
export const THEME_CATALOG_DIR = "__original-themes__";
