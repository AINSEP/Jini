/**
 * @file What `use-theme-explore.hooks.ts` needs from the outside world, as an interface rather
 * than a direct `lib/api` import.
 *
 * Follows the `useX(dependencies)` / `useWiredX()` pair documented in
 * `development/docs/architecture/wired-hooks-convention.md` and `Jini redirects/SOURCE-RATIONALE.md` (the
 * canonical reference): this file declares, `theme-explore-dependencies.hooks.ts` binds the real
 * `api` client, and nothing else under `features/themes` imports `lib/api` for these six routes.
 * NOT shared with `themes-port.hooks.ts` — that hook manages the theme REGISTRY (available themes,
 * active theme); this one edits a single theme's FILES, a different resource.
 *
 * Return shapes are narrowed to what `use-theme-explore.hooks.ts` actually reads, matching
 * `assistant-chats-port.hooks.ts`'s own minimalism (see that file's doc comment): `getThemeDetail`
 * drops the real route's `pages`/`partials` fields (never read here — the hook derives its own
 * page/partial grouping from `files`), and `copyThemeFile`/`renameThemeFile` drop
 * `group`/`readable`/`editable`/`resettable`/`modified`/`copiedFrom`/`renamedFrom` (the hook only reads the
 * returned `path`, then refetches the whole detail via `getThemeDetail` for everything else — see
 * `performRename`'s/`copyFile`'s own comments on why a full refetch, not a targeted patch).
 *
 * `ApiError` stays a direct import in the hook — pure error-classification, no I/O, same reasoning
 * as `Jini redirects/SOURCE-RATIONALE.md`'s own exclusion of `describeApiError`.
 */

/** Mirrors the server's file-group taxonomy (`lib/api.ts`'s inline `getThemeDetail` shape).
 *  Declared here (the wire-contract side) rather than in `use-theme-explore.hooks.ts`, which
 *  imports it from this file — the reverse would make the port file import from the hook it's
 *  meant to be injected into. */
import type { ThemeFileGroup } from "./cms-admin-theme-types.js";

/** The live content record occupying a theme page's own slug — mirrors the server's
 *  `ThemeFileContentCollision` (`explore.ts`'s `describeThemeFile`). See
 *  `use-theme-explore.hooks.ts`'s `ThemeExploreFile.collidingContent` for the full contract. */
export interface ThemeExploreSlugCollision {
  id: string;
  slug: string;
  title: string;
  kind: "post" | "page";
}

/** Mirrors `lib/api.ts`'s inline `getThemeDetail` file-entry shape, narrowed to the fields this
 *  hook's own `mapDetailFiles` reads. */
export interface ThemeExploreFileEntry {
  path: string;
  group: ThemeFileGroup;
  readable: boolean;
  editable: boolean;
  /** The source comes from the bundled theme, rather than a writable site file. */
  inherited?: boolean;
  resettable: boolean;
  /** Whether the file's bytes differ from its catalog original; `null` exactly when `resettable` is
   *  false. See `use-theme-explore.hooks.ts`'s `ThemeExploreFile.modified` for the full contract.
   *  Optional here for the same "older cached response" reason `published` below documents. */
  modified?: boolean | null;
  /** `null`/absent for every file the publish question does not apply to — see
   *  `use-theme-explore.hooks.ts`'s `ThemeExploreFile.published` for the full contract. Optional here
   *  (not on the client-normalized `ThemeExploreFile`) so a fixture or an older cached response that
   *  predates this field still satisfies the port's own shape. */
  published?: boolean | null;
  /** `null`/absent for every file this question does not apply to (same gate as `published` — see
   *  its own doc) or when no live content record shares this page's slug. See
   *  `use-theme-explore.hooks.ts`'s `ThemeExploreFile.collidingContent` for the full contract.
   *  Optional here for the same "older cached response" reason `published` already documents. */
  collidingContent?: ThemeExploreSlugCollision | null;
}

export interface ThemeExplorePort {
  getThemeDetail(required: { themeId: string }, optional?: Record<string, never>): Promise<{
    id: string;
    name: string;
    tier: string;
    /** Manifest schema version (`2`, or `undefined` for v1) — 2026-08-19 architecture audit
     *  findings 1 & 2: `use-theme-explore.hooks.ts`'s own rename-lock pre-check needs this to
     *  resolve the same apiVersion-aware layout the server route used to classify `files` below,
     *  via the shared `@jini-ai/cms/themes/layout` resolver. */
    apiVersion?: 2;
    status: string;
    errors: string[];
    hasOriginal: boolean;
    files: ThemeExploreFileEntry[];
  }>;
  getThemeFile(required: { themeId: string; path: string }, optional?: Record<string, never>): Promise<{ content: string }>;
  putThemeFile(required: { themeId: string; path: string; content: string }, optional?: Record<string, never>): Promise<{ path: string; bytes: number }>;
  resetThemeFile(required: { themeId: string; path: string }, optional?: Record<string, never>): Promise<{ content: string | null }>;
  /** Save the theme's current files as its stored original (refused when it already has one). */
  saveThemeOriginal(required: { themeId: string }, optional?: Record<string, never>): Promise<{ saved: true }>;
  renameThemeFile(required: { themeId: string; path: string; name: string }, optional?: Record<string, never>): Promise<{ path: string }>;
  copyThemeFile(required: { themeId: string; path: string }, optional?: Record<string, never>): Promise<{ path: string }>;
  /** Delete one file inside a theme, permanently — see `use-theme-explore.hooks.ts`'s `confirmDelete`
   *  for the confirmation gate this sits behind. */
  deleteThemeFile(required: { themeId: string; path: string }, optional?: Record<string, never>): Promise<{ path: string }>;
  /** Publish or unpublish one of this theme's own pages — see `use-theme-explore.hooks.ts`'s
   *  `setPagePublished` for the client-side gate (refused when the selected file has no publish
   *  state at all) and `ThemeManifest.publishedPages` (`theme.ts`) for the full contract. */
  setPagePublished(required: { themeId: string; page: string; published: boolean }, optional?: Record<string, never>): Promise<{ page: string; published: boolean }>;
}
