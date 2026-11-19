/**
 * @file Atomic media writes and the versioned in-memory adapter.
 * A read/compare followed by save can race across blob I/O; compare-and-set keeps
 * the version predicate and write together. This extends the replacement port
 * without widening the plain media repository contract.
 */
import type { UUID } from "@jini-ai/core/primitives";
import { MediaConflictError, type AssetRenditionRecord, type MediaRecord } from "./types.js";
import { mediaFileReplacementRecord, type MediaFileReplacementRepoPort, type MediaFileReplacementInput } from "./replace-media-file.js";
import { preserveMediaCreator } from "./created-by.js";
import { InMemoryAssetRenditionRepo } from "./repo.memory.js";

/** Atomic compare-and-set and create-only writes for media import/apply. */
export interface VersionedMediaRepoPort extends MediaFileReplacementRepoPort {
  /**
   * Compare-and-set: writes `record` over the existing row ONLY while it is still at `ifVersion`
   * (workspace + id + version compared and written in ONE atomic step — never a separate
   * `findById()` read followed by a separate `save()` write, since that pair is exactly the race
   * this method exists to close).
   *
   * @returns `{ applied: true }` when the row was at `ifVersion` and now holds `record`;
   * `{ applied: false }` when the row was missing or at a different version — nothing was written.
   */
  saveIfVersion(required: { record: MediaRecord; ifVersion: number }): Promise<{ applied: boolean }>;
  /**
   * Create-only write: inserts `record` iff no row currently holds `record.id` (the primary key is
   * global, not per-workspace — mirrors `MediaRepoPort.save`'s own id-only lookup).
   *
   * @returns `{ applied: true }` when this call created the row; `{ applied: false }` when the id
   * was already taken — nothing was written. A slug collision is a different refusal and still
   * throws `MediaConflictError`, the same as `save`.
   */
  insertIfAbsent(record: MediaRecord): Promise<{ applied: boolean }>;
  /**
   * Every slug `mediaId` has ever retired (persistent public references): a slug it once held and then
   * renamed away from. `save`/`saveIfVersion`/`insertIfAbsent` all move an asset's PRIOR slug in
   * here the moment a rename lands, and `findBySlug` falls back to this list — so a `/m/<old-
   * slug>/...` URL already baked into rendered HTML, a cached `og:image`, or a hand-typed marker
   * keeps resolving forever, and a different asset can never claim a name still listed here (see
   * `MediaConflictError` on the write methods above). `remove()` drops an asset's rows here too,
   * which is what frees a retired name back up.
   *
   * @returns retired slugs in no particular order; empty when `mediaId` has never renamed.
   */
  listRetiredSlugs(required: { workspaceId: UUID; mediaId: UUID }): Promise<string[]>;
}

/**
 * Versioned in-memory adapter with retired-slug reads and source-conditional rendition writes.
 * It stays separate from the plain memory adapter because renames change its read/write contract.
 * Like the plain adapter, it does not enforce live-slug uniqueness; durable adapters own that
 * constraint. Retired names remain reserved until the owning asset reclaims or removes them.
 */
export class InMemoryVersionedMediaRepo implements VersionedMediaRepoPort {
  private rows: MediaRecord[];
  /** One row per retired slug (persistent public references) — see {@link VersionedMediaRepoPort.listRetiredSlugs}'s
   *  own doc. Mirrors the durable repository's `retired-slug history` table shape exactly (same
   *  `(workspaceId, slug)` uniqueness the real UNIQUE index enforces on the sqlite adapter — kept
   *  here as a runtime invariant of {@link retireSlug}/{@link reclaimOwnSlug} rather than a schema
   *  constraint, since this adapter has none). */
  private retired: Array<{ workspaceId: UUID; slug: string; mediaId: UUID; retiredAt: string }>;

  private readonly renditionRepo: InMemoryAssetRenditionRepo;

  constructor(_required: Record<string, never>, { initialRows = [], renditionRepo = new InMemoryAssetRenditionRepo({}) }: { initialRows?: MediaRecord[]; renditionRepo?: InMemoryAssetRenditionRepo } = {}) {
    this.renditionRepo = renditionRepo;
    this.rows = [...initialRows];
    this.retired = [];
  }

  async findById(required: { workspaceId: UUID; id: UUID }): Promise<MediaRecord | null> {
    return this.rows.find((row) => row.workspaceId === required.workspaceId && row.id === required.id) ?? null;
  }

  /** Falls back to {@link retired} when no LIVE row currently holds `slug` — see this class's file
   *  header for why a retired slug must keep resolving. */
  async findBySlug(required: { workspaceId: UUID; slug: string }): Promise<MediaRecord | null> {
    const live = this.rows.find((row) => row.workspaceId === required.workspaceId && row.slug === required.slug);
    if (live) return live;
    const retired = this.retired.find((row) => row.workspaceId === required.workspaceId && row.slug === required.slug);
    if (!retired) return null;
    return this.rows.find((row) => row.workspaceId === required.workspaceId && row.id === retired.mediaId) ?? null;
  }

  async list(required: { workspaceId: UUID }): Promise<MediaRecord[]> {
    return this.rows.filter((row) => row.workspaceId === required.workspaceId);
  }

