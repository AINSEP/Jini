import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";
import { rejectRoute } from "@jini-ai/core/errors/route-refusal";

import {
  authorizeThemeExplore, bodyRecord, bodyStringField, findExploreTheme, rejectThemeFileError, themeIdParam,
  type ExploreThemeLookupDeps, type ThemeExplorePrincipal, type ThemeFileErrorDeps,
} from "./explore-shared.js";

/** What the host's page-publication service answers: the page, its new state and the full list. */
export interface ThemePagePublishResult { page: string; published: boolean; publishedPages: string[] }

/** The deps this route reads: the theme lookup, the host publication service and its error class. */
export interface ThemePagePublishRouteDeps extends ExploreThemeLookupDeps, ThemeFileErrorDeps {
  /** The host's shared page-publication service (also behind the assistant's publish tool). */
  setThemePagePublished(required: { themeId: string; page: string; published: boolean }): ThemePagePublishResult;
  /** The service's own refusal class; it carries its status and code, answered as-is. */
  isThemePagePublicationError(required: { err: unknown }): boolean;
}

/** The parsed body: `published` stays unknown until the theme exists, as the host validated it. */
export interface ThemePagePublishInput { themeId: string; page: string; published: unknown }

/**
 * POST — publish or unpublish one of a static theme's own pages.
 *
 * The real mechanism replacing the `_unpublished/` folder convention an agent invented ad hoc
 * (2026-08-29) — moving a live page's file out of `render/pages/` and dropping it from `theme.json`,
 * outside every audited read/write path, because no publish concept existed yet. The host service
 * rewrites `theme.json`'s RAW parsed JSON (never the in-memory manifest, which a separate agent
 * process can make stale) so only `publishedPages` changes, and it keeps its read-modify-write span
 * free of `await`, which is the only reason two concurrent toggles cannot lose a page.
 *
 * The `published` shape check happens after the theme lookup, matching the hand-written order
 * (workspace → auth → theme 404 → 400).
 */
export const themePagePublishRoute = defineJsonRoute<ThemePagePublishInput, ThemePagePublishResult, ThemePagePublishRouteDeps, ThemeExplorePrincipal>({
  method: "post",
  path: "/api/admin/v1/workspaces/:workspaceId/themes/:themeId/page/publish",
  parse: (raw) => ok({ value: {
    themeId: themeIdParam(raw.params),
    page: bodyStringField({ body: raw.body, field: "page" }),
    published: bodyRecord({ body: raw.body }).published,
  } }),
  handle: async ({ input, deps, authorize }) => {
    await authorizeThemeExplore({ authorize });
    const theme = findExploreTheme({ deps, themeId: input.themeId });
    if (typeof input.published !== "boolean") rejectRoute({ status: 400, error: "published must be a boolean", code: "INVALID_BODY" });
    try {
      return ok({ value: deps.setThemePagePublished({ themeId: theme.manifest.id, page: input.page, published: input.published }) });
    } catch (err) {
      if (deps.isThemePagePublicationError({ err })) {
        const refusal = err as { status: number; code: string; message: string };
        rejectRoute({ status: refusal.status, error: refusal.message, code: refusal.code });
      }
      return rejectThemeFileError({ err, deps });
    }
  },
});
