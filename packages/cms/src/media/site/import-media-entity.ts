
import { MediaConflictError, MediaSourceImmutableError, resolveWriteOnceSource, replaceMediaFile, MediaValidationError, sniffContentType, MAX_DOCUMENT_BYTES as HOST_MAX_UPLOAD_BYTES } from "../index.js";
import type { AssetBlobRecord, AssetBlobRepoPort, BlobStorePort, MediaRecord, VersionedMediaRepoPort } from "../index.js";
import type { OutwardErrorMessage } from "../../admin-http/http/outward-error-message.js";

/** The reviewed source a replace-on-import may overwrite (publish-content's precheck refusal carries it). */
interface MediaSourceReplacement {
  readonly version: number;
  readonly sourceSha256: string;
}

/**
 * @file Task 12 of the publish-content (Publish Content) feature —
 * the host repo's `ADS-memory/reports/2026-09-18-publish-feature-implementation-plan.md` §4 task 12.
 *
 * ## The bug this file exists to prevent
 *
 * `uploadMedia` (`@jini-ai/cms/media`'s `media-service.ts`, composed with `UploadMediaInput`) has NO
 * `id` field on its input — it always mints a fresh id via `deps.idGen.newId()`. A post's `bodyJson`
 * references an embedded image BY id (`{type:"image", attrs:{assetId, transformName}}` —
 * the host's public doc renderer's (`doc-nodes.ts`) ref-image path). Importing media through the
 * ordinary `uploadMedia` path therefore uploads the bytes fine but breaks EVERY image embed in every
 * imported post: the post's `assetId` still points at the SOURCE system's id, which no longer
 * resolves to anything at the destination. The failure is silent — bytes intact, links dead.
 *
 * `importMediaEntity` below deliberately bypasses `uploadMedia` and composes
 * `BlobStorePort.putIfAbsent` + `AssetBlobRepoPort` + `MediaRepoPort.save(record)` directly, because
 * `MediaRepoPort.save(record: MediaRecord)` (unlike `UploadMediaInput`) takes a full record —
 * including `id` — and writes it verbatim. Do NOT "clean this up" back onto `uploadMedia`: that
 * would silently reintroduce the exact bug this file exists to prevent.
 *
 * ## Relationship to the host's media-import feature
 *
 * The host's media-import feature is a DIFFERENT, unrelated concern: it fetches a brand-new image from an
 * external URL (an agent tool) and deliberately DOES go through `uploadMedia`, because minting a
 * fresh id is correct there — there is no pre-existing id to preserve; the image has never existed
 * in this system before. This file is the opposite case: the asset already has an id somewhere else
 * (another host instance, an export bundle) and THAT id must survive the trip. Do not merge the two.
 *
 * ## Safety properties this function enforces itself (not merely assumed of its caller)
 *
 * Every precondition below is checked INSIDE this function, before any write — never left to a
 * caller's own `precheck()` pass, the same "don't trust the caller already checked" discipline
 * the host's publish-content `blob-put.ts` route already applies to the identical sha256 check. A caller that
 * skips `precheck()` (or gets it wrong) still cannot force a partial or unsafe write through here.
 *
 * 1. **Bytes must hash to the record's claimed `source.sha256`, checked BEFORE `putIfAbsent`.**
 *    `putIfAbsent` (`blob-store.fs.ts`/`blob-store.memory.ts`) does not verify this itself — it only
 *    uses the sha to derive the storage key (`blob-staging.ts`'s own header has the full trace).
 * 2. **A slug already held by a DIFFERENT id blocks the import — no write of any kind.** Checked
 *    before any blob or media write, so a slug collision never leaves a dangling blob with no media
 *    row pointing at it.
 * 3. **`source.sha256` is write-once**, enforced by reusing the library's own
 *    `resolveWriteOnceSource` rather than re-deriving the same rule a second time. An explicit
 *    server-confirmed replacement instead uses Jini's atomic replacement operation, so metadata,
 *    type and renditions cannot be left describing the old bytes.
 *    Re-importing the same id with a DIFFERENT claimed sha256 is blocked; the SAME sha256 is an
 *    idempotent no-op re-save (title/slug/etc. may still legitimately change on a re-import).
 * 4. **An existing `asset_blobs` row's `createdByPrincipal` is never re-stamped.** `AssetBlobRepoPort
 *    .save` is a wholesale upsert keyed on `(workspaceId, sha256)` (verified against
 *    `InMemoryAssetBlobRepo`/the SQLite adapter) — calling it unconditionally on every import would
 *    silently overwrite an existing blob's original attribution with the importing operator's every
 *    time a second media row happens to dedup onto the same bytes. This function calls
 *    `assetBlobRepo.save` ONLY when `findByHash` finds nothing.
 * 5. **The media row write is a compare-and-set on {@link ImportMediaEntityInput.baseVersion}, not a
 *    blind `save()`.** `publish-content.ts`'s own Guard 1 compares a version read several `await`s
 *    (real blob-store I/O) before this command's write — two concurrent importers can both pass that
 *    compare and, before this fix, both land a `mediaRepo.save()` unconditionally, silently erasing
 *    whichever wrote second. `baseVersion` travels the compare INTO the write: `null` calls
 *    `VersionedMediaRepoPort.insertIfAbsent`, a number calls `saveIfVersion({ifVersion: baseVersion})`,
 *    and either miss comes back as `{status: "conflict"}` rather than a silent last-write-wins.
 */

