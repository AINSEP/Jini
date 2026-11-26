import { createRepoPublishHandler, type FieldDisposition } from "@jini-ai/cms/publish/content/repo-handler";
import { PublishContentApplyRowError } from "@jini-ai/cms/publish/transfer";
import { collectMediaUrlKeys } from "@jini-ai/cms/publish/content/media-references";
import { bytesMatchSha256, isValidSha256Hex } from "@jini-ai/cms/publish/transfer/blob-staging";
import { nowIso as clockNowIso } from "@jini-ai/core/primitives";
import type { PublishContentContributor } from "@jini-ai/cms/publish/content/type-registry";
import type { CmsPublishPorts } from "@jini-ai/cms/publish/content/publish-ports";
import type { OverwritablePrecheckRefusal } from "@jini-ai/cms/publish/content/type-registry";

import { importMediaEntity, restoreImportedMedia, type ImportMediaEntityResult } from "@jini-ai/cms/media/site/import-media-entity";
import { computeBlobStorageKey, sniffContentType, isDocumentOnlyBlob } from "../index.js";
import { createHostBlobWriteBindings } from "./blob-write-bindings.js";
import type { MediaRecord } from "../index.js";
import { verifyPublishedMedia } from "@jini-ai/cms/media/site/verify-published-media";
import { orFallback } from "@jini-ai/core/errors/idioms";


/** The slice of the host's publish bag this file reads. The host registry (`features/publish-content/type-registry.ts`) is
 *  instantiated with the full product bag, which satisfies this slice, so this file names no other feature. */
type MediaBag = { media: CmsPublishPorts["media"] & {
  createBlobWriteBindings: typeof createHostBlobWriteBindings;
  uploadCaps: { maxUploadBytes: number; maxVideoUploadBytes?: number };
} };

/**
 * @file `media`'s publish-content contribution, built on `createRepoPublishHandler`
 * (`features/publish-content/repo-handler.ts`; M-MED of
 * `ADS-memory/.local-artifacts/plan-publish-all-types-2026-09-25.md`). A DATA export that imports only
 * `type-registry.ts`'s TYPES — see that file's header for the module cycle a value edge would reopen.
 * `dependsOn` is empty: media is a DEPENDENCY of `post`/`page`, never the reverse.
 *
 * ## Where the BYTES come from
 *
 * The destination's own `BlobStorePort`, at `computeBlobStorageKey({workspaceId, sha256})` — where the
 * blob pre-flight PUT (`routes/publish-content/blob-put.ts`) wrote them and where the planner's `hasBlob`
 * probe looks. `PackedEntity.state` is JSON-only, so bytes never travel on the entity. A sha this
 * destination never received is a reported, non-destructive block (`blocked:missing-blob`) that writes
 * nothing: precheck reports it before confirmation, and `importMediaEntity` refuses it at write time.
 *
 * ## Why `undo` (the command gateway)
 *
 * Media has no revision ledger and `asset_blobs` has none either, so the change set's inverse (the
 * verbatim pre-write `MediaRecord`) IS media's revert path. The blob half is safe by construction:
 * `importMediaEntity` writes a blob row only when `findByHash` finds none, so it is append-only and an
 * existing row's attribution is never overwritten (reported as `blobWritten`).
 *
 * ## Concurrency
 *
 * The factory's version check (on the `captureInverse` read) is an EARLY refusal that avoids fetching
 * bytes for a doomed import. The real guarantee is `importMediaEntity`'s `baseVersion`: an atomic
 * compare-and-set write (`VersionedMediaRepoPort.saveIfVersion`/`insertIfAbsent`), so a writer that
 * slips in during the blob I/O is still caught.
 *
 * ## Hash stability
 *
 * The hash retains the legacy whole-record input; `content-hash.ts` drops
 * `id`/`workspaceId`/`version`/`updatedAt` itself. The new `createdBy` is also excluded: the
 * destination stamps its own applying principal, so comparing creator IDs as content would make
 * an unchanged asset appear to drift after every publish. Legacy hashes remain byte-identical.
 * Packed state still includes known attribution for export, because `importMediaEntity` spreads
 * it into the destination row before preserving/stamping the destination's own creation actor.
 */

/** Machine-readable cause for a refused media apply. One discriminant rather than one error class
 *  per cause, mirroring `ImportMediaEntityResult`'s own `blocked` shape: every one of these is an
 *  ORDINARY, expected outcome of importing real-world data, not a programming error. */
export type MediaApplyBlockedCode = "blocked:missing-blob" | "blocked:slug-taken" | "blocked:precondition";

