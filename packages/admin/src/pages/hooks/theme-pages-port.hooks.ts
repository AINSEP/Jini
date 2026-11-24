/**
 * @file What `use-theme-pages.hooks.ts` needs from the outside world, as an interface rather than a
 * direct `lib/api` import. Follows the `useX(dependencies)` / `useWiredX()` pair documented in
 * `development/docs/architecture/wired-hooks-convention.md`.
 *
 * 2026-08-30 (deep-link/publish-toggle pass): this port grew from one route (`getPresentation`) to
 * three. The Theme Pages tab used to show every `activeThemeStaticPageIds` entry with no publish
 * state and no way to tell a real page apart from `index`/`404`/a declared Post-or-Page template
 * shell — `getPresentation()` alone has neither fact (`presentation/get.ts`'s own
 * `activeThemeStaticPageIds` is a bare `Object.keys(activeTheme.pages)`, unfiltered). Both already
 * exist on the SAME route Theme Studio's Explore screen uses (`getThemeDetail`'s per-file
 * `published: boolean | null`, straight from the server's `isStandaloneThemePage`) — so this port
 * adds `getThemeDetail` and `setPagePublished` rather than a new server endpoint. `getPresentation`
 * stays, narrowed to just `settings.activeThemeId` now — `activeThemeStaticPageIds` itself is no
 * longer read anywhere in this feature, superseded by `getThemeDetail`'s richer `files` list, which
 * is the active theme's page ids PLUS the two facts this tab was previously missing.
 *
 * Deliberately NOT importing `ThemeExplorePort`'s identical-looking `getThemeDetail`/
 * `setPagePublished` shapes from `features/themes/hooks/theme-explore-port.hooks.ts` — same
 * "NOT shared with `themes-port.hooks.ts`" reasoning this file's own header already gave: each
 * feature's port independently declares the narrow slice of the wire contract it actually reads,
 * so two features touching the same two ROUTES is not a reason to couple them through one shared
 * type either. This screen only ever READS publish state and flips one boolean; a change to Theme
 * Explore's own port for ITS editing needs (rename, copy, delete, save) should never have to touch
 * this file at all.
 */

/** The live content record occupying a theme page's own slug — mirrors `theme-explore-
 *  port.hooks.ts`'s identical-shaped `ThemeExploreSlugCollision`, declared again here rather than
 *  imported: this port's own header already explains why the two features' ports stay independent
 *  even where the underlying wire shape agrees. See `ThemePagesFileEntry.collidingContent` and
 *  `ThemePageDetailsModal.tsx` (the one place this tab surfaces it) for the full contract. */
export interface ThemePageSlugCollision {
  id: string;
  slug: string;
  title: string;
  kind: "post" | "page";
}

/**
 * The one `getThemeDetail` file entry this tab reads anything from. Narrowed far below
 * `ThemeExploreFileEntry` (`theme-explore-port.hooks.ts`) — this tab never edits, renames, or
 * previews a file, so `readable`/`editable`/`group` values other than `"page"` never matter here;
 * `group` itself is kept (as a plain `string`, not the six-member union `theme-explore-port.hooks.ts`
 * declares) purely to filter to page rows, since the same route also lists partials/styles/scripts/
 * assets this tab has nothing to show for.
 */
export interface ThemePagesFileEntry {
  path: string;
  group: string;
  /** `null`/absent for a page id the publish question does not apply to (`index`/`404`/a declared
   *  template shell) — see `theme.ts`'s `isStandaloneThemePage` for the full contract. Optional here,
   *  matching `ThemeExploreFileEntry.published`'s own reasoning: an older cached response or a
   *  fixture that predates this field should still satisfy the port's shape. */
  published?: boolean | null;
  /** False for a page the theme author added after the site's own copy was made — no original on
   *  the catalog side to reset it from. */
  resettable: boolean;
  /** The live content record occupying this page's own slug — `null`/absent for every entry
   *  `published` is also `null`/absent for, plus a real candidate page with no such record. Surfaced
   *  in the row's details modal (2026-08-31 pass) so an operator opening one theme page's detail can
   *  see, without leaving this screen, that a Post or Page is already claiming its URL — the same
   *  fact Theme Studio's Explore screen warns about for the identical reason. Optional for the same
   *  "older cached response" reason `published` documents above. */
  collidingContent?: ThemePageSlugCollision | null;
}

export interface ThemePagesPort {
  /** Narrowed to the one field this hook still reads off `getPresentation()` — see this file's own
   *  header for why `activeThemeStaticPageIds` was dropped from here. */
  getPresentation(): Promise<{ settings: { activeThemeId: string } }>;
  /** One theme's files, narrowed to {@link ThemePagesFileEntry} — see that interface's own doc. */
  getThemeDetail(required: { themeId: string }): Promise<{ files: ThemePagesFileEntry[] }>;
  /** Publish or unpublish one of this theme's own pages — see `use-theme-pages.hooks.ts`'s
   *  `setPagePublished` for the caller-side contract and `ThemeManifest.publishedPages` (`theme.ts`)
   *  for the full server-side one. Same route Theme Studio's Explore screen writes through
   *  (`ThemeExplorePort.setPagePublished`), so a page toggled from either screen agrees on both. */
  setPagePublished(required: { themeId: string; page: string; published: boolean }): Promise<{ page: string; published: boolean }>;
}