  /** Reclaiming its own old slug removes it from {@link retired} (an asset may take back its
   *  own old slug). A DIFFERENT asset's claim on a slug still in {@link retired} throws
   *  `MediaConflictError`, same as a live-row collision. */
  private reclaimOwnSlug({ workspaceId, mediaId, slug }: { workspaceId: UUID; mediaId: UUID; slug: string }, _options = {}): void {
    const claimant = this.retired.find((row) => row.workspaceId === workspaceId && row.slug === slug);
    if (!claimant) return;
    if (claimant.mediaId !== mediaId) {
      throw new MediaConflictError({ message: `slug '${slug}' is already used by another media asset in this workspace` });
    }
    this.retired = this.retired.filter((row) => row !== claimant);
  }

  /** Moves `oldSlug` into {@link retired} for `mediaId`, unless the rename is a no-op or there was
   *  no prior slug (a brand-new row). */
  private retireSlug({ workspaceId, mediaId, oldSlug, newSlug, retiredAt }: { workspaceId: UUID; mediaId: UUID; oldSlug: string | null | undefined; newSlug: string; retiredAt: string }, _options = {}): void {
    if (!oldSlug || oldSlug === newSlug) return;
    this.retired.push({ workspaceId, slug: oldSlug, mediaId, retiredAt });
  }

  async save(record: MediaRecord): Promise<void> {
    const index = this.rows.findIndex((row) => row.id === record.id);
    this.reclaimOwnSlug({ workspaceId: record.workspaceId, mediaId: record.id, slug: record.slug });
    const original = this.rows[index];
    const priorSlug = original === undefined ? null : original.slug;
    if (original === undefined) {
      this.rows.push(record);
    } else {
      this.rows[index] = preserveMediaCreator({ record, original });
    }
    this.retireSlug({ workspaceId: record.workspaceId, mediaId: record.id, oldSlug: priorSlug, newSlug: record.slug, retiredAt: record.updatedAt });
  }

  async remove(required: { workspaceId: UUID; id: UUID }): Promise<void> {
    this.rows = this.rows.filter((row) => !(row.workspaceId === required.workspaceId && row.id === required.id));
    this.retired = this.retired.filter((row) => !(row.workspaceId === required.workspaceId && row.mediaId === required.id));
  }

  async listRetiredSlugs(required: { workspaceId: UUID; mediaId: UUID }): Promise<string[]> {
    return this.retired
      .filter((row) => row.workspaceId === required.workspaceId && row.mediaId === required.mediaId)
      .map((row) => row.slug);
  }

  /**
   * No `await` anywhere in this body — that is what makes it atomic with respect to any other
   * caller of this same in-process adapter: JS never preempts a synchronous run between the
   * `findIndex` compare and the write, so no other call can interleave between them the way two
   * separate `findById()`/`save()` calls could.
   *
   * @complexity O(n) in this workspace's row count — a linear scan, the same cost `findById` already
   * pays for this adapter.
   */
  async saveIfVersion(required: { record: MediaRecord; ifVersion: number }): Promise<{ applied: boolean }> {
    const { record, ifVersion } = required;
    const index = this.rows.findIndex((row) => row.workspaceId === record.workspaceId && row.id === record.id);
    const original = this.rows[index];
    if (original === undefined || original.version !== ifVersion) return { applied: false };
    this.reclaimOwnSlug({ workspaceId: record.workspaceId, mediaId: record.id, slug: record.slug });
    const priorSlug = original.slug;
    this.rows[index] = preserveMediaCreator({ record, original });
    this.retireSlug({ workspaceId: record.workspaceId, mediaId: record.id, oldSlug: priorSlug, newSlug: record.slug, retiredAt: record.updatedAt });
    return { applied: true };
  }

  /** No `await` in this body — see {@link saveIfVersion}'s doc for why that is what makes it atomic. */
  async insertIfAbsent(record: MediaRecord): Promise<{ applied: boolean }> {
    if (this.rows.some((row) => row.id === record.id)) return { applied: false };
    this.reclaimOwnSlug({ workspaceId: record.workspaceId, mediaId: record.id, slug: record.slug });
    this.rows.push(record);
    return { applied: true };
  }

  /** Saves to the shared memory rendition table only while its active source still matches.
   * The concrete memory adapter mutates synchronously: no await separates compare and persistence.
   * @returns A refused compare leaves the rendition table unchanged.
   * @complexity O(m + r) time for media and rendition rows; O(1) auxiliary space, no I/O. */
  async saveRenditionIfSource({ record, sourceSha256 }: { record: AssetRenditionRecord; sourceSha256: string },
    _options = {}): Promise<{ applied: boolean }> {
    const current = this.rows.find(row => row.workspaceId === record.workspaceId && row.id === record.assetId);
    if (!current || current.status !== "active" || current.source.sha256 !== sourceSha256) return { applied: false };
    await this.renditionRepo.save(record);
    return { applied: true };
  }

  /** In-process source CAS for publish tests. Durable rendition/type atomicity is covered by the
   * SQL adapter contracts; source replacement in this adapter remains a row-only fake.
   * @complexity O(n) rows, as with saveIfVersion; no await between compare and switch. */
  async replaceFileIfVersion(input: MediaFileReplacementInput, _options = {}): Promise<{ applied: boolean }> {
    const current = this.rows.find(row => row.workspaceId === input.workspaceId && row.id === input.id);
    if (!current || (!input.restore && current.status !== "active") || current.kind === "document") return { applied: false };
    const record = mediaFileReplacementRecord({ media: current, input });
    return this.saveIfVersion({ record, ifVersion: input.ifVersion });
  }
}
