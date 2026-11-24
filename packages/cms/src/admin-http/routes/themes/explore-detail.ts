import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";

import { authorizeThemeExplore, findExploreTheme, themeIdParam, type ExploreTheme, type ThemeExplorePrincipal } from "./explore-shared.js";

/** The theme fields the detail response echoes, on top of {@link ExploreTheme}'s id. */
export interface ExploreThemeDetailSource extends ExploreTheme {
  readonly manifest: { readonly id: string; readonly name: unknown; readonly tier: unknown; readonly apiVersion?: unknown };
  readonly status: unknown;
  readonly errors: unknown;
  /** Page and partial ids the renderer knows (their contents are not read here). */
  readonly pages: Readonly<Record<string, unknown>>;
  readonly partials: Readonly<Record<string, unknown>>;
}

/** One file-list entry, as the host's file description builds it (see the host's `describeThemeFile`). */
export interface ThemeExploreFileEntry {
  path: string;
  group: string;
  readable: boolean;
  editable: boolean;
  resettable: boolean;
  modified: boolean | null;
  published: boolean | null;
  collidingContent: unknown;
  inherited?: boolean;
}

/** The detail response: what the Explore screen lists and what its banner says. */
export interface ThemeExploreDetail {
  id: string; name: unknown; tier: unknown; apiVersion: unknown; status: unknown; errors: unknown;
  pages: string[]; partials: string[]; files: ThemeExploreFileEntry[]; hasOriginal: boolean;
}

/** The deps this route reads. */
export interface ThemeDetailRouteDeps {
  findTheme(required: { themeId: string }): ExploreThemeDetailSource | undefined;
  /**
   * Every physical file in the theme folder, described — not just the pages/partials the renderer
   * knows about (CSS, JS, tokens, images are what an author most often needs to change), minus
   * generated output and trash — plus whether the theme has an untouched original to reset to. The
   * host resolves that original once and batches its content-collision lookup into ONE listing
   * query, never one per file.
   */
  describeThemeFiles(required: { theme: ExploreThemeDetailSource }): Promise<{ files: ThemeExploreFileEntry[]; hasOriginal: boolean }>;
}

/**
 * The entry for a virtual inherited template source. The loader owns inheritance; virtual sources
 * must be listed so View Template's Explore link can select them, but they cannot masquerade as
 * editable physical site files.
 * @complexity O(1).
 */
function inheritedFileEntry(path: string): ThemeExploreFileEntry {
  return { path, group: "page", readable: true, editable: false, resettable: false, modified: null, published: null, collidingContent: null, inherited: true };
}

/**
 * GET one theme's detail — what the Explore screen lists and what its banner says. `apiVersion` is
 * echoed (2026-08-19 architecture audit) so the admin's own rename-lock check resolves the SAME
 * apiVersion-aware layout the server used to group `files`. Unexpected failures (including file
 * errors) are the host's 500: this route never mapped them.
 */
export const themeDetailRoute = defineJsonRoute<{ themeId: string }, ThemeExploreDetail, ThemeDetailRouteDeps, ThemeExplorePrincipal>({
  method: "get",
  path: "/api/admin/v1/workspaces/:workspaceId/themes/:themeId",
  parse: (raw) => ok({ value: { themeId: themeIdParam(raw.params) } }),
  handle: async ({ input, deps, authorize }) => {
    await authorizeThemeExplore({ authorize });
    const theme = findExploreTheme({ deps, themeId: input.themeId });
    const { files, hasOriginal } = await deps.describeThemeFiles({ theme });
    const listed = [...files, ...Object.keys(theme.inheritedTemplateSources ?? {}).map(inheritedFileEntry)];
    const { manifest } = theme;
    return ok({ value: {
      id: manifest.id, name: manifest.name, tier: manifest.tier, apiVersion: manifest.apiVersion,
      status: theme.status, errors: theme.errors,
      pages: Object.keys(theme.pages).sort(), partials: Object.keys(theme.partials).sort(),
      files: listed, hasOriginal,
    } });
  },
});
