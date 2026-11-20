import { nowIso, type Clock } from "@jini-ai/core/primitives";
/**
 * @file Task 6 of the publish-content (Publish Content) feature —
 * `ADS-memory/reports/2026-09-18-publish-feature-implementation-plan.md` §2 (`publish_content_
 * bundles`) / §4 task 6.
 *
 * A received bundle (Task 4's export envelope: `{hashVersion, sourceLabel, entities, blobManifest}`)
 * is staged here, between the peer's push/pull and Task 7's gated `plan()`/`execute()`, so the plan
 * hash has a stable input and large media bytes upload exactly once (schema doc, `platform/db/
 * schema.sqlite.ts`'s `publishContentBundles`). Bytes are NOT stored here — see `blob-staging.ts`.
 *
 * `expiresAt` is ALWAYS computed here, server-side, from `receivedAt` + a fixed TTL — never accepted
 * from the caller. A client-controlled expiry would let a peer stage a bundle that never expires
 * (plan §5 risk #13: "a staged bundle accumulating unbounded").
 *
 * **Deviation from the plan's draft schema (disclosed):** plan §2's `publish_content_bundles`
 * draft included a `sourceLabel`/label-style column; the migration Task 3 actually landed
 * (`platform/db/schema.sqlite.ts`'s `publishContentBundles`, migration `0066`) has NO such column — only
 * `id`/`workspaceId`/`sourcePrincipalId`/`hashVersion`/`entitiesJson`/`blobManifestJson`/`sizeBytes`/
 * `receivedAt`/`expiresAt`. This module accepts an optional `sourceLabel` on {@link StageBundleInput}
 * (the export envelope carries one) but does NOT persist it — it is display-only and, per
 * `publishContentRuns.peerLabel`'s own doc, "never used in any comparison or trust decision", so
 * dropping it here costs nothing safety-relevant. Task 7's `planImport` already treats
 * `PublishContentBundle.sourceLabel` as optional. Not fixed by editing the migration: out of this task's
 * scope (already-landed schema/migration files) — flagged in this task's handoff instead.
 *
 * ## Why "past `expiresAt`" is a REPO-level concept, not just an HTTP one
 *
 * Task 6 ships no HTTP route that reads a staged bundle back (that is Task 7's `plan()` — plan
 * §4's own task table has Task 7 depend on Task 6, not the reverse). {@link loadActiveBundle} is
 * still built and tested here, not deferred to Task 7, for the same reason `isRedeemable` lives in
 * `token.ts` next to `mintToken` rather than in the gateway that later calls it: the expiry rule is
 * a property of the bundle's own lifecycle, directly testable against an in-memory repo without any
 * gated-mutation machinery, and Task 7 must get it for free rather than re-deriving the same
 * boundary check against the same column a second time.
 */

/** One staged bundle row — the in-process shape `PublishContentBundleRepoPort` reads/writes.
 *  Mirrors `publishContentBundles` (`platform/db/schema.sqlite.ts`) field-for-field; `sourceLabel` is
 *  `string | null` here (not `string | undefined`) to match Drizzle's own nullable-column convention
 *  used throughout this codebase's other repo record shapes (e.g. `PublishHistoryEntry`'s optional
 *  fields via `row.x !== null`). */
export interface StagedBundleRecord {
  readonly id: string;
  readonly workspaceId: string;
  /** The AUTHENTICATED principal who pushed/staged this bundle — never a bundle-declared identity.
   *  Mirrors `publish_content_baselines.peerPrincipalId`'s own rule (plan §1.6 / §5 risk #9): a
   *  self-declared identity is never trusted as a storage key. */
  readonly sourcePrincipalId: string;
  readonly artifactFormatVersion: number;
  readonly hashVersion: number;
  /** Raw JSON text of the bundle's `entities[]` — decoded and validated by Task 7's `planImport`,
   *  never by this module (this file never inspects an entity's shape). */
  readonly entitiesJson: string;
  /** Raw JSON text of the bundle's `blobManifest[]` (sha256 list). */
  readonly blobManifestJson: string;
  readonly sizeBytes: number;
  readonly receivedAt: string;
  readonly expiresAt: string;
}

