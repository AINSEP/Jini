import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";

import type { PresentationSettingsRepoPort } from "../../../presentation/index.js";
import { authorizeThemes, type ThemeRoutePrincipal } from "./shared.js";

/** The fields of one discovered theme the list reads. */
export interface ThemeListSource {
  manifest: { id: string; name: string; version: string };
  source: string;
  status: string;
  errors: readonly string[];
}

/** Wire shape for one `THEMES_LIST` entry (SPEC-004 api.spec.md §5). */
export interface ThemeListItem {
  id: string;
  name: string;
  version: string;
  source: string;
  status: string;
  errors: Array<{ code: string | null; file: string | null; message: string }>;
  active: boolean;
}

/** The deps this route reads: the stored active id, and the host's discovered themes plus the
 *  host's stored-id lookup (retired ids resolve to the theme they were renamed to). */
export interface ThemesListRouteDeps {
  workspaceId: string;
  presentationRepo: Pick<PresentationSettingsRepoPort, "findByWorkspaceId">;
  themes: () => readonly ThemeListSource[];
  findStoredTheme: (required: { id: string }) => { manifest: { id: string } } | undefined;
}

/**
 * TB-01 order: built-in themes first (id asc), then site themes (id asc). Discovery already sorts
 * within one call by id, but the theme list may one day concatenate multiple sources (built-in +
 * site, per the theme's own `source` field) — sorting explicitly here doesn't rely on caller-side
 * concatenation order. Sorts a copy: the host's live list keeps its own order.
 * @complexity O(n log n).
 */
function sortThemesForList(themes: readonly ThemeListSource[]): ThemeListSource[] {
  const sourceRank = (source: string): number => (source === "built-in" ? 0 : 1);
  return [...themes].sort((a, b) => {
    const rankDiff = sourceRank(a.source) - sourceRank(b.source);
    return rankDiff !== 0 ? rankDiff : a.manifest.id.localeCompare(b.manifest.id);
  });
}

/**
 * GET discovered themes with source/status/errors/active (SPEC-004 api.spec.md `THEMES_LIST`) — a
 * read surface over the same discovered theme list the presentation routes read, not new storage.
 *
 * Gated by `theme.set` — there is no dedicated `theme.read` permission in the catalog (mirrors the
 * presentation GET's identical disclosed reuse of a write-shaped permission for a read route).
 *
 * Disclosed shape gap: `errors.spec.md` §3 documents each `THEMES_LIST` error record as
 * `{ code, file, message }`, but the theme loader only collects plain message strings — it has no
 * `code`/`file` vocabulary to draw from. Building that is a validator rewrite, not something this
 * route can safely invent, so each message is surfaced as `{ code: null, file: null, message }`
 * rather than fabricating a code the validator never determined.
 */
export const themesListRoute = defineJsonRoute<Record<string, never>, { themes: ThemeListItem[] }, ThemesListRouteDeps, ThemeRoutePrincipal>({
  method: "get",
  path: "/api/admin/v1/workspaces/:workspaceId/themes",
  parse: () => ok({ value: {} }),
  handle: async ({ deps, authorize }) => {
    await authorizeThemes({ authorize, permission: "theme.set", entityType: "presentation" });
    // No settings-not-found 404 here (unlike PRESENTATION_GET) — api.spec.md §6's THEMES_LIST
    // status map lists only "unknown workspace" as a 404 cause. A missing/absent presentation
    // row just means no theme in the list matches `active: true`, not a listing failure.
    const settings = await deps.presentationRepo.findByWorkspaceId({ workspaceId: deps.workspaceId });
    // The theme the stored id resolves to, retired ids included.
    const activeId = settings ? deps.findStoredTheme({ id: settings.activeThemeId })?.manifest.id : undefined;
    const themes = sortThemesForList(deps.themes()).map((theme) => ({
      id: theme.manifest.id,
      name: theme.manifest.name,
      version: theme.manifest.version,
      source: theme.source,
      status: theme.status,
      errors: theme.errors.map((message) => ({ code: null, file: null, message })),
      active: theme.manifest.id === activeId,
    }));
    return ok({ value: { themes } });
  },
});
