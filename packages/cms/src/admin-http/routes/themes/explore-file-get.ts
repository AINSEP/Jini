import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";

import {
  authorizeThemeExplore, findExploreTheme, rejectThemeFileError, themeIdParam,
  type ExploreTheme, type ExploreThemeLookupDeps, type ThemeExplorePrincipal, type ThemeFileErrorDeps,
} from "./explore-shared.js";

/** One file's source: a physical file, or a read-only source the theme inherits from its bundle. */
export type ThemeFileGetResponse = { path: string; content: string } | { path: string; content: string; inherited: true; editable: false };

/** The deps this route reads. */
export interface ThemeFileGetRouteDeps extends ExploreThemeLookupDeps, ThemeFileErrorDeps {
  /** Reads one file's UTF-8 text through the host's containment helper (refuses escapes and oversized files). */
  readThemeFile(required: { theme: ExploreTheme; path: string }): string;
}

/**
 * GET the raw source of one file inside a theme (`?path=`). A virtual inherited template source is
 * answered from the loader's own map and flagged read-only, so View Template's Explore link can open
 * it without it masquerading as an editable physical file.
 */
export const themeFileGetRoute = defineJsonRoute<{ themeId: string; path: string }, ThemeFileGetResponse, ThemeFileGetRouteDeps, ThemeExplorePrincipal>({
  method: "get",
  path: "/api/admin/v1/workspaces/:workspaceId/themes/:themeId/file",
  parse: (raw) => ok({ value: { themeId: themeIdParam(raw.params), path: String((raw.query as Record<string, unknown>).path ?? "") } }),
  handle: async ({ input, deps, authorize }) => {
    await authorizeThemeExplore({ authorize });
    const theme = findExploreTheme({ deps, themeId: input.themeId });
    const { path } = input;
    const inherited = theme.inheritedTemplateSources ?? {};
    if (Object.hasOwn(inherited, path)) return ok({ value: { path, content: inherited[path] as string, inherited: true as const, editable: false as const } });
    try {
      return ok({ value: { path, content: deps.readThemeFile({ theme, path }) } });
    } catch (err) {
      return rejectThemeFileError({ err, deps });
    }
  },
});