/**
 * A media entity that cannot be applied, for a reason that is data, not a fault. Thrown only after
 * every precondition check and BEFORE any write, so a blocked apply always leaves the destination
 * exactly as it found it — no blob row, no media row, no change set.
 *
 * Extends {@link PublishContentApplyRowError} with `rowOutcome: "blocked"`, so `apply-loop.ts`
 * downgrades THIS ONE report row and the rest of the run continues. One missing blob must never kill
 * a 200-entity publish. The message is used verbatim as the row's `reason`, which is why it is
 * phrased as a standalone operator-facing explanation.
 */
export class MediaApplyBlockedError extends PublishContentApplyRowError {
  readonly code: MediaApplyBlockedCode;

  constructor({ code, message }: { code: MediaApplyBlockedCode; message: string }) {
    super({ rowOutcome: "blocked", message });
    this.name = "MediaApplyBlockedError";
    this.code = code;
  }
}

/**
 * The destination moved on from the `expectedVersion` the apply loop planned against — media's
 * equivalent of `PostConflictError`, deliberately its own class rather than a reuse of `post`'s (a
 * shared base in `apply-errors.ts` is what the loop actually checks; see that file's header).
 * `rowOutcome: "conflict"`, so the row downgrades and the run continues. Thrown before any write.
 */
export class MediaApplyConflictError extends PublishContentApplyRowError {
  constructor({ message }: { message: string }) {
    super({ rowOutcome: "conflict", message });
    this.name = "MediaApplyConflictError";
  }
}

/** Every field travels, because `importMediaEntity` spreads the packed state into the destination row.
 *  The dispositions document intent only: the hash is `legacyHashState`'s. */
const MEDIA_FIELDS: Record<keyof MediaRecord, FieldDisposition> = {
  id: "provenance",
  kind: "local",
  originalFilename: "local",
  createdBy: "provenance",
  workspaceId: "provenance",
  title: "transferred",
  slug: "transferred",
  alt: "transferred",
  caption: "transferred",
  credit: "transferred",
  description: "transferred",
  source: "transferred",
  status: "transferred",
  createdAt: "provenance",
  updatedAt: "provenance",
  version: "provenance",
  width: "transferred",
  height: "transferred",
  cssClass: "transferred",
  htmlAttributes: "transferred",
  captions: "transferred",
};

const LIBRARY_DOCUMENT_REFUSAL = "Library documents cannot be published";

type MediaPorts = MediaBag["media"];

/** Changed bytes require explicit review even when live still matches its last baseline.
 * @returns An overwrite offer, a hard capability refusal, or no source change. No I/O.
 * @complexity O(1), compares the row already read by precheck. */
function sourceReplacementRefusal({ ports, existing, sha256 }: { ports: MediaPorts; existing: MediaRecord | null; sha256: string | undefined }, _options = {}): OverwritablePrecheckRefusal | string | null {
  if (!existing || !sha256 || existing.source.sha256 === sha256) return null;
  if (existing.source.private) return "Private submitted files cannot be replaced. Keep the submission file and upload a separate public media item.";
  if (existing.status !== "active") return "This file is in the live site's Trash. Restore it on live before replacing it.";
  if (!ports.repo.replaceFileIfVersion) return "This destination cannot replace media files atomically. Update the live site and plan publishing again.";
  return { reason: "This replaces the file on the live site. Tick Overwrite on live to publish it.",
    sourceReplacement: { version: existing.version, sourceSha256: existing.source.sha256 } };
}

/** A Library document by either signal: the packed discriminant or the destination row it would replace. */
function isLibraryDocument({ kind, existing }: { kind: unknown; existing?: MediaRecord | null }, _options = {}): boolean {
  return (kind !== undefined && kind !== "media") || existing?.kind === "document";
}

/**
 * Apply is a second trust boundary: a forged bundle or a destination changed after precheck
 * must not bypass Library isolation. Refuse before fetching any source bytes.
 */
async function assertPublishableMedia(
  { ports, workspaceId, state, existing }: { ports: MediaPorts; workspaceId: string; state: Record<string, unknown>; existing?: MediaRecord | null },
  _options = {}
): Promise<void> {
  if (isLibraryDocument({ kind: state.kind, existing })) {
    throw new MediaApplyBlockedError({ code: "blocked:precondition", message: LIBRARY_DOCUMENT_REFUSAL });
  }
  const record = state as unknown as MediaRecord; // this handler's own pack() produced it
  if (await isDocumentOnlyBlob({ deps: { mediaRepo: ports.repo, blobRepo: ports.assetBlobRepo }, input: { workspaceId, sha256: record.source?.sha256 ?? "" } })) {
    throw new MediaApplyBlockedError({ code: "blocked:precondition", message: LIBRARY_DOCUMENT_REFUSAL });
  }
}

/**
 * A blob key is built from the hash, so a forged one (`../../x`) would probe outside this
 * workspace's blob folder: every hash is shape-checked before any blob store call.
 * @returns The refusal, or null when every given hash is a sha256. @complexity O(b) required blobs.
 */