export interface PublishContentBundleRepoPort {
  save(required: { record: StagedBundleRecord }, optional?: {}): Promise<void>;
  findById(input: { workspaceId: string; id: string }, optional?: {}): Promise<StagedBundleRecord | null>;
  /** Deletes rows whose expiry is strictly before `expiredBefore` and returns the number removed. */
  deleteExpired(input: { expiredBefore: string }, optional?: {}): Promise<number>;
}

/**
 * Hard TTL for a staged bundle (plan §5 risk #13). 24 hours: long enough to cover an operator
 * staging a bundle, stepping away, and coming back to confirm/execute the same business day, short
 * enough that an abandoned push/pull does not accumulate unbounded staged rows — a real cost only
 * for `blobManifestJson`/`entitiesJson` text on this row (blob bytes are ordinary content-addressed
 * objects, left to the existing blob GC per the schema's own doc). Disclosed, adjustable constant —
 * not derived from any measured production workload.
 */
export const PUBLISH_CONTENT_BUNDLE_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Body-size ceiling for `POST .../publish-content/bundles`, mirroring `rejectOversizedJsonBody`'s
 * use at `routes/posts/create.ts:64` (plan §5 risk #13's own words) — a bundle's `entities[]` is
 * metadata only (blob bytes travel through `blobs/:sha` instead), but an unbounded JSON body is
 * still an unbounded-memory request. 20 MiB comfortably covers this feature's own measured local
 * corpus (54 posts, ~1 KB average body — plan §6 item 7) with generous headroom, while staying under
 * the app's blanket 50 MiB `express.json()` ceiling (`server/runtime/composition/app.ts`).
 */
export const PUBLISH_CONTENT_BUNDLE_MAX_BODY_BYTES = 20 * 1024 * 1024;

/**
 * Computes a staged bundle's `expiresAt` from its `receivedAt`, exactly `ttlMs` later — same shape
 * as `contracts/core/gated-mutations/token.ts`'s `mintToken` deriving `expiresAt` from `createdAt`
 * (`new Date(new Date(x).getTime() + ms).toISOString()`), no jitter.
 *
 * @complexity O(1).
 */
export function computeBundleExpiry(required: { receivedAt: string; ttlMs?: number | undefined }, _optional = {}): string {
  const ttlMs = required.ttlMs ?? PUBLISH_CONTENT_BUNDLE_TTL_MS;
  return new Date(new Date(required.receivedAt).getTime() + ttlMs).toISOString();
}

/**
 * Whether `record` is still usable at instant `now` — boundary inclusive (`now <= expiresAt`),
 * mirroring `token.ts`'s `isRedeemable` boundary exactly. Pure; the one property this whole module
 * exists to hold (see file header).
 *
 * @complexity O(1).
 */
export function isBundleActive(required: { record: StagedBundleRecord; now: string }, _optional = {}): boolean {
  return new Date(required.now).getTime() <= new Date(required.record.expiresAt).getTime();
}

/** What a caller stages: the export envelope's own fields, plus who is pushing it and into which
 *  workspace — never `expiresAt` (see file header). `entities`/`blobManifest` are opaque arrays
 *  here (`readonly unknown[]` / `readonly string[]`): this module only serializes and stores them,
 *  it never inspects an entity's shape (that is `planImport`'s job, Task 7). */
export interface StageBundleInput {
  readonly workspaceId: string;
  readonly sourcePrincipalId: string;
  readonly artifactFormatVersion: number;
  readonly hashVersion: number;
  /** Display-only; carried on the export envelope but NOT persisted — see this file's header
   *  "Deviation from the plan's draft schema". Accepted here so a route need not special-case
   *  stripping it before calling this function. */
  readonly sourceLabel?: string;
  readonly entities: readonly unknown[];
  readonly blobManifest: readonly string[];
}

export interface StageBundleDeps {
  readonly repo: PublishContentBundleRepoPort;
  readonly clock: Clock;
  readonly idGen: { newId(): string };
  /** Test-only override of {@link PUBLISH_CONTENT_BUNDLE_TTL_MS} — absent in real composition. */
  readonly ttlMs?: number;
}

/**
 * Stages one received bundle: serializes `entities`/`blobManifest`, stamps `receivedAt`/`expiresAt`,
 * and persists it via `deps.repo`. Never validates entity shape or checks `hashVersion` against
 * `CONTENT_HASH_VERSION` — Task 7's `planImport` (already built, Task 5) owns both of those checks
 * and must run them regardless of whether this call already saw the bundle once, so duplicating
 * either check here would just be a second, driftable copy of the same rule.
 *
 * @complexity O(n) in `entities.length + blobManifest.length` (one `JSON.stringify` pass over each),
 * plus one repo write.
 */
export async function stageBundle(
  { input, deps }: {
    input: StageBundleInput;
    deps: StageBundleDeps;
  },
  _optional = {}
): Promise<{ bundleId: string; expiresAt: string }> {
  const receivedAt = nowIso({ clock: deps.clock });
  const entitiesJson = JSON.stringify(input.entities);
  const blobManifestJson = JSON.stringify(input.blobManifest);
  const expiresAt = computeBundleExpiry({ receivedAt, ttlMs: deps.ttlMs });

  const record: StagedBundleRecord = {
    id: deps.idGen.newId(),
    workspaceId: input.workspaceId,
    sourcePrincipalId: input.sourcePrincipalId,
    artifactFormatVersion: input.artifactFormatVersion,
    hashVersion: input.hashVersion,
    entitiesJson,
    blobManifestJson,
    sizeBytes: new TextEncoder().encode(entitiesJson).byteLength + new TextEncoder().encode(blobManifestJson).byteLength,
    receivedAt,
    expiresAt,
  };

  // Sweep before every append. If staging traffic continues, expired metadata cannot grow without
  // bound; if traffic stops, the table is finite and incurs no further growth. Strictly-before
  // matches `isBundleActive`'s inclusive boundary (`now === expiresAt` remains usable).
  await deps.repo.deleteExpired({ expiredBefore: receivedAt });
  await deps.repo.save({ record });
  return { bundleId: record.id, expiresAt };
}

/**
 * Loads a staged bundle, refusing (returning `null`) one that is not found OR whose TTL has passed
 * — the two cases are deliberately collapsed into one result, mirroring `token.ts`'s
 * `TokenExpiredError` doc: "an unrecognized token and a genuinely expired token... indistinguishable
 * (REQ-11)". Both mean the same actionable thing to a caller here: stage the bundle again.
 *
 * @complexity O(1) plus one repo read.
 */
export async function loadActiveBundle(
  required: { repo: PublishContentBundleRepoPort; workspaceId: string; id: string; now: string }, _optional = {}
): Promise<StagedBundleRecord | null> {
  const { repo, workspaceId, id, now } = required;
  const record = await repo.findById({ workspaceId, id });
  if (!record) return null;
  return isBundleActive({ record, now }) ? record : null;
}

/** In-process `PublishContentBundleRepoPort` — hermetic tests and any dev/test composition that
 *  has no real content DB. Mirrors `InMemoryTokenStore`'s shape (plain `Map`, defensive copies on
 *  read/write so a caller mutating a returned record can never corrupt this store's own state). */
export class InMemoryPublishContentBundleRepo implements PublishContentBundleRepoPort {
  private readonly recordsById = new Map<string, StagedBundleRecord>();

  async save({ record }: { record: StagedBundleRecord }): Promise<void> {
    this.recordsById.set(record.id, { ...record });
  }

  async findById(input: { workspaceId: string; id: string }): Promise<StagedBundleRecord | null> {
    const record = this.recordsById.get(input.id);
    if (!record || record.workspaceId !== input.workspaceId) return null;
    return { ...record };
  }

  async deleteExpired(input: { expiredBefore: string }): Promise<number> {
    const cutoff = new Date(input.expiredBefore).getTime();
    let deleted = 0;
    for (const [id, record] of this.recordsById) {
      if (new Date(record.expiresAt).getTime() >= cutoff) continue;
      this.recordsById.delete(id);
      deleted += 1;
    }
    return deleted;
  }
}
