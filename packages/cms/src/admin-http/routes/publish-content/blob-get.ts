import { defineJsonRoute, ok, routeReply, type RouteReply } from "@jini-ai/core/contracts/server";
import { rejectRoute } from "@jini-ai/core/errors/route-refusal";

import { computeBlobStorageKey, isDocumentOnlyBlob, MAX_DOCUMENT_BYTES, type AssetBlobRepoPort, type MediaRepoPort } from "../../../media/index.js";
import { authorizePublishContentPermission, blobShaParam } from "./blob-shared.js";
import type { PublishRoutePrincipal } from "./transport-shared.js";

/**
 * `GET /api/admin/v1/workspaces/:workspaceId/publish-content/blobs/:sha` — the DOWNLOAD half of the
 * blob channel, added 2026-09-19 to close a live gap: the push direction could upload bytes
 * (`blob-put.ts`) and ask what was missing (`blobs-probe.ts`), but nothing could fetch bytes back,
 * so a PULLED media entity always failed closed as `blocked` (`features/publish-content/
 * peer-transport.ts`'s own "KNOWN GAP" note). This route is that missing verb, and nothing else —
 * it is deliberately additive, and the pull architecture around it is untouched.
 *
 * ## Authorization: `publish_content.read`, and why that is not weaker than the upload path
 *
 * `blob-put.ts` gates on `publish_content.apply`; this route gates on `publish_content.read`. That
 * is a deliberate direction call, not a relaxation:
 *
 * - **Same holder set today.** `features/publish-content/permissions.ts` grants BOTH permissions to
 *   exactly one built-in role (`admin`), plus the seeded owner's `*` wildcard. No principal can
 *   reach this route that could not already reach `blob-put.ts`, and `editor`/`viewer` reach
 *   neither.
 * - **Same exposure as the route that reveals the shas.** `export.ts` gates on
 *   `publish_content.read` and hands out `blobManifest` — the list of shas — to exactly this holder
 *   set. Gating the bytes on the same permission means the bytes are never reachable by a principal
 *   who could not have learned the sha in the first place.
 * - **`apply` here would be a real privilege escalation.** A pull-only peer credential calls
 *   `GET .../export` and then this route. If the download demanded `apply`, every pull-only key
 *   would have to hold the permission that lets it WRITE content into the source instance. Demanding
 *   a write permission for a read is stricter on paper and strictly worse in practice.
 *
 * ## The threat this route must not become
 *
 * Content-addressed storage means a leaked or guessed sha is a read capability IF knowing the hash
 * is sufficient. It is not sufficient here. Three things close it, in order:
 *
 * 1. The mount-path workspace guard — the same `!== deps.workspaceId` 404 every route in this
 *    directory opens with.
 * 2. A real permission check against the AUTHENTICATED principal (above). Knowing a sha — even
 *    having uploaded those very bytes under `publish_content.apply` — grants nothing;
 *    `apps/website/src/server/__tests__/routes/publish-content-blob-get.test.ts` pins that case directly.
 * 3. The storage key is DERIVED, never accepted: `computeBlobStorageKey({workspaceId, sha256})`
 *    with this composition's own `workspaceId`. A caller supplies 64 hex characters and nothing
 *    else, so there is no path/traversal surface and no way to address another workspace's bytes.
 *
 * ## Why the response is base64 JSON rather than octet-stream, and why it buffers
 *
 * The only consumer is `peer-transport.ts`'s driver, which speaks through ADR-038's
 * `HttpClientPort` — a fully-materialized `{status, headers, bodyText}` response, not a stream. A
 * JSON body mirrors `blob-put.ts`'s own `dataBase64` request shape exactly, so the two directions
 * agree. Buffering is not a choice this route can avoid either: `BlobStorePort.get()` returns
 * `Promise<Uint8Array>` — the port exposes no streaming read, and every existing consumer
 * (`routes/media/original.ts`, `public-http/.../media-rendition.ts`) buffers the same way. Memory is
 * therefore bounded by {@link MAX_DOCUMENT_BYTES} per request, enforced below, which also keeps
 * the base64 body (≈4/3 of 50 MiB as of 2026-09-21, ≈66.7 MiB) under the peer policy's 96 MiB
 * `maxResponseBytes` cap (`PUBLISH_CONTENT_PEER_MAX_RESPONSE_BYTES`, raised from 64 MiB alongside it).
 *
 * ## Why this does not re-hash the bytes before sending
 *
 * The receiver does, and the receiver's check is the one that matters: `pullBlobsFromPeer` hashes
 * what arrived and refuses to store a mismatch. That covers a poisoned store, a corrupted transfer
 * AND a hostile peer, which a server-side check cannot. Hashing here too would double the CPU per
 * download to re-prove a property the only trust boundary already enforces.
 */

