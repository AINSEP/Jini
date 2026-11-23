import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";
import type { AdminMediaEnvelope } from "@jini-ai/core/contracts/site/cms-media";
import type { IsoClock } from "@jini-ai/core/primitives";
import { rejectRoute } from "@jini-ai/core/errors/route-refusal";

import type { MediaRepoPort } from "../../../media/ports.js";
import { authorizeMedia, describeMediaAsset, mediaActorId, mediaIdParam, type MediaAssetLookups, type MediaRoutePrincipal } from "./shared.js";

/**
 * Flips one asset's trash marker and writes its Trash index row in one transaction. Injected
 * because the Trash pipeline is the host's. `ok: false` carries why the flip was refused.
 */
export type MediaRemoveFn = (required: {
  workspaceId: string;
  id: string;
  display: { title: string; subtitle: string };
  at: string;
  expectedVersion: number;
  actor: { principalId: string };
}) => Promise<{ ok: true } | { ok: false; reason: string }>;

/** The deps this route reads. */
export interface MediaTrashRouteDeps extends MediaAssetLookups {
  workspaceId: string;
  mediaRepo: Pick<MediaRepoPort, "findById">;
  clock: IsoClock;
  removeMedia: MediaRemoveFn;
}

/** The media routes' `404 media '<id>' was not found` refusal. @complexity O(1). */
function rejectMediaNotFound({ mediaId }: { mediaId: string }, _optional: Record<string, never> = {}): never {
  return rejectRoute({ status: 404, error: `media '${mediaId}' was not found` });
}

/** Maps a refused marker flip to its refusal. @complexity O(1). */
function rejectRemoveFailure({ mediaId, reason }: { mediaId: string; reason: string }, _optional: Record<string, never> = {}): never {
  // `not-found` can only mean the row went away between the read above and the flip.
  if (reason === "not-found") rejectMediaNotFound({ mediaId });
  return rejectRoute({ status: 409, error: `media '${mediaId}' changed while it was being trashed` });
}

/**
 * POST soft-delete (trash) a media asset — first rung of the ADR-027 §5 deletion ladder. Gated by
 * `media.delete` (SPEC-021 REQ-39/OQ-01, ADR-027 §7).
 *
 * The marker flip goes through `deps.removeMedia` rather than `@jini-ai/cms`'s `trashMedia`, so the
 * flip and the Trash index row are one transaction. The `display` snapshot is taken from the record
 * this route already loaded — columns only, no payload parse, so an asset whose metadata is corrupt
 * is still deletable and still listable in the Trash.
 */
export const mediaTrashRoute = defineJsonRoute<{ mediaId: string }, AdminMediaEnvelope, MediaTrashRouteDeps, MediaRoutePrincipal>({
  method: "post",
  path: "/api/admin/v1/workspaces/:workspaceId/media/:mediaId/trash",
  parse: (raw) => ok({ value: { mediaId: mediaIdParam({ params: raw.params }) } }),
  handle: async ({ input, deps, context, authorize }) => {
    const principalId = mediaActorId({ context });
    const { mediaId } = input;
    await authorizeMedia({ authorize, permission: "media.delete" }, { entityId: mediaId });
    const existing = await deps.mediaRepo.findById({ workspaceId: deps.workspaceId, id: mediaId });
    if (!existing) rejectMediaNotFound({ mediaId });
    const removed = await deps.removeMedia({
      workspaceId: deps.workspaceId, id: mediaId, display: { title: existing.title, subtitle: existing.slug },
      at: deps.clock.nowIso(), expectedVersion: existing.version, actor: { principalId },
    });
    if (!removed.ok) rejectRemoveFailure({ mediaId, reason: removed.reason });
    // Re-read rather than reconstruct: the marker flip happened in SQL, so this is the one shape
    // guaranteed to match what every other media route returns.
    const media = await deps.mediaRepo.findById({ workspaceId: deps.workspaceId, id: mediaId });
    if (!media) rejectMediaNotFound({ mediaId });
    return ok({ value: { media: await describeMediaAsset({ deps, media }) } });
  },
});