/** Dependencies `importMediaEntity` needs, bound by a composition root. Named to match this
 *  codebase's `PublishContentDeps`/`UploadMediaDeps` field naming exactly, so a future caller
 *  threading real deps through (e.g. the host's media `publish-content.ts` `apply()`) has nothing to
 *  rename. */
export interface ImportMediaEntityDeps {
  readonly mediaRepo: VersionedMediaRepoPort;
  readonly assetBlobRepo: AssetBlobRepoPort;
  readonly blobStore: BlobStorePort;
  readonly clock: { nowIso(): string };
  /** Consulted ONLY for a brand-new `asset_blobs` row's own `id` — never for the media row's id,
   *  which always comes from {@link ImportMediaEntityInput.record} verbatim (this file's whole
   *  point). */
  readonly idGen: { newId(): string };
  /** The staged-bytes digest rule. The host binds the publish transfer's own `isValidSha256Hex` /
   *  `bytesMatchSha256`, so the import and the transfer agree on one sha256 rule while this media
   *  module never reaches into the publish domain. */
  readonly sha256: {
    isValidSha256Hex(required: { value: string }): boolean;
    bytesMatchSha256(required: { bytes: Uint8Array; claimedSha256: string }): boolean;
  };
  /** Words a classified media error (write-once source, validation, slug conflict) for a refusal's
   *  `reason`. This module keeps the classification (status, code); the host decides what a caller
   *  may read, so stored error text never leaves engine code raw. */
  readonly outwardErrorMessage: OutwardErrorMessage;
}

export interface ImportMediaEntityInput {
  /** Server-verified report context; packed entity fields never supply this intent. */
  readonly sourceReplacement?: MediaSourceReplacement;
  readonly workspaceId: string;
  /**
   * The SOURCE system's own `MediaRecord`, `id` included — this is the row that lands at the
   * destination under the IDENTICAL id (see this file's header). `version`/`updatedAt` are ignored
   * (destination-local write bookkeeping, not portable content — same reasoning
   * `content-hash.ts`'s own `EXCLUDED_KEYS` doc gives for excluding the identical fields from
   * `post`'s content hash); this function computes its own.
   */
  readonly record: MediaRecord;
  /** Bytes supplied by an upload/import caller, or `null` when a publish apply could not load the
   *  pre-staged blob. This command owns the missing-blob decision as well as byte validation. */
  readonly bytes: Uint8Array | null;
  /**
   * Attribution for a FRESHLY WRITTEN `asset_blobs` row only — never applied when the blob already
   * exists at the destination (safety property 4 above). Typically the importing operator's
   * principal id, or the source blob's own recorded `createdByPrincipal` when the caller has one
   * available and wants to preserve it end to end; either is a legitimate value for a row that does
   * not exist yet, since "brand new at this destination" has no prior attribution to protect.
   */
  readonly blobCreatedByPrincipal: string;
  /**
   * The destination media row's version this import was decided against — `null` means the import
   * expects NO existing row (a fresh create). Required rather than optional, so no future caller can
   * skip the compare-and-set guard (safety property 5 above) by omitting it. `publish-content.ts`
   * passes `input.expectedVersion ?? null` — its own Guard 1 already compares the same basis, and
   * this field is what carries that same compare INTO the atomic write instead of leaving it
   * check-then-write.
   */
  readonly baseVersion: number | null;
}

