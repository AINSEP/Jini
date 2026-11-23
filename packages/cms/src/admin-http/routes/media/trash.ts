import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";
import { rejectRoute } from "@jini-ai/core/errors/route-refusal";

import type { MediaRecord } from "../../../media/types.js";
import { authorizeMedia, principalOf, rejectMediaNotFound, type MediaRoutePrincipal } from "./shared.js";

/** One asset's removal, handed to whoever owns removal in the host composition (marker flip plus Trash index row). */
export type MediaTrashRemove = (required: {
  workspaceId: string;
  id: string;
  display: { title: string; subtitle: string };
  at: string;
  expectedVersion: number;
  actor: { principalId: string };
}) => Promise<{ ok: true } | { ok: false; reason: string }>;

/** The deps this route reads. `toMediaResponse` is the host's admin media DTO (recorded type, public URL, stored size). */
export interface MediaTrashRouteDeps {
  workspaceId: string;
  mediaRepo: { findById: (required: { workspaceId: string; id: string }) => Promise<MediaRecord | null> };
  removeMedia: MediaTrashRemove;
  clock: { nowIso: () => string };
  toMediaResponse: (required: { media: MediaRecord }) => Promise<object>;
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
export const mediaTrashRoute = defineJsonRoute<{ mediaId: string }, { media: object }, MediaTrashRouteDeps, MediaRoutePrincipal>({
  method: "post",
  path: "/api/admin/v1/workspaces/:workspaceId/media/:mediaId/trash",
  parse: (raw) => ok({ value: { mediaId: String(raw.params.mediaId ?? "") } }),
  handle: async ({ input, deps, context, authorize }) => {
    const { mediaId } = input;
    await authorizeMedia({ authorize, permission: "media.delete" }, { entityId: mediaId });
    const principal = principalOf({ context });
    const existing = await deps.mediaRepo.findById({ workspaceId: deps.workspaceId, id: mediaId });
    if (!existing) return rejectMediaNotFound({ mediaId });

    const removed = await deps.removeMedia({
      workspaceId: deps.workspaceId,
      id: mediaId,
      display: { title: existing.title, subtitle: existing.slug },
      at: deps.clock.nowIso(),
      expectedVersion: existing.version,
      actor: { principalId: principal.id },
    });
    if (!removed.ok) return rejectRemoveFailure({ mediaId, reason: removed.reason });

    // Re-read rather than reconstruct: the marker flip happened in SQL, so this is the one shape
    // guaranteed to match what every other media route returns.
    const media = await deps.mediaRepo.findById({ workspaceId: deps.workspaceId, id: mediaId });
    if (!media) return rejectMediaNotFound({ mediaId });
    return ok({ value: { media: await deps.toMediaResponse({ media }) } });
  },
});

/** Maps a refused marker flip to its refusal.
 *  @complexity O(1). */
function rejectRemoveFailure({ mediaId, reason }: { mediaId: string; reason: string }, _optional: Record<string, never> = {}): never {
  // `not-found` can only mean the row went away between the read above and the flip.
  if (reason === "not-found") return rejectMediaNotFound({ mediaId });
  return rejectRoute({ status: 409, error: `media '${mediaId}' changed while it was being trashed` });
}
