import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";

import { getEntryMeta, type SeoMeta } from "../../../seo/index.js";
import { withContentImageSource, withCoverReadDeps } from "../../../seo/cover-image.js";
import { authorizeSeoManage, parseSeoEntryId, rejectSeoEntryNotFound, type SeoEntryReadRouteDeps, type SeoEntryRouteInput, type SeoRoutePrincipal } from "./deps.js";

/** The deps this route reads. */
export type SeoGetEntryRouteDeps = SeoEntryReadRouteDeps;

/**
 * GET an entry's effective SEO meta (SPEC-008 api.spec.md `SEO_GET_ENTRY_META`, tasks.md T047).
 * Path deviation: workspace-scoped mount, matching every other admin route in this codebase.
 */
export const seoGetEntryRoute = defineJsonRoute<SeoEntryRouteInput, { data: SeoMeta }, SeoGetEntryRouteDeps, SeoRoutePrincipal>({
  method: "get",
  path: "/api/admin/v1/workspaces/:workspaceId/seo/entries/:entryId",
  parse: parseSeoEntryId,
  handle: async ({ input, deps, authorize }) => {
    await deps.seoReady;
    const { entryId } = input;
    await authorizeSeoManage({ authorize, entityType: "seo-entry" }, { entityId: entryId });
    try {
      const read = await withCoverReadDeps({ deps: deps.seoDeps, workspaceId: deps.workspaceId, entryId });
      const meta = await getEntryMeta({ deps: read.deps, input: { workspaceId: deps.workspaceId, entryId } }, {});
      return ok({ value: { data: withContentImageSource({ meta, rawPost: read.rawPost }) } });
    } catch (err) {
      return rejectSeoEntryNotFound({ err });
    }
  },
});