function malformedHashRefusal({ sourceSha256, requiredBlobs }: { sourceSha256: string | undefined; requiredBlobs: readonly string[] }, _options = {}): string | null {
  if (sourceSha256 && !isValidSha256Hex({ value: sourceSha256 })) return `malformed source sha256 '${sourceSha256}'`;
  const malformed = requiredBlobs.find(sha256 => !isValidSha256Hex({ value: sha256 }));
  return malformed === undefined ? null : `required blob '${malformed}' is not a sha256 hash`;
}

/** `null` carries a missing staged object into `importMediaEntity`, which owns that refusal. */
async function stagedBytes(
  { blobStore, workspaceId, record }: { blobStore: MediaPorts["blobStore"]; workspaceId: string; record: MediaRecord },
  _options = {}
): Promise<Uint8Array | null> {
  const storageKey = computeBlobStorageKey({ workspaceId, sha256: record.source?.sha256 ?? "" });
  return (await blobStore.exists({ storageKey })) ? await blobStore.get({ storageKey }) : null;
}

/** Maps an import refusal onto the row error `apply-loop.ts` downgrades; passes a success through. */
function importedOrThrow(
  { id, outcome }: { id: string; outcome: ImportMediaEntityResult },
  _options = {}
): Extract<ImportMediaEntityResult, { status: "imported" }> {
  if (outcome.status === "conflict") {
    throw new MediaApplyConflictError({ message: `media '${id}' changed on the destination during apply: ${outcome.reason}` });
  }
  if (outcome.status === "blocked") {
    throw new MediaApplyBlockedError({ code: `blocked:${outcome.code}`, message: `media '${id}' cannot be applied — ${outcome.reason}` });
  }
  return outcome;
}

const writePublishedMedia: Parameters<typeof createRepoPublishHandler<MediaRecord, MediaBag["media"], MediaBag>>[0]['write'] = async ({ ports, deps, workspaceId, id, state, existing, expectedVersion, principalId, sourceReplacement }) => {
      await assertPublishableMedia({ ports, workspaceId, state, existing });
      const { repo: mediaRepo, assetBlobRepo, blobStore, contentTypeStore } = ports;
      const record = state as unknown as MediaRecord; // this handler's own pack() produced it
      // Same shape check as `validate`, again here: apply must not trust that precheck ran.
      const sha256 = record.source?.sha256;
      if (sha256 && !isValidSha256Hex({ value: sha256 })) throw new MediaApplyBlockedError({ code: "blocked:precondition", message: `media '${id}' cannot be applied — malformed source sha256 '${sha256}'` });
      const bytes = await stagedBytes({ blobStore, workspaceId, record });
      const outcome = importedOrThrow({ id, outcome: await importMediaEntity({
        deps: { mediaRepo, assetBlobRepo, blobStore, ...ports.createBlobWriteBindings({ blobStore }), clock: { nowIso: () => clockNowIso({ clock: deps.clock }) }, idGen: deps.idGen,
          sha256: { isValidSha256Hex, bytesMatchSha256 }, outwardErrorMessage: ({ error }) => error.message, ...ports.uploadCaps },
        input: {
          workspaceId,
          record,
          bytes,
          // Only a brand-new blob row takes the importing operator; an existing one is never re-stamped.
          blobCreatedByPrincipal: principalId,
          baseVersion: expectedVersion ?? null,
          ...(sourceReplacement ? { sourceReplacement } : {}),
        },
      }) });
      // Every other write path (upload, import, duplicate) records the sniffed type; without it the
      // destination's embed resolver cannot tell a video from an image. Sniffed from the bytes just
      // imported, never carried from the source (the store's own invariant). `bytes` is non-null
      // here: `importMediaEntity` blocks a missing one.
      if (bytes && !sourceReplacement) await contentTypeStore.set({ workspaceId, sha256: record.source.sha256, contentType: sniffContentType({ bytes }) });
      const saved = await mediaRepo.findById({ workspaceId, id });
      // `blobWritten`: true when this import created the `asset_blobs` row, false when the bytes were
      // already there (a normal dedup, not a conflict). Passed through on `apply()`'s result.
      return { blobWritten: outcome.blobWritten, version: saved?.version };
    };
