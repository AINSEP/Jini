import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";

import { authorizeThemeSet, type PresentationRoutePrincipal } from "./shared.js";

/** The rescan's report: which theme ids discovery added and removed, and how many it now holds. */
export interface ThemeRescanChange { added: string[]; removed: string[]; total: number }

/** The rescan's wire body. */
export interface ThemeRescanEnvelope extends ThemeRescanChange { availableThemeIds: string[]; duplicateIds: string[] }

/**
 * The deps this route reads. All three are the host's theme discovery, bound to the themes
 * directory the host originally discovered from (so an overridden root rescans that same folder).
 */
export interface ThemeRescanRouteDeps {
  workspaceId: string;
  /** Re-runs discovery against the themes directory and refreshes the host's live theme list. */
  rescanThemes: () => ThemeRescanChange;
  catalogThemeIds: () => string[];
  duplicateThemeIds: () => string[];
}

/**
 * POST — re-run theme discovery against the themes directory.
 *
 * Exists because discovery is otherwise a boot-time snapshot, so a theme that arrives on disk after
 * startup is invisible until the process restarts. Two different things put one there: an in-app
 * action (copy an original), which should rescan on its own without anyone asking, and an
 * out-of-band change (git pull, a CLI, a folder dropped in by hand), which nothing can hook — that
 * second case is what this route is for, and why the admin needs a visible control rather than
 * only an implicit refresh.
 *
 * Gated on `theme.set`, matching the GET and PATCH on this same resource: rescanning cannot change
 * what any theme contains, but it changes which themes an operator can activate, so it belongs with
 * the permission that governs the theme surface rather than being left ungated.
 *
 * Reports `added`/`removed` rather than a bare 204 — a rescan that found nothing looks exactly like a
 * rescan that never ran, and "I pressed it and nothing happened" is the whole failure this route is
 * meant to end.
 */
export const themeRescanRoute = defineJsonRoute<Record<string, never>, ThemeRescanEnvelope, ThemeRescanRouteDeps, PresentationRoutePrincipal>({
  method: "post",
  path: "/api/admin/v1/workspaces/:workspaceId/themes/rescan",
  parse: () => ok({ value: {} }),
  handle: async ({ deps, authorize }) => {
    await authorizeThemeSet({ authorize });
    const changed = deps.rescanThemes();
    return ok({ value: {
      added: changed.added,
      removed: changed.removed,
      total: changed.total,
      availableThemeIds: deps.catalogThemeIds(),
      // Two themes can claim the same id (ids are unique per folder, not globally), in which case
      // the site silently renders whichever sorts first. Reported here rather than swallowed,
      // because a rescan is exactly when a colliding theme most likely just arrived.
      duplicateIds: deps.duplicateThemeIds(),
    } });
  },
});
