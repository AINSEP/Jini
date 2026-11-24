import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";
import { orFallback } from "@jini-ai/core/errors/idioms";
import { rejectRoute } from "@jini-ai/core/errors/route-refusal";

import { markersOfType } from "../../../widgets/markers/index.js";
import { authorizePageRead, type AdminPageRecord, type PageRoutePrincipal } from "./shared.js";

/** One row of the host's plugin-export catalog, as far as an embed summary reads it. */
export interface PageEmbedCatalogRow {
  readonly plugin: string;
  readonly component: string;
  readonly displayName?: string;
  readonly availability: string;
}

/** The host's plugin-export runtime, as far as this route reads it: one catalog load per request. */
export interface PagePluginCatalogPort {
  catalog(required: { workspaceId: string }): Promise<ReadonlyMap<string, readonly PageEmbedCatalogRow[]>>;
}

/** One authored plugin embed as the page editor shows it: identity, optional label, readiness. */
export interface PageEmbedSummary { plugin: string; component: string; displayName?: string; availability: string }

/** The deps this route reads. */
export interface PageGetRouteDeps {
  workspaceId: string;
  /** The host's id-or-slug post lookup (throws its own not-found error for an unknown key). */
  readPage: (required: { workspaceId: string; idOrSlug: string }) => Promise<{ post: AdminPageRecord }>;
  /** The host's admin post DTO. Method syntax: the host binds it with its own, richer row type. */
  toAdminPageResponse(required: { post: AdminPageRecord }): object;
  isPostNotFound: (required: { err: unknown }) => boolean;
  /** Read per request: the host may wire (or replace) its plugin-export runtime after mounting. */
  pluginExports: () => PagePluginCatalogPort | undefined;
}

/** Only describe exports already authored on this page; catalog discovery still belongs to
 * plugins_list. A failed catalog is unavailable, never a broken page editor or a ready button.
 * @complexity O(markers + exports), one catalog load; no templates or secret values returned.
 */
async function pagePluginEmbeds(required: { html: string; workspaceId: string; runtime: PagePluginCatalogPort | undefined }, _options = {}): Promise<PageEmbedSummary[]> {
  if (!required.runtime) return [];
  const markers = markersOfType({ html: required.html, type: "plugin" });
  if (!markers.length) return [];
  // Started outside `orFallback` as the hand-written route did: only a rejected load degrades;
  // a runtime that throws synchronously is a wiring bug and reaches the host's 500.
  const catalogPromise = required.runtime.catalog({ workspaceId: required.workspaceId });
  const catalog = await orFallback({ work: () => catalogPromise, fallback: new Map<string, readonly PageEmbedCatalogRow[]>() as ReadonlyMap<string, readonly PageEmbedCatalogRow[]>, step: "Read page plugin catalog" });
  const rows = new Map<string, PageEmbedCatalogRow>([...catalog.values()].flat().map(row => [JSON.stringify([row.plugin, row.component]), row]));
  return markers.map(({ config }) => {
    const plugin = typeof config.plugin === "string" ? config.plugin : "";
    const component = typeof config.component === "string" ? config.component : "";
    const row = rows.get(JSON.stringify([plugin, component]));
    return { plugin, component, ...(row?.displayName ? { displayName: row.displayName } : {}), availability: row?.availability ?? "PLUGIN_UNAVAILABLE" };
  });
}

/**
 * GET one page (SPEC-002 api.spec.md `PAGE_GET`) — the host's id-or-slug post lookup (same `post`
 * table and repo the posts by-id route uses, but id-or-slug rather than id-only: the Pages editor URL
 * is slug-based, and this keeps an old id-based bookmark resolving too), plus a `kind === "page"`
 * guard: api.spec.md §6 documents `PAGE_GET`'s 404 as "unknown workspace / `ENTRY_NOT_FOUND` (incl.
 * kind mismatch)" — a `kind: "post"` row fetched through `/pages/:pageId` must 404 exactly like an
 * unknown id/slug, not leak the post's existence through this route family ("kind-mismatch 404s are
 * deliberately indistinguishable from not-found", api.spec.md §7).
 *
 * Gated by `content.read` (mirrors the pages list's identical 2026-07-16 authz sweep fix).
 *
 * `code: "ENTRY_NOT_FOUND"` is included on both 404 branches — unlike the legacy posts by-id route
 * (message-only 404, a modified not new endpoint), errors.spec.md §1/§4 requires `code` on every new
 * endpoint's error response, and names `ENTRY_NOT_FOUND` as exactly this route's not-found code.
 */
export const pageGetRoute = defineJsonRoute<{ idOrSlug: string }, object, PageGetRouteDeps, PageRoutePrincipal>({
  method: "get",
  path: "/api/admin/v1/workspaces/:workspaceId/pages/:pageId",
  // Route param kept as `pageId` (external URL shape, untouched) — the value it carries is either
  // the row's id or its slug, resolved by the host's id-or-slug lookup.
  parse: (raw) => ok({ value: { idOrSlug: String(raw.params.pageId ?? "") } }),
  handle: async ({ input, deps, authorize }) => {
    await authorizePageRead({ authorize });
    try {
      const { post } = await deps.readPage({ workspaceId: deps.workspaceId, idOrSlug: input.idOrSlug });
      // Kind mismatch — treated identically to not-found (api.spec.md §6/§7).
      if (post.kind !== "page") rejectRoute({ status: 404, error: `page '${input.idOrSlug}' was not found`, code: "ENTRY_NOT_FOUND" });
      const response = deps.toAdminPageResponse({ post });
      const pluginEmbeds = await pagePluginEmbeds({ html: post.bodyHtml ?? "", workspaceId: deps.workspaceId, runtime: deps.pluginExports() });
      return ok({ value: pluginEmbeds.length ? { ...response, pluginEmbeds } : response });
    } catch (err) {
      if (deps.isPostNotFound({ err })) rejectRoute({ status: 404, error: err instanceof Error ? err.message : String(err), code: "ENTRY_NOT_FOUND" });
      throw err;
    }
  },
});
