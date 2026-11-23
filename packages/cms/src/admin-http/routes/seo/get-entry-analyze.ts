import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";

import { analyzeEntry, type SeoAnalysis } from "../../../seo/index.js";
import { withCoverReadDeps } from "../../../seo/cover-image.js";
import { authorizeSeoManage, parseSeoEntryId, rejectSeoEntryNotFound, type SeoEntryReadRouteDeps, type SeoEntryRouteInput, type SeoRoutePrincipal } from "./deps.js";

/** The deps this route reads. */
export type SeoGetEntryAnalyzeRouteDeps = SeoEntryReadRouteDeps;

/** GET SEO score+issues for an entry (SPEC-008 api.spec.md `SEO_GET_ENTRY_ANALYZE`, tasks.md T047). */
export const seoGetEntryAnalyzeRoute = defineJsonRoute<SeoEntryRouteInput, { data: SeoAnalysis }, SeoGetEntryAnalyzeRouteDeps, SeoRoutePrincipal>({
  method: "get",
  path: "/api/admin/v1/workspaces/:workspaceId/seo/entries/:entryId/analyze",
  parse: parseSeoEntryId,
  handle: async ({ input, deps, authorize }) => {
    await deps.seoReady;
    const { entryId } = input;
    await authorizeSeoManage({ authorize, entityType: "seo-entry" }, { entityId: entryId });
    try {
      const read = await withCoverReadDeps({ deps: deps.seoDeps, workspaceId: deps.workspaceId, entryId });
      const analysis = await analyzeEntry({ deps: read.deps, input: { workspaceId: deps.workspaceId, entryId } }, {});
      return ok({ value: { data: analysis } });
    } catch (err) {
      return rejectSeoEntryNotFound({ err });
    }
  },
});