/** Where the bytes are read from: the blob store first, then the host's file-blob fallback. */
export interface BlobGetSource {
  exists(required: { sha256: string; storageKey: string }): Promise<boolean>;
  get(required: { sha256: string; storageKey: string }): Promise<Uint8Array>;
}

/** The deps this route reads. */
export interface BlobGetRouteDeps {
  workspaceId: string;
  mediaRepo: MediaRepoPort;
  assetBlobRepo: AssetBlobRepoPort;
  /** The host's composite blob source, built per request (it reads the host's current stores). */
  blobSource: (required: Record<string, never>) => BlobGetSource;
}

/** The 200 body: the sha and its bytes as base64. */
export interface BlobGetBody { sha256: string; dataBase64: string }

/** Download one blob's bytes. @complexity O(n) in the blob size plus the media-row scan. */
export const blobGetRoute = defineJsonRoute<{ sha256: string }, BlobGetBody | RouteReply, BlobGetRouteDeps, PublishRoutePrincipal>({
  method: "get",
  path: "/api/admin/v1/workspaces/:workspaceId/publish-content/blobs/:sha",
  parse: (raw) => ok({ value: { sha256: blobShaParam({ params: raw.params }) } }),
  handle: async ({ input: { sha256 }, deps, authorize }) => {
    await authorizePublishContentPermission({ authorize, permission: "publish_content.read" });
    // A peer's publish grant is not a Library read grant. A known document-only hash must
    // not bypass typed export's exclusion, even after purge; live media owners still travel.
    if (await isDocumentOnlyBlob({ deps: { mediaRepo: deps.mediaRepo, blobRepo: deps.assetBlobRepo }, input: { workspaceId: deps.workspaceId, sha256 } })) {
      return ok({ value: routeReply({ status: 404, body: { error: "blob was not found", code: "BLOB_NOT_FOUND" } }) });
    }
    const storageKey = computeBlobStorageKey({ workspaceId: deps.workspaceId, sha256 });
    // S18 (S-F3) — checks the blob store first, falling back to the host's file-blob index (a
    // file-tree type's `pack()` fill) for a blob that was never copied into the blob store. See
    // the host's `composite-blob-source.ts` header for why bytes are re-hashed on the fallback path.
    const blobSource = deps.blobSource({});
    if (!(await blobSource.exists({ sha256, storageKey }))) rejectRoute({ status: 404, error: "blob was not found", code: "BLOB_NOT_FOUND" });
    const bytes = await blobSource.get({ sha256, storageKey });
    if (bytes.byteLength > MAX_DOCUMENT_BYTES) {
      // Unreachable for anything this instance accepted (both `blob-put.ts` and the media upload
      // route enforce the same ceiling), so this is a bound on a store written by some other
      // means — never a silent 47 MB+ base64 response.
      rejectRoute({ status: 413, error: `blob exceeds the ${MAX_DOCUMENT_BYTES}-byte transfer limit`, code: "PAYLOAD_TOO_LARGE" });
    }
    return ok({ value: { sha256, dataBase64: Buffer.from(bytes).toString("base64") } });
  },
});
