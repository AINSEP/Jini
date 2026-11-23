import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";

import { analyzeEntry, type GetEntryMetaDeps } from "../../../seo/seo.js";
import type { SeoAnalysis } from "../../../seo/types.js";
import { withCoverReadDeps } from "../../../seo/cover-image.js";
import { authorizeSeo, rejectSeoError, SEO_ENTRY_NOT_FOUND, seoEntryIdParam, type SeoRoutePrincipal } from "./shared.js";

/** The deps this route reads: the workspace, the SEO readiness gate and the entry-meta read deps. */
export interface SeoGetEntryAnalyzeRouteDeps {
  workspaceId: string;
  seoReady: PromiseLike<unknown>;
  seoDeps: GetEntryMetaDeps;
}

const SEO_ANALYZE_ERRORS = [SEO_ENTRY_NOT_FOUND] as const;

/** GET an entry's SEO score and issues (SPEC-008 `SEO_GET_ENTRY_ANALYZE`), over the cover-aware meta. */
export const seoGetEntryAnalyzeRoute = defineJsonRoute<{ entryId: string }, { data: SeoAnalysis }, SeoGetEntryAnalyzeRouteDeps, SeoRoutePrincipal>({
  method: "get",
  path: "/api/admin/v1/workspaces/:workspaceId/seo/entries/:entryId/analyze",
  parse: (raw) => ok({ value: { entryId: seoEntryIdParam({ params: raw.params }) } }),
  handle: async ({ input, deps, authorize }) => {
    await authorizeSeo({ authorize, ready: deps.seoReady, entityType: "seo-entry" }, { entityId: input.entryId });
    try {
      const read = await withCoverReadDeps({ deps: deps.seoDeps, workspaceId: deps.workspaceId, entryId: input.entryId });
      const analysis = await analyzeEntry({ deps: read.deps, input: { workspaceId: deps.workspaceId, entryId: input.entryId } }, {});
      return ok({ value: { data: analysis } });
    } catch (err) {
      return rejectSeoError({ err, mappings: SEO_ANALYZE_ERRORS });
    }
  },
});
