import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";
import { RouteRefusalError } from "@jini-ai/core/errors/route-refusal";
import type { AdminMediaPurgeEnvelope } from "@jini-ai/core/contracts/site/cms-media";

import { MediaStillReferencedError } from "../../../media/types.js";
import { authorizeMedia, MEDIA_NOT_FOUND, mediaIdParam, rejectMediaError, type MediaRoutePrincipal } from "./shared.js";

/**
 * Hard-purges one asset. Injected because the reference check is the host's (its current post
 * bodies and indexed references, checked immediately before the shared deletion). Resolves
 * `{ purged: true }` or throws `MediaStillReferencedError` / `MediaNotFoundError`.
 */
export type MediaPurgeFn = (required: { workspaceId: string; id: string }) => Promise<{ purged: true }>;

/** Drops a purged asset's Trash index row (the host's generic Trash store). */
export type MediaForgetRemovedFn = (required: { workspaceId: string; id: string }) => Promise<unknown>;

/** The deps this route reads. */
export interface MediaDeleteRouteDeps {
  workspaceId: string;
  purgeMedia: MediaPurgeFn;
  forgetRemovedMedia: MediaForgetRemovedFn;
}

/** 409 with the referencing list while content still uses the asset, 404 for an unknown asset,
 *  otherwise rethrown for the host's private 500. Checked before the `MediaConflictError` superclass.
 *  @complexity O(1). */
function rejectPurgeError({ err }: { err: unknown }, _optional: Record<string, never> = {}): never {
  // The referencing list is part of the 409 body the admin client reads, beyond the flat
  // `{ error, code, details }` shape `rejectRoute` writes, so the refusal is raised directly.
  if (err instanceof MediaStillReferencedError) throw new RouteRefusalError({ status: 409, body: { error: err.message, referencing: err.referencing } });
  return rejectMediaError({ err, mappings: [MEDIA_NOT_FOUND] });
}

/**
 * DELETE hard-purges a media asset — second rung of the ADR-027 §5 deletion
 * ladder. Requires Trash first and 409s with the referencing list while current content
 * still uses the asset. Lookup failures refuse deletion. Gated by `media.delete.force` (SPEC-021 REQ-39/OQ-01, ADR-027 §7) — a separate,
 * narrower permission than the ordinary trash's `media.delete`, since this is an irreversible purge
 * (mirrors `admin.menus.delete` vs `admin.menus.delete.force`'s split).
 */
export const mediaDeleteRoute = defineJsonRoute<{ mediaId: string }, AdminMediaPurgeEnvelope, MediaDeleteRouteDeps, MediaRoutePrincipal>({
  method: "delete",
  path: "/api/admin/v1/workspaces/:workspaceId/media/:mediaId",
  parse: (raw) => ok({ value: { mediaId: mediaIdParam({ params: raw.params }) } }),
  handle: async ({ input, deps, authorize }) => {
    await authorizeMedia({ authorize, permission: "media.delete.force" }, { entityId: input.mediaId });
    try {
      // `purgeMedia` resolves `{ purged: true }` or throws, so there is no not-purged outcome to skip.
      const { purged } = await deps.purgeMedia({ workspaceId: deps.workspaceId, id: input.mediaId });
      // The bytes are gone for good, so the Trash index row has to go with them — otherwise the
      // Trash screen keeps offering a Restore for an asset that no longer exists.
      await deps.forgetRemovedMedia({ workspaceId: deps.workspaceId, id: input.mediaId });
      return ok({ value: { purged } });
    } catch (err) {
      return rejectPurgeError({ err });
    }
  },
});
