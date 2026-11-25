import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";
import type { UUID } from "@jini-ai/core/primitives";
import { rejectRoute } from "@jini-ai/core/errors/route-refusal";

import { computeBlobStorageKey } from "../../../media/blob-key.js";
import { PUBLISH_CONTENT_BLOB_PROBE_MAX_SHAS, isValidSha256Hex } from "../../../publish/transfer/blob-staging.js";
import type { PublishRoutePrincipal } from "./transport-shared.js";

/**
 * @file Task 6 of the publish-content (Publish Content) feature —
 * `ADS-memory/reports/2026-09-18-publish-feature-implementation-plan.md` §4 task 6.
 *
 * `POST /api/admin/v1/workspaces/:workspaceId/publish-content/blobs/probe` — "which of these shas
 * do you already have?" so a peer pushing a bundle only uploads what this instance is actually
 * missing (plan §4 task 6's own description). Read-only against the blob store (`exists()` only,
 * never `put*`); gated by `publish_content.apply` per the dispatching brief — this is part of the
 * write flow (a peer preparing to push), not the export/read side's `publish_content.read`.
 *
 * Request: `{ shas: string[] }`, each a lowercase 64-hex-char sha256 digest
 * (`blob-staging.ts`'s `isValidSha256Hex`). Response: `{ missing: string[] }` — the subset of
 * `shas` this instance does NOT already hold, in the order they were requested minus any removed as
 * duplicates-of-a-hit; the client uploads exactly this list via `PUT .../blobs/:sha`.
 *
 * Wire notes for the host: the spec declares no `maxBodyBytes`. The host mounts its content-entry body cap
 * (`CONTENT_ENTRY_MAX_BODY_BYTES`) as a `bodyParsers` middleware ahead of the workspace refusal, with the 413 body its
 * admin client reads; a second cap on the spec would measure the body twice. A bad body is the flat `{ error }` 400
 * with no `code`, answered after the permission check, as the hand-written route did.
 */

/** What the host injects: the mounted workspace and the one blob-store read this route makes. */
export interface BlobsProbeRouteDeps {
  workspaceId: string;
  blobStore: { exists(required: { storageKey: string }): Promise<boolean> };
}

/** The request body; validated after authorization, so the raw value is carried through `parse`. */
type BlobsProbeInput = unknown;

/** Body-shape validation extracted from the handler for a single early-return gate: `shas` must be
 *  a non-empty array, within the resource-bounds cap, of strings that each look like a sha256 hex
 *  digest. Returns the validated array, or a human-readable error string to send as a 400.
 *  @complexity O(n) in the array length. */
function validateProbeShas({ rawBody }: { rawBody: unknown }, _options: Record<string, never> = {}): { shas: string[] } | { error: string } {
  const body = (rawBody ?? {}) as Record<string, unknown>;
  const shas = body.shas;
  if (!Array.isArray(shas) || shas.length === 0) {
    return { error: "shas must be a non-empty array of sha256 hex digests" };
  }
  if (shas.length > PUBLISH_CONTENT_BLOB_PROBE_MAX_SHAS) {
    return { error: `at most ${PUBLISH_CONTENT_BLOB_PROBE_MAX_SHAS} shas are allowed per request` };
  }
  for (const sha of shas) {
    if (typeof sha !== "string" || !isValidSha256Hex({ value: sha })) {
      return { error: `'${String(sha)}' is not a valid lowercase sha256 hex digest` };
    }
  }
  return { shas: shas as string[] };
}

/** `POST .../publish-content/blobs/probe` — `publish_content.apply` (guarded, no entity type), then the missing shas. */
export const blobsProbeRoute = defineJsonRoute<BlobsProbeInput, { missing: string[] }, BlobsProbeRouteDeps, PublishRoutePrincipal>({
  method: "post",
  path: "/api/admin/v1/workspaces/:workspaceId/publish-content/blobs/probe",
  parse: ({ body }) => ok({ value: body }),
  handle: async ({ input, deps, authorize }) => {
    if (!authorize) throw new Error("publish-content admin route has no authorizer");
    await authorize({ permission: "publish_content.apply" });
    const validated = validateProbeShas({ rawBody: input });
    if ("error" in validated) return rejectRoute({ status: 400, error: validated.error });
    const missing: string[] = [];
    for (const sha256 of validated.shas) {
      const storageKey = computeBlobStorageKey({ workspaceId: deps.workspaceId as UUID, sha256 });
      const present = await deps.blobStore.exists({ storageKey });
      if (!present) missing.push(sha256);
    }
    return ok({ value: { missing } });
  },
});
