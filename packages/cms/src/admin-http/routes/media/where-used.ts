import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";
import { rejectRoute } from "@jini-ai/core/errors/route-refusal";

import type { MediaRecord } from "../../../media/types.js";
import { authorizeMediaOrForbid, type MediaRoutePrincipal } from "./shared.js";

/** The deps this route reads. The host binds its usage scan (reference index plus current post bodies) into `findWhereUsed`. */
export interface MediaWhereUsedRouteDeps {
  workspaceId: string;
  mediaRepo: { findById: (required: { workspaceId: string; id: string }) => Promise<MediaRecord | null> };
  findWhereUsed: (required: { workspaceId: string; mediaId: string; slug: string }) => Promise<object>;
}

/**
 * GET where an asset is used — a read-only usage disclosure, sharing the `media.read` gate and the
 * existing workspace isolation. Usage is queried by the stored record's id AND slug, so a reference
 * written by slug is found too.
 *
 * Authorization comes before the asset lookup, so a caller without `media.read` learns nothing
 * about which ids exist. A denied `media.read` answers this route's own short body
 * (`media.read is required`), as it always has, rather than the authorizer's longer sentence.
 */
export const mediaWhereUsedRoute = defineJsonRoute<{ mediaId: string }, { mediaId: string; whereUsed: object }, MediaWhereUsedRouteDeps, MediaRoutePrincipal>({
  method: "get",
  path: "/api/admin/v1/workspaces/:workspaceId/media/:mediaId/where-used",
  parse: (raw) => ok({ value: { mediaId: String(raw.params.mediaId ?? "") } }),
  handle: async ({ input, deps, authorize }) => {
    await authorizeMediaOrForbid({ authorize, permission: "media.read", forbidden: () => ({ error: "media.read is required", code: "FORBIDDEN" }) });
    const media = await deps.mediaRepo.findById({ workspaceId: deps.workspaceId, id: input.mediaId });
    if (!media) return rejectRoute({ status: 404, error: "media was not found" });
    const whereUsed = await deps.findWhereUsed({ workspaceId: deps.workspaceId, mediaId: media.id, slug: media.slug });
    return ok({ value: { mediaId: media.id, whereUsed } });
  },
});