const validatePublishedMedia: Parameters<typeof createRepoPublishHandler<MediaRecord, MediaBag["media"], MediaBag>>[0]['validate'] = async ({ ports, workspaceId, entity, existing }) => {
      if (isLibraryDocument({ kind: entity.state.kind, existing })) return LIBRARY_DOCUMENT_REFUSAL;
      const source = entity.state.source as { sha256?: string } | undefined;
      const malformed = malformedHashRefusal({ sourceSha256: source?.sha256, requiredBlobs: entity.requiredBlobs });
      if (malformed) return malformed;
      if (source?.sha256 && await isDocumentOnlyBlob({ deps: { mediaRepo: ports.repo, blobRepo: ports.assetBlobRepo }, input: { workspaceId, sha256: source.sha256 } })) return LIBRARY_DOCUMENT_REFUSAL;
      for (const sha256 of entity.requiredBlobs) {
        if (!(await ports.blobStore.exists({ storageKey: computeBlobStorageKey({ workspaceId, sha256 }) }))) {
          return `required blob '${sha256}' is not available on this destination`;
        }
      }
      return sourceReplacementRefusal({ ports, existing, sha256: source?.sha256 });
    };

/** Called from a composition root (`server/runtime/composition/publish-content-manifest.ts`). */
export const contributeMediaPublish = (): PublishContentContributor<MediaBag> =>
  createRepoPublishHandler<MediaRecord, MediaBag["media"], MediaBag>({
    entityType: "media",
    // Operational sidecars are also media-owned; raw-row fallback must not export a private
    // document's slug history or original-rendition storage key after typed pack excluded it.
    coversTables: ["media", "asset_blobs", "asset_renditions", "media_slug_history"],
    // The same permission `post`/`page` declare; media has no write permission of its own.
    permission: "content.write",
    ports: ({ deps }, _optional = {}) => deps.ports.media,
    // Library sharing has its own private archive flow. Ordinary publishing never carries documents.
    include: ({ row }, _optional = {}) => row.kind !== "document",
    list: ({ ports: p, workspaceId }, _optional = {}) => p.repo.list({ workspaceId }),
    find: ({ ports: p, workspaceId, id }, _optional = {}) => p.repo.findById({ workspaceId, id }),
    fields: MEDIA_FIELDS,
    // Packed exactly as the row holds it: an absent field stays absent rather than becoming `null`.
    omitWhenAbsent: Object.keys(MEDIA_FIELDS),
    legacyHashState: ({ row }, _optional = {}) => {
      const { createdBy: _creator, kind: _kind, originalFilename: _filename, ...legacyState } = row;
      return legacyState;
    },
    requiredBlobs: ({ row }, _optional = {}) => [row.source.sha256],
    // Other media this item names by a `/m/{key}/` URL in its own `htmlAttributes` — a video's
    // `poster`, chiefly — travel with it, or the destination renders a poster URL that 404s.
    references: ({ entity }, _optional = {}) =>
      typeof entity.state.htmlAttributes === "string"
        ? [...collectMediaUrlKeys({ text: entity.state.htmlAttributes })].map((key) => ({ entityType: "media", key }))
        : [],
    // `media.slug` may be empty on pre-backfill rows; the factory skips an empty address.
    address: { field: "slug", holder: ({ ports: p, workspaceId, value: slug }, _optional = {}) => p.repo.findBySlug({ workspaceId, slug }) },
    // Also checked by the planner's `hasBlob` pass, but that depends on the caller wiring the probe;
    // media is the one type whose entity IS its blob.
    validate: validatePublishedMedia,
    write: writePublishedMedia,
    undo: {
      // An update restores the prior record verbatim; a create removes its row. The blob row and bytes
      // stay: they are append-only and content-addressed, and an orphan is reclaimable by GC.
      restore: ({ ctx: { ports, deps }, prior }, _optional = {}) => restoreImportedMedia({ deps: { mediaRepo: ports.repo,
        assetBlobRepo: ports.assetBlobRepo, blobStore: ports.blobStore, ...ports.createBlobWriteBindings({ blobStore: ports.blobStore }), idGen: deps.idGen,
        clock: { nowIso: () => clockNowIso({ clock: deps.clock }) }, sha256: { isValidSha256Hex, bytesMatchSha256 },
        outwardErrorMessage: ({ error }) => error.message }, prior }),
      remove: ({ ports, workspaceId, id }) => ports.repo.remove({ workspaceId, id }),
      summary: async ({ ports, workspaceId, id, state }) => {
        const sha256 = (state as unknown as MediaRecord).source?.sha256 ?? "";
        // Wording only; `blobWritten` reports what actually happened under a concurrent import.
        return (await ports.assetBlobRepo.findByHash({ workspaceId, sha256 })) !== null
          ? `Import media '${id}' via publish-content (existing blob ${sha256} reused; attribution preserved)`
          : `Import media '${id}' via publish-content (new blob ${sha256})`;
      },
    },
    conflictError: ({ message }, _optional = {}) => new MediaApplyConflictError({ message }),
    extend: ({ deps, ports }) => ({
      verifyApplied: async ({ entities }) => {
        const p = ports();
        return p ? verifyPublishedMedia({ ports: p, workspaceId: deps.workspaceId, entities, orFallback }) : [];
      },
    }),
  });
