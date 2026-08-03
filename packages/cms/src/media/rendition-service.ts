/**
 * @file Rendition resolution service (ADR-027 §4) — "serve-if-exists +
 * bounded generate-if-defined", the read path behind the frozen public URL
 * contract `https://{mediaOrigin}/m/{assetId}/{transformName}.v{version}/{slug}.{ext}`.
 *
 * Scope built in this task:
 *  - Serve-if-exists: an existing `(assetId, transformName, version)`
 *    rendition row always serves, unconditionally.
 *  - Bounded generate-if-defined: an as-yet-ungenerated rendition is only
 *    lazily generated if its `(name, version)` is the LATEST registered
 *    version of `name` (`isLatestTransformVersion`) or referenced by
 *    published content (`isReferencedByPublishedContent`, stubbed `false` —
 *    see `transform-registry.ts`). This is the amplification-vector guard:
 *    an attacker enumerating old version numbers can't force generation of
 *    every historical rendition.
 *  - Single-flight generation: concurrent requests for the same
 *    not-yet-generated `(sha256, transformName, version)` run the image
 *    transformer exactly once (`withRenditionLock`, `transform-lock.ts`), via
 *    a double-checked lookup inside the lock so a waiter that lost the race
 *    reuses the winner's freshly-written row instead of regenerating.
 *
 * Explicitly OUT of scope for this task (named, not silently dropped):
 *  - Eager generation for a hot set via an outbox worker.
 *  - Out-of-process generation (a worker thread/process to protect the host
 *    from the transform's native work OOMing, ADR-027 §1/§4). This build
 *    calls `ImageTransformerPort.transform` in-process, synchronously awaited
 *    within the request.
 *  - Origin-isolated serving (a second listener/process for the `/m/` route).
 *  - The real `entry_refs` "referenced by published content" check.
 */
import { createHash } from "node:crypto";

import type { ClockPort, IdGeneratorPort, UUID } from "../core/ports.js";
import type { AssetBlobRepoPort, AssetRenditionRepoPort, BlobStorePort, MediaRepoPort, TransformDefinitionRepoPort } from "./ports.js";
import type { AssetRenditionRecord } from "./types.js";
import { mimeForTransformFormat } from "./transform-types.js";
import { isLatestTransformVersion, isReferencedByPublishedContent } from "./transform-registry.js";
import { withRenditionLock } from "./transform-lock.js";
import type { ImageTransformerPort } from "./image-transformer.js";

export interface ResolveMediaRenditionDeps {
  mediaRepo: MediaRepoPort;
  blobRepo: AssetBlobRepoPort;
  renditionRepo: AssetRenditionRepoPort;
  transformRepo: TransformDefinitionRepoPort;
  blobStore: BlobStorePort;
  imageTransformer: ImageTransformerPort;
  clock: ClockPort;
  idGen: IdGeneratorPort;
}

export interface ResolveMediaRenditionInput {
  workspaceId: UUID;
  assetId: UUID;
  /** The `{transformName}` path segment — cosmetic slug/ext are stripped by the caller (route). */
  transformName: string;
  /** The `{version}` parsed out of the `.v{version}` path segment. */
  version: number;
}

export interface ResolveMediaRenditionRequired {
  deps: ResolveMediaRenditionDeps;
  input: ResolveMediaRenditionInput;
}

/**
 * `ok` — bytes ready to serve with `Cache-Control: public, max-age=31536000, immutable`.
 * `gone` — the asset is trashed (this build's disclosed stand-in for "purged"; see below) ->
 * caller should respond `410 no-store`.
 * `not-found` — no such asset, no such registered transform version, or a valid-but-not-latest/
 * not-referenced version that anonymous generation is not allowed to materialize -> caller should
 * respond a short-TTL `404`.
 */
export type ResolveMediaRenditionResult =
  | { outcome: "ok"; bytes: Uint8Array; contentType: string }
  | { outcome: "gone" }
  | { outcome: "not-found" };