/**
 * `imported` on success. `blocked` covers every refused precondition (malformed/mismatched sha256,
 * a slug collision, a write-once `source.sha256` violation) — one discriminant rather than one
 * error class per cause, mirroring `PublishContentHandler.precheck`'s own `string | null` shape
 * (a human-readable reason, not a thrown exception) for the same reason: every one of these is an
 * ORDINARY, expected outcome of importing real-world data (two sources that both picked the same
 * slug, a stale export bundle), not a programming error:
 */
export type ImportMediaEntityBlockedCode = "missing-blob" | "slug-taken" | "precondition";

export type ImportMediaEntityResult =
  | { readonly status: "imported"; readonly id: string; readonly blobWritten: boolean }
  | { readonly status: "blocked"; readonly code: ImportMediaEntityBlockedCode; readonly reason: string }
  /** The media row's `baseVersion` basis was superseded by a concurrent writer — either caught
   *  early (before any write) or discovered by a failed compare-and-set write. Never a partial
   *  write: nothing is left half-applied on this outcome, mirroring `blocked`'s own guarantee. */
  | { readonly status: "conflict"; readonly reason: string };

/**
 * Compares the caller's `baseVersion` claim against `current`'s real state. Returns `null` when
 * they agree (nothing to refuse: `baseVersion === null` with `current === null`, or
 * `current.version === baseVersion`). Otherwise returns exactly one of three messages, byte-
 * identical to the tails of `publish-content.ts`'s own Guard 1 conflict messages — the SAME words
 * describe the SAME condition whether Guard 1 catches it early (before any write is attempted) or
 * this function's caller catches it here (a concurrent writer won the race between Guard 1's read
 * and this command's own compare-and-set write).
 *
 * @complexity O(1).
 */
function describeVersionMismatch({ baseVersion, current }: { baseVersion: number | null; current: MediaRecord | null }, _optional: Record<string, never> = {}): string | null {
  if (baseVersion === null) {
    return current === null ? null : `expected no existing row, found version ${current.version}`;
  }
  if (current === null) return `expected version ${baseVersion}, but the row is gone`;
  return current.version === baseVersion ? null : `expected version ${baseVersion}, found version ${current.version}`;
}

/**
 * Performs the compare-and-set media write — `insertIfAbsent` when `baseVersion` is `null` (no row
 * expected), `saveIfVersion` otherwise (safety property 5) — and returns the refusal result when it
 * did not land, or `null` on a successful write.
 *
 * Two distinct misses are handled:
 * - **A version miss** (`applied: false`, no thrown error): a concurrent writer moved or removed the
 *   row between this command's precondition reads and this write. Re-reads to phrase the exact
 *   mismatch; if the id was raced onto a NEW row exactly at `baseVersion` in that same window
 *   (an ABA case `describeVersionMismatch` cannot see, since the re-read now again matches), falls
 *   back to a generic conflict message rather than silently reporting `null`/no mismatch.
 * - **A slug race** (`MediaConflictError` thrown by the repo's own unique index): a DIFFERENT id
 *   landed under this record's slug between the earlier `findBySlug` precondition read and this
 *   write. Re-reads the real holder and reports `blocked`/`slug-taken` — the same code the
 *   precondition check above reports, just discovered one step later.
 *
 * Pulled out of {@link importMediaEntity} to stay under this repo's complexity ceiling (memory
 * `complexity_ceiling_ten.md`).
 *
 * @complexity O(1) — one repo write, plus at most one re-read on either refusal path.
 */
async function writeMediaRowConditionally(
  { deps, row, baseVersion }: { deps: ImportMediaEntityDeps; row: MediaRecord; baseVersion: number | null },
  _optional: Record<string, never> = {}
): Promise<ImportMediaEntityResult | null> {
  let applied: boolean;
  try {
    const outcome =
      baseVersion === null
        ? await deps.mediaRepo.insertIfAbsent(row)
        : await deps.mediaRepo.saveIfVersion({ record: row, ifVersion: baseVersion });
    applied = outcome.applied;
  } catch (error) {
    if (!(error instanceof MediaConflictError)) throw error;
    const holder = await deps.mediaRepo.findBySlug({ workspaceId: row.workspaceId, slug: row.slug });
    return {
      status: "blocked",
      code: "slug-taken",
      reason: `slug '${row.slug}' is already held by a different media ('${holder?.id ?? "unknown"}')`,
    };
  }
  if (applied) return null;

  const current = await deps.mediaRepo.findById({ workspaceId: row.workspaceId, id: row.id });
  const reason =
    describeVersionMismatch({ baseVersion, current }) ??
    (baseVersion === null
      ? "expected no existing row, but the id is already in use"
      : `expected version ${baseVersion}, but a concurrent write landed first`);
  return { status: "conflict", reason };
}

