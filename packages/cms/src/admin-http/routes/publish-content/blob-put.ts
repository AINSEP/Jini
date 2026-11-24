import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";
import { decodeStrictBase64 } from "@jini-ai/core/contracts/site/strict-base64";
import { rejectRoute } from "@jini-ai/core/errors/route-refusal";

import { bytesMatchSha256 } from "../../../publish/transfer/blob-staging.js";
import { authorizePublishContentPermission, blobShaParam } from "./blob-shared.js";
import type { PublishRoutePrincipal } from "./transport-shared.js";

/**
 * @file Task 6 of the publish-content (Publish Content) feature —
 * `ADS-memory/reports/2026-09-18-publish-feature-implementation-plan.md` §4 task 6.
 *
 * `PUT /api/admin/v1/workspaces/:workspaceId/publish-content/blobs/:sha` — uploads one blob's
 * bytes, deduplicated via the SAME real `BlobStorePort.putIfAbsent` every media upload already uses
 * (dispatching brief: "media is the easy half of this feature ... reuse it, do not write a second
 * dedupe path"). Request body is JSON with base64-encoded bytes (`dataBase64`), mirroring
 * `routes/media/upload.ts`'s own documented simplification (no multipart-parsing dependency in this
 * repo yet).
 *
 * ## The refusal this route exists to enforce
 *
 * `putIfAbsent` (`@jini-ai/cms/media`'s `blob-store.fs.ts`/`blob-store.memory.ts`) does NOT verify
 * that the bytes it receives actually hash to the `sha256` it is given — it only uses that string to
 * derive a storage key and writes a create-only object there (see `blob-staging.ts`'s own header for
 * the full trace). The sha IS the identity everywhere else in this feature (baselines,
 * `PackedEntity.requiredBlobs`, a bundle's `blobManifest`), so this route calls
 * {@link bytesMatchSha256} and returns `422` on a mismatch BEFORE ever calling `putIfAbsent` —
 * accepting mismatched bytes here would let a caller poison content-addressed storage.
 */

/** The deps this route reads: the workspace it serves and the one blob-store write it makes. */
export interface BlobPutRouteDeps {
  workspaceId: string;
  /** The host's content-addressed blob store (create-only; it does not verify the sha itself). */
  blobStore: { putIfAbsent(required: { workspaceId: string; sha256: string; bytes: Uint8Array }): Promise<{ written: boolean }> };
  /** The upload ceiling in bytes (the media library's `MAX_DOCUMENT_BYTES`). */
  maxUploadBytes: number;
}

/** The 200 body: the stored sha and whether this call wrote it (`false` = already present). */
export interface BlobPutBody { sha256: string; written: boolean }

/** Decodes base64 upload bytes, or `null` if `dataBase64` is missing, not a string, or not valid
 *  base64 — mirrors `routes/media/upload.ts`'s own `decodeUploadBytes`. Delegates the actual
 *  decode to {@link decodeStrictBase64}: `Buffer.from(x, "base64")` alone never throws (it skips
 *  characters outside the alphabet instead of refusing them), so a bare try/catch around it can
 *  never fire — see that function's own header.
 *  @complexity O(n) in the encoded payload length. */
export function decodeBlobBytes({ rawBody }: { rawBody: unknown }, _options: Record<string, never> = {}): Uint8Array | null {
  const body = (rawBody ?? {}) as Record<string, unknown>;
  const dataBase64 = body.dataBase64;
  if (typeof dataBase64 !== "string" || !dataBase64) return null;
  return decodeStrictBase64({ value: dataBase64 });
}

/** Upload one blob's bytes. The body is read only after the permission check, as before. @complexity O(n) in the payload. */
export const blobPutRoute = defineJsonRoute<{ claimedSha256: string; rawBody: unknown }, BlobPutBody, BlobPutRouteDeps, PublishRoutePrincipal>({
  method: "put",
  path: "/api/admin/v1/workspaces/:workspaceId/publish-content/blobs/:sha",
  parse: (raw) => ok({ value: { claimedSha256: blobShaParam({ params: raw.params }), rawBody: raw.body } }),
  handle: async ({ input: { claimedSha256, rawBody }, deps, authorize }) => {
    await authorizePublishContentPermission({ authorize, permission: "publish_content.apply" });
    const bytes = decodeBlobBytes({ rawBody });
    if (!bytes) rejectRoute({ status: 400, error: "dataBase64 is required and must be valid base64" });
    if (bytes.length > deps.maxUploadBytes) {
      rejectRoute({ status: 413, error: `blob exceeds the ${deps.maxUploadBytes}-byte upload limit`, code: "PAYLOAD_TOO_LARGE" });
    }
    // The security property this route exists to hold — see this file's own header.
    // `putIfAbsent` trusts `claimedSha256` unconditionally; this check MUST run before it.
    if (!bytesMatchSha256({ bytes, claimedSha256 })) {
      rejectRoute({ status: 422, error: "the uploaded bytes do not hash to the claimed sha256", code: "SHA256_MISMATCH" });
    }
    const { written } = await deps.blobStore.putIfAbsent({ workspaceId: deps.workspaceId, sha256: claimedSha256, bytes });
    return ok({ value: { sha256: claimedSha256, written } });
  },
});
