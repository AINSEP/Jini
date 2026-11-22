/**
 * @file Contracts for the static-site exporter's route enumeration step (2026-08-15).
 *
 * Purpose:
 * `buildRouteManifest` owns "what URLs does this workspace's public site actually serve" —
 * separately from the HTTP-driving writer, so export and preview callers share enumeration
 * rather than maintaining hand-rolled route lists inside the exporter engine.
 *
 * `Jini/packages/cms/src/seo/sitemap.ts`'s `buildSitemap` is NOT this enumerator and must never be mistaken for it: it
 * enumerates only published, indexable posts, silently omitting home, products, theme-owned static
 * pages, redirects, and 404 — an SEO index and a deployable manifest answer different questions
 * (the host's deployment-constraints doc, §3).
 *
 * Architectural role:
 * Tier-2 library, mirroring `src/redirects`/`src/seo`'s own `ports.ts` + implementation-file split.
 * The concrete reader (`route-manifest.ts`) reuses the exact selection logic real routes use — never
 * re-derives it — so the manifest can never enumerate a route the live server would not actually
 * serve, or miss one it would. `resolveActiveTheme` is a direct import from feature-owned
 * the host's theme feature (see `route-manifest.ts`'s header for why this library now lives in
 * `features/`).
 * `resolveActiveThemeId`/`listPublishedPosts`/`resolveStorefrontProducts` are all reached via
 * `RouteDeps` injection (`deps.resolveActiveThemeId()` etc.) rather than a direct import — see
 * `route-manifest.ts`'s own file header for why (2026-09-03: the first two moved from direct import
 * to injection specifically to close a `platform <-> features/presentation`/`platform <->
 * features/post` module cycle; `resolveStorefrontProducts` was injected earlier, 2026-08-16, for an
 * unrelated `SiteProduct` type-boundary reason).
 */

/**
 * What kind of thing a route is, for reporting only — the exporter's writer does not branch on
 * this to decide HOW to fetch a route (every non-redirect, non-404 entry is fetched identically);
 * it exists so a human-facing export report can say "12 posts, 3 pages, 8 theme pages, 4 products"
 * instead of an undifferentiated route count.
 */
export type ManifestRouteKind =
  | "home"
  | "post"
  | "page"
  | "theme-page"
  | "product-list"
  | "product"
  | "redirect"
  | "not-found"
  | "well-known";

/**
 * One publicly reachable URL. `redirectTarget`/`redirectStatusCode` are populated ONLY for
 * `kind: "redirect"` — they are the rule's DECLARED destination, carried as a cross-check hint for
 * the writer's own report, never as the source of truth for exported bytes: the writer re-requests
 * the path with `redirect: "manual"` and writes whatever the live server actually answers with, the
 * same "boot the real app, trust its real response" rule every other route follows.
 */
export interface ManifestRoute {
  /** Site-relative request path, e.g. `"/"`, `"/about"`, `"/products/mug-01"`. Always a leading
   *  slash; `"/"` is the only entry with no further segments. For `kind: "not-found"` this is a
   *  collision-checked SENTINEL path chosen to trigger the live 404 branch, not a real content URL —
   *  the writer maps its response to `404.html` at the export root rather than to this literal path. */
  path: string;
  kind: ManifestRouteKind;
  /** Human-readable label for reporting only (slug/title/product name) — never used for lookup. */
  label: string;
  redirectTarget?: string;
  redirectStatusCode?: number;
}

/** Identifies the active theme a built manifest resolved against, so a caller (the exporter's
 *  unreferenced-file diff) can locate its on-disk folder without re-resolving "which theme is
 *  active" a third time (`route-manifest.ts` and `pages.ts`'s live route are the other two). Not
 *  the full `DiscoveredTheme` — only the fields a caller outside this port's own module needs. */
export interface ManifestActiveTheme {
  id: string;
  /** Absolute path of the theme's own folder on disk (`DiscoveredTheme.dir`). */
  dir: string;
  /** `DiscoveredTheme.manifest.apiVersion` — `2` nests a static theme's files under `render/`
   *  (`theme-authoring-guide-v2.md` §3), `undefined` keeps the v1 theme-root layout. Threaded
   *  through so a caller outside this port's own module (the exporter's unreferenced-file diff)
   *  never has to re-derive schema version from disk layout — same reasoning as `dir` itself. */
  apiVersion?: 2;
}

/** A publicly reachable URL the manifest could NOT enumerate, recorded so the export report names
 *  the gap instead of silently under-counting routes (the brief's "never a silently missing file"
 *  rule, applied one step upstream of the writer). Today's only known source: `prefix`/`wildcard`/
 *  `regex` redirect rules, which match a family of paths rather than one enumerable path. */
export interface ManifestSkip {
  reason: string;
  detail: string;
}

export interface RouteManifest {
  routes: ManifestRoute[];
  skipped: ManifestSkip[];
  /** Set only when a valid theme was resolved (absent in the `no-theme` `skipped` case). */
  activeTheme?: ManifestActiveTheme;
}