type ImportRefusal = Exclude<ImportMediaEntityResult, { status: "imported" }>;

/**
 * The missing-blob decision, then safety property 1. Returns the bytes, now proven to match the
 * record's claim, or the refusal.
 *
 * @complexity O(bytes) for the one hash comparison.
 */
function checkedBytes({ record, bytes, sha256 }: { record: MediaRecord; bytes: Uint8Array | null; sha256: ImportMediaEntityDeps["sha256"] }, _options = {}): { bytes: Uint8Array } | ImportRefusal {
  if (typeof record.source?.sha256 !== "string") {
    return { status: "blocked", code: "precondition", reason: "missing or malformed media source" };
  }
  if (bytes === null) {
    return {
      status: "blocked",
      code: "missing-blob",
      reason: `required blob '${record.source.sha256}' was never received by this destination`,
    };
  }

  // Safety property 1 (sha256 shape + match) — checked first, before any repo read even, since a
  // malformed/mismatched claim makes every other check moot.
  if (!sha256.isValidSha256Hex({ value: record.source.sha256 })) {
    return { status: "blocked", code: "precondition", reason: `malformed source sha256 '${record.source.sha256}'` };
  }
  if (!sha256.bytesMatchSha256({ bytes, claimedSha256: record.source.sha256 })) {
    return {
      status: "blocked",
      code: "precondition",
      reason: `bytes do not hash to the claimed sha256 '${record.source.sha256}'`,
    };
  }
  return { bytes };
}

/**
 * Safety properties 5 (compare-and-set basis) then 2 (slug collision), both before any write.
 *
 * @complexity O(1).
 */
function basisRefusal(
  { record, baseVersion, existingById, slugHolder }: { record: MediaRecord; baseVersion: number | null; existingById: MediaRecord | null; slugHolder: MediaRecord | null },
  _options = {}
): ImportRefusal | null {
  // Safety property 5 (compare-and-set basis) — checked before the slug check, so a caller whose
  // basis is already stale gets `conflict` (this row changed on the destination) rather than a
  // `blocked`/`slug-taken` that describes a state the caller was never even importing against.
  const mismatch = describeVersionMismatch({ baseVersion, current: existingById });
  if (mismatch) return { status: "conflict", reason: mismatch };

  // Safety property 2 (slug collision) — before any write.
  if (slugHolder && slugHolder.id !== record.id) {
    return {
      status: "blocked",
      code: "slug-taken",
      reason: `slug '${record.slug}' is already held by a different media ('${slugHolder.id}')`,
    };
  }
  return null;
}

/**
 * Safety property 3 (write-once source.sha256) — reuses the library's own guard rather than
 * re-deriving it; see this file's header for why. Preserve the full source on creation and the
 * destination source on updates. Only the guard's own refusal becomes a result.
 *
 * @complexity O(1).
 */
function writeOnceSource(
  { record, existingById, outwardErrorMessage }: { record: MediaRecord; existingById: MediaRecord | null; outwardErrorMessage: OutwardErrorMessage },
  _options = {}
): { source: MediaRecord["source"] } | ImportRefusal {
  try {
    const checked = resolveWriteOnceSource({ existing: existingById?.source, requestedSha256: record.source.sha256 });
    // The guard owns hash immutability; the import must also retain hashed source metadata.
    // Existing provenance/MIME stays write-once, while a new row keeps the packed source intact.
    return { source: { ...(existingById?.source ?? record.source), ...checked } };
  } catch (error) {
    if (error instanceof MediaSourceImmutableError) {
      return { status: "blocked", code: "precondition", reason: outwardErrorMessage({ error }) };
    }
    throw error;
  }
}

/**
 * Safety property 4 (never re-stamp an existing blob's attribution) — `assetBlobRepo.save` is
 * reached only on the "no existing row" branch.
 *
 * @returns whether this call wrote the blob bytes and its `asset_blobs` row.
 * @complexity O(1) — one lookup, plus one store put and one row save for a new blob.
 */
