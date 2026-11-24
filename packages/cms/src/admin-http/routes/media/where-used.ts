import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";
import type { AdminMediaWhereUsedEnvelope } from "@jini-ai/core/contracts/site/cms-media";
import { rejectRoute } from "@jini-ai/core/errors/route-refusal";

import type { MediaRepoPort } from "../../../media/ports.js";
import { mediaIdParam, type MediaRoutePrincipal } from "./shared.js";

/** The host's usage finder (entries, posts, references), asked for the stored id and slug. */
export type MediaWhereUsedFinder = (required: { workspaceId: string; mediaId: string; slug: string }) => Promise<unknown>;

/** The deps this route reads: the workspace, the asset lookup and the host's usage finder. */
export interface MediaWhereUsedRouteDeps {
  workspaceId: string;
  mediaRepo: Pick<MediaRepoPort, "findById">;
  findWhereUsed: MediaWhereUsedFinder;
}

/**
 * Read-only usage disclosure, sharing the media.read gate and existing workspace isolation.
 * The check names the `media` type but no entity id, as the hand-written route asked it; its denial
 * body (`media.read is required`, no `details`) is the host mount's `forbidden` reply.
 */
export const mediaWhereUsedRoute = defineJsonRoute<{ mediaId: string }, AdminMediaWhereUsedEnvelope, MediaWhereUsedRouteDeps, MediaRoutePrincipal>({
  method: "get",
  path: "/api/admin/v1/workspaces/:workspaceId/media/:mediaId/where-used",
  parse: (raw) => ok({ value: { mediaId: mediaIdParam({ params: raw.params }) } }),
  handle: async ({ input, deps, authorize }) => {
    if (!authorize) throw new Error("media admin route has no authorizer");
    await authorize({ permission: "media.read", entityType: "media" });
    const media = await deps.mediaRepo.findById({ workspaceId: deps.workspaceId, id: input.mediaId });
    if (!media) rejectRoute({ status: 404, error: "media was not found" });
    const whereUsed = await deps.findWhereUsed({ workspaceId: deps.workspaceId, mediaId: media.id, slug: media.slug });
    return ok({ value: { mediaId: media.id, whereUsed } });
  },
});