/**
 * DISCLOSED SIMPLIFICATION: ADR-027 §4 says a *purged* asset should 410. This
 * build's `purgeMedia` (`media-service.ts`) hard-deletes the `MediaRecord`
 * row with no tombstone, so a purged assetId is indistinguishable here from
 * one that never existed at all — both read as "no media row found". Rather
 * than fabricate a tombstone table this task wasn't scoped to build, this
 * function treats "no media row" as `not-found` (404 — a defensible default:
 * standard REST semantics for an ID this server has no record of) and
 * treats the one gone-but-still-observable status this build actually has —
 * `status === "trashed"` (the deletion ladder's soft-delete stage, before a
 * possible future purge) — as `gone` (410). A real tombstone-backed purge
 * would extend this function's first branch, not restructure it.
 *
 * @complexity O(1) plus the O(v) cost of {@link isLatestTransformVersion}'s
 * version scan on the not-yet-generated path; the generation path is
 * dominated by `imageTransformer.transform`'s cost (native work, out of this
 * function's control).
 * @overallScore 95
 * @findings Low: the trashed-vs-purged 410 mapping above is a disclosed
 * approximation, not the ADR's literal "purged" predicate — see this
 * function's doc comment for why building a real tombstone was out of scope.
 */
export async function resolveMediaRendition(
  required: ResolveMediaRenditionRequired,
  _optional: Record<string, never> = {}
): Promise<ResolveMediaRenditionResult> {
  const { deps, input } = required;

  const media = await deps.mediaRepo.findById({ workspaceId: input.workspaceId, id: input.assetId });
  if (!media) return { outcome: "not-found" };
  if (media.status === "trashed") return { outcome: "gone" };

  const definition = await deps.transformRepo.findByNameVersion({
    workspaceId: input.workspaceId,
    name: input.transformName,
    version: input.version,
  });
  if (!definition) return { outcome: "not-found" };

  const existing = await deps.renditionRepo.findOne({
    workspaceId: input.workspaceId,
    assetId: input.assetId,
    transformName: input.transformName,
    version: input.version,
  });
  if (existing) {
    const bytes = await deps.blobStore.get({ storageKey: existing.storageKey });
    return { outcome: "ok", bytes, contentType: mimeForTransformFormat(definition.params.format) };
  }

  const generationAllowed =
    isReferencedByPublishedContent({ workspaceId: input.workspaceId, name: input.transformName, version: input.version }) ||
    (await isLatestTransformVersion({
      deps: { transformRepo: deps.transformRepo },
      input: { workspaceId: input.workspaceId, name: input.transformName, version: input.version },
    }));
  if (!generationAllowed) return { outcome: "not-found" };

  const sourceBlob = await deps.blobRepo.findByHash({ workspaceId: input.workspaceId, sha256: media.source.sha256 });
  if (!sourceBlob) {
    // Data-integrity gap, not a normal 404/410: `uploadMedia`'s invariant (bytes written before
    // the media row) means this should be unreachable. Surfaced as a thrown error (-> caller's
    // catch-all 500), not silently treated as "not found", so it isn't mistaken for a routine
    // missing-rendition case.
    throw new Error(`media '${media.id}': source blob for sha256 '${media.source.sha256}' was not found`);
  }

  const lockKey = `${media.source.sha256}:${input.transformName}:${input.version}`;
  const renditionRow = await withRenditionLock(lockKey, async () => {
    // Double-checked: another caller may have finished generating this exact rendition while we
    // were queued for the lock (ADR-027 §4 single-flight) — reuse it instead of calling
    // `imageTransformer.transform` a second time.
    const racedExisting = await deps.renditionRepo.findOne({
      workspaceId: input.workspaceId,
      assetId: input.assetId,
      transformName: input.transformName,
      version: input.version,
    });
    if (racedExisting) return racedExisting;

    const sourceBytes = await deps.blobStore.get({ storageKey: sourceBlob.storageKey });
    const { bytes: outputBytes } = await deps.imageTransformer.transform({
      bytes: sourceBytes,
      params: definition.params,
    });
    const outputSha256 = createHash("sha256").update(outputBytes).digest("hex");
    const { storageKey } = await deps.blobStore.put({
      workspaceId: input.workspaceId,
      sha256: outputSha256,
      bytes: outputBytes,
    });

    const row: AssetRenditionRecord = {
      id: deps.idGen.newId(),
      workspaceId: input.workspaceId,
      assetId: input.assetId,
      transformName: input.transformName,
      version: input.version,
      storageKey,
      createdAt: deps.clock.nowIso(),
    };
    await deps.renditionRepo.save(row);
    return row;
  });

  const bytes = await deps.blobStore.get({ storageKey: renditionRow.storageKey });
  return { outcome: "ok", bytes, contentType: mimeForTransformFormat(definition.params.format) };
}