async function ensureAssetBlob(
  { deps, input, bytes }: { deps: ImportMediaEntityDeps; input: ImportMediaEntityInput; bytes: Uint8Array },
  _options = {}
): Promise<boolean> {
  const { workspaceId, record } = input;
  const existingBlob = await deps.assetBlobRepo.findByHash({ workspaceId, sha256: record.source.sha256 });
  if (existingBlob) return false;
  const { storageKey } = await deps.blobStore.putIfAbsent({ workspaceId, sha256: record.source.sha256, bytes });
  const newBlob: AssetBlobRecord = {
    id: deps.idGen.newId(),
    workspaceId,
    sha256: record.source.sha256,
    storageKey,
    createdByPrincipal: input.blobCreatedByPrincipal,
    createdAt: deps.clock.nowIso(),
    status: "active",
  };
  await deps.assetBlobRepo.save(newBlob);
  return true;
}

/** The destination row: the SOURCE record under its own id, with destination-local bookkeeping. */
function importedRow(
  { deps, input, existingById, source }: { deps: ImportMediaEntityDeps; input: ImportMediaEntityInput; existingById: MediaRecord | null; source: MediaRecord["source"] },
  _options = {}
): MediaRecord {
  const { workspaceId, record, blobCreatedByPrincipal, baseVersion } = input;
  return {
    ...record,
    workspaceId,
    source,
    version: (baseVersion ?? 0) + 1,
    // createdAt is write-once, same convention `posts.createdByPrincipalId`/`createdAt` establish
    // (`platform/db/schema.sqlite.ts`) — an existing row keeps its own; a brand-new row takes the source's.
    createdAt: existingById?.createdAt ?? record.createdAt,
    // Destination creation belongs to the applying principal, never an untrusted source claim.
    // Updates retain the destination creator, including an honestly unknown legacy value.
    createdBy: existingById ? existingById.createdBy ?? null : blobCreatedByPrincipal,
    updatedAt: deps.clock.nowIso(),
  };
}

/**
 * Imports one media entity, preserving its source `id`. See this file's header for the full safety
 * case and the bug this exists to prevent.
 *
 * @complexity O(1) — a fixed, small number of repo/store calls; no iteration over caller-controlled
 *   collections.
 */
export async function importMediaEntity(required: {
  readonly deps: ImportMediaEntityDeps;
  readonly input: ImportMediaEntityInput;
}): Promise<ImportMediaEntityResult> {
  const { deps, input } = required;
  const { workspaceId, record, baseVersion } = input;

  const checked = checkedBytes({ record, bytes: input.bytes, sha256: deps.sha256 });
  if (!("bytes" in checked)) return checked;

  const [existingById, slugHolder] = await Promise.all([
    deps.mediaRepo.findById({ workspaceId, id: record.id }),
    // Media's `slug` is nullable/optional in practice (pre-backfill rows), unlike `post`'s — an
    // empty slug has nothing to collide on, so it skips this check entirely rather than blocking
    // (contrast the host's post `publish-content.ts` `precheck`, where an empty slug DOES block,
    // because `post.slug` is `NOT NULL` and always meaningful there).
    record.slug ? deps.mediaRepo.findBySlug({ workspaceId, slug: record.slug }) : Promise.resolve(null),
  ]);

  const basisProblem = basisRefusal({ record, baseVersion, existingById, slugHolder });
  if (basisProblem) return basisProblem;

  if (input.sourceReplacement) {
    return replaceImportedMedia({ deps, input, existing: existingById, bytes: checked.bytes });
  }

  const resolved = writeOnceSource({ record, existingById, outwardErrorMessage: deps.outwardErrorMessage });
  if (!("source" in resolved)) return resolved;

  const blobWritten = await ensureAssetBlob({ deps, input, bytes: checked.bytes });
  const row = importedRow({ deps, input, existingById, source: resolved.source });

  // Safety property 5 (compare-and-set write) — the version compare traveled INTO this write via
  // `baseVersion`; see this function's own header and `writeMediaRowConditionally`'s doc.
  const refusal = await writeMediaRowConditionally({ deps, row, baseVersion });
  if (refusal) return refusal;

  return { status: "imported", id: record.id, blobWritten };
}

/** Replace only the source/version reviewed on live. Byte and slug checks already ran above.
 * @returns A typed refusal or imported result. Storage failures propagate to the command gateway.
 * @complexity O(B) for B bounded bytes; fixed indexed repo I/O, no collection reads. */
