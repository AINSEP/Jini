import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";
import { rejectRoute } from "@jini-ai/core/errors/route-refusal";

import {
  authorizeThemeExplore, findExploreTheme, rejectMissingThemeFile, rejectThemeFileError, themePathInput,
  type ExploreTheme, type ExploreThemeLookupDeps, type ThemeExplorePrincipal, type ThemeFileErrorDeps,
} from "./explore-shared.js";

/** A refusal from the host's file identity lock: its own status, message and code. */
export interface ThemeFileIdentityLockRefusal { status: number; error: string; code: string }

/** The identity-lock check the rename and delete routes share with the assistant's file tools. */
export interface ThemeFileIdentityLockDeps {
  /** The host's shared "can this file's name or existence change" gate, given its resolved write scope. */
  checkFileIdentityChange(required: { theme: ExploreTheme; path: string; action: "renamed" | "deleted" }): ThemeFileIdentityLockRefusal | null;
  /** Every file path in the theme folder (relative, `/`-separated). */
  listThemeFiles(required: { theme: ExploreTheme }): readonly string[];
}

/** The deps this route reads. */
export interface ThemeFileDeleteRouteDeps extends ExploreThemeLookupDeps, ThemeFileErrorDeps, ThemeFileIdentityLockDeps {
  /** Moves one file into the theme's restorable `.trash/` and reloads the theme (the assistant's trash lifecycle). */
  trashThemeFile(required: { theme: ExploreTheme; path: string }): unknown;
}

/**
 * POST — move one file into the theme's restorable trash.
 *
 * Removing a file changes the live site, so the UI still confirms the exact target. There is no
 * theme-file revision history or restore control on this screen; bytes survive in `.trash/` and
 * the assistant can restore them. A server-side confirmation flag would only duplicate the UI's
 * responsibility.
 *
 * Shares the complete trash lifecycle with the assistant through the injected trash service,
 * including identity locks, destination safety and live reload. The HTTP identity-lock and
 * missing-file checks stay here to preserve their existing status/code contracts. A compiled
 * release without a safe trash destination is refused: UI deletion must never discard bytes.
 */
export const themeFileDeleteRoute = defineJsonRoute<{ themeId: string; path: string }, { path: string; deleted: true }, ThemeFileDeleteRouteDeps, ThemeExplorePrincipal>({
  method: "post",
  path: "/api/admin/v1/workspaces/:workspaceId/themes/:themeId/file/delete",
  parse: (raw) => ok({ value: themePathInput(raw) }),
  handle: async ({ input, deps, authorize }) => {
    await authorizeThemeExplore({ authorize });
    const theme = findExploreTheme({ deps, themeId: input.themeId });
    const { path } = input;
    try {
      const lockError = deps.checkFileIdentityChange({ theme, path, action: "deleted" });
      if (lockError) rejectRoute({ status: lockError.status, error: lockError.error, code: lockError.code });
      rejectMissingThemeFile({ existingPaths: new Set(deps.listThemeFiles({ theme })), path });
      deps.trashThemeFile({ theme, path });
    } catch (err) {
      return rejectThemeFileError({ err, deps });
    }
    return ok({ value: { path, deleted: true as const } });
  },
});
