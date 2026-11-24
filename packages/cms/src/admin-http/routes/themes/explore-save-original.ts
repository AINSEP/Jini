import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";
import { rejectRoute } from "@jini-ai/core/errors/route-refusal";

import {
  authorizeThemeExplore, findExploreTheme, rejectThemeFileError, themeIdParam,
  type ExploreTheme, type ExploreThemeLookupDeps, type ThemeExplorePrincipal, type ThemeFileErrorDeps,
} from "./explore-shared.js";

/** The host save's outcome: saved, or refused with its own message and code (`ORIGINAL_EXISTS`, …). */
export type ThemeSaveOriginalOutcome = { ok: true } | { ok: false; message: string; code: string };

/** The deps this route reads: the theme lookup and the host's save-as-original service. */
export interface ThemeSaveOriginalRouteDeps extends ExploreThemeLookupDeps, ThemeFileErrorDeps {
  /** Copies the theme's current files into the hidden originals catalog Reset reads (host-bound roots). */
  saveThemeAsOriginal(required: { theme: ExploreTheme }): ThemeSaveOriginalOutcome;
}

/**
 * POST — save the theme's CURRENT files as its stored original (Explore's "Save as original", owner
 * 2026-10-08), into the hidden catalog Reset reads. For a theme that has none, which is the only time
 * the screen offers it; one that already has an original is refused (`ORIGINAL_EXISTS`) rather than
 * replaced, since that original is what Reset should keep restoring to.
 */
export const themeSaveOriginalRoute = defineJsonRoute<{ themeId: string }, { themeId: string; saved: true }, ThemeSaveOriginalRouteDeps, ThemeExplorePrincipal>({
  method: "post",
  path: "/api/admin/v1/workspaces/:workspaceId/themes/:themeId/original",
  parse: (raw) => ok({ value: { themeId: themeIdParam(raw.params) } }),
  handle: async ({ input, deps, authorize }) => {
    await authorizeThemeExplore({ authorize });
    const theme = findExploreTheme({ deps, themeId: input.themeId });
    let saved: ThemeSaveOriginalOutcome;
    try {
      saved = deps.saveThemeAsOriginal({ theme });
    } catch (err) {
      return rejectThemeFileError({ err, deps });
    }
    if (!saved.ok) rejectRoute({ status: 409, error: saved.message, code: saved.code });
    return ok({ value: { themeId: theme.manifest.id, saved: true as const } });
  },
});