async function replaceImportedMedia({ deps, input, existing, bytes }: {
  deps: ImportMediaEntityDeps; input: ImportMediaEntityInput; existing: MediaRecord | null; bytes: Uint8Array;
}, _options = {}): Promise<ImportMediaEntityResult> {
  const reviewed = input.sourceReplacement;
  if (reviewed === undefined) throw new Error("Media replacement has no reviewed source");
  if (!existing || existing.version !== reviewed.version || existing.source.sha256 !== reviewed.sourceSha256) {
    return { status: "conflict", reason: "The live file changed after review. Plan publishing again and review Overwrite on live." };
  }
  if (!deps.mediaRepo.replaceFileIfVersion) {
    return { status: "blocked", code: "precondition", reason: "This destination cannot replace media files atomically. Update the live site and plan publishing again." };
  }
  const blobWritten = (await deps.assetBlobRepo.findByHash({ workspaceId: input.workspaceId, sha256: input.record.source.sha256 })) === null;
  try {
    const saved = await replaceMediaFile({ deps: { ...deps, workspaceId: input.workspaceId,
      clock: { nowMs: () => Date.parse(deps.clock.nowIso()) } },
      media: existing, bytes, contentType: sniffContentType({ bytes }), principalId: input.blobCreatedByPrincipal,
      provenance: input.record.source.provenance, expectedSha256: input.record.source.sha256,
      metadata: input.record }, { maxUploadBytes: HOST_MAX_UPLOAD_BYTES });
    return saved ? { status: "imported", id: existing.id, blobWritten }
      : { status: "conflict", reason: "The live file changed during replacement. Plan publishing again." };
  } catch (error) {
    return importedMediaReplacementError({ error, outwardErrorMessage: deps.outwardErrorMessage });
  }
}

/** Classifies a replacement failure; the host's outward port words the refusal's reason.
 * @throws Any failure other than a validation or slug conflict, unchanged. @complexity O(1). */
function importedMediaReplacementError(
  { error, outwardErrorMessage }: { error: unknown; outwardErrorMessage: OutwardErrorMessage },
  _options = {}
): ImportMediaEntityResult {
  if (error instanceof MediaValidationError) return { status: "blocked", code: "precondition", reason: outwardErrorMessage({ error }) };
  if (error instanceof MediaConflictError) return { status: "blocked", code: "slug-taken", reason: outwardErrorMessage({ error }) };
  throw error;
}

/** A replacement rollback restores bytes through the same CAS/rendition transaction, never save().
 * @throws A competing edit refuses compensation rather than overwriting it.
 * @complexity O(1), two indexed reads and one atomic replacement on this failure-only path. */
export async function restoreImportedMedia({ deps, prior }: { deps: ImportMediaEntityDeps; prior: MediaRecord }, _options = {}): Promise<void> {
  const current = await deps.mediaRepo.findById({ workspaceId: prior.workspaceId, id: prior.id });
  if (!current || current.version !== prior.version + 1) {
    throw new Error(`Could not restore media '${prior.id}' after publishing failed. Restore the publish restore point; the live file changed.`);
  }
  const { applied } = current.source.sha256 === prior.source.sha256
    ? await deps.mediaRepo.saveIfVersion({ record: prior, ifVersion: current.version })
    : await restoreReplacedSource({ deps, prior, current });
  if (!applied) throw new Error(`Could not restore media '${prior.id}': the live file changed during rollback. Restore the publish restore point.`);
}

/** Prepare the prior blob and ask the same atomic source switch to compensate it.
 * @throws Missing bytes/capability leave the live row alone and name the restore action.
 * @complexity O(1), one indexed blob read and one source/rendition transaction. */
async function restoreReplacedSource({ deps, prior, current }: { deps: ImportMediaEntityDeps; prior: MediaRecord; current: MediaRecord }, _options = {}): Promise<{ applied: boolean }> {
  const blob = await deps.assetBlobRepo.findByHash({ workspaceId: prior.workspaceId, sha256: prior.source.sha256 });
  if (!blob || !deps.mediaRepo.replaceFileIfVersion) {
    throw new Error(`Could not restore media '${prior.id}' after publishing failed. Restore the publish restore point; the live file changed or its original blob is unavailable.`);
  }
  return deps.mediaRepo.replaceFileIfVersion({ workspaceId: prior.workspaceId, id: prior.id,
    ifVersion: current.version, sha256: prior.source.sha256, storageKey: blob.storageKey,
    originalRenditionId: deps.idGen.newId(), updatedAt: prior.updatedAt,
    metadata: prior, restore: { version: prior.version, updatedAt: prior.updatedAt, source: prior.source } });
}
