/**
 * @file In-memory adapters for the `media` library's three record types
 * (ADR-027 §2): the bespoke `MediaRecord` table (see `types.ts` file header
 * for why it's bespoke rather than riding a not-yet-implemented generic
 * entries model) and the two core-owned sidecars, `asset_blobs` and
 * `asset_renditions`.
 *
 * Architectural role:
 * Adapters only — dumb collections scoped by `workspaceId` (ADR-007). No
 * validation or business rules live here (that's `media-service.ts`'s job).
 */
import type { UUID } from "../core/ports.js";
import type {
  AssetBlobRepoPort,
  AssetRenditionRepoPort,
  BlobGcJournalRepoPort,
  MediaRepoPort,
  TransformDefinitionRepoPort,
} from "./ports.js";
import type { AssetBlobRecord, AssetRenditionRecord, BlobGcJournalEntry, MediaRecord } from "./types.js";
import type { TransformDefinitionRecord } from "./transform-types.js";

export class InMemoryMediaRepo implements MediaRepoPort {
  private rows: MediaRecord[];

  constructor(initialRows: MediaRecord[] = []) {
    this.rows = [...initialRows];
  }

  async findById(required: { workspaceId: UUID; id: UUID }): Promise<MediaRecord | null> {
    return (
      this.rows.find(
        (row) => row.workspaceId === required.workspaceId && row.id === required.id
      ) ?? null
    );
  }

  async list(required: { workspaceId: UUID }): Promise<MediaRecord[]> {
    return this.rows.filter((row) => row.workspaceId === required.workspaceId);
  }

  async save(record: MediaRecord): Promise<void> {
    const index = this.rows.findIndex((row) => row.id === record.id);
    if (index === -1) {
      this.rows.push(record);
      return;
    }
    this.rows[index] = record;
  }

  async remove(required: { workspaceId: UUID; id: UUID }): Promise<void> {
    this.rows = this.rows.filter(
      (row) => !(row.workspaceId === required.workspaceId && row.id === required.id)
    );
  }
}

export class InMemoryAssetBlobRepo implements AssetBlobRepoPort {
  private rows: AssetBlobRecord[];

  constructor(initialRows: AssetBlobRecord[] = []) {
    this.rows = [...initialRows];
  }

  async findByHash(required: { workspaceId: UUID; sha256: string }): Promise<AssetBlobRecord | null> {
    return (
      this.rows.find(
        (row) => row.workspaceId === required.workspaceId && row.sha256 === required.sha256
      ) ?? null
    );
  }

  async list(required: { workspaceId: UUID }): Promise<AssetBlobRecord[]> {
    return this.rows.filter((row) => row.workspaceId === required.workspaceId);
  }

  async save(record: AssetBlobRecord): Promise<void> {
    const index = this.rows.findIndex(
      (row) => row.workspaceId === record.workspaceId && row.sha256 === record.sha256
    );
    if (index === -1) {
      this.rows.push(record);
      return;
    }
    this.rows[index] = record;
  }

  async remove(required: { workspaceId: UUID; sha256: string }): Promise<void> {
    this.rows = this.rows.filter(
      (row) => !(row.workspaceId === required.workspaceId && row.sha256 === required.sha256)
    );
  }
}

export class InMemoryAssetRenditionRepo implements AssetRenditionRepoPort {
  private rows: AssetRenditionRecord[];

  constructor(initialRows: AssetRenditionRecord[] = []) {
    this.rows = [...initialRows];
  }

  async listByAsset(required: { workspaceId: UUID; assetId: UUID }): Promise<AssetRenditionRecord[]> {
    return this.rows.filter(
      (row) => row.workspaceId === required.workspaceId && row.assetId === required.assetId
    );
  }

  async findOne(required: {
    workspaceId: UUID;
    assetId: UUID;
    transformName: string;
    version: number;
  }): Promise<AssetRenditionRecord | null> {
    return (
      this.rows.find(
        (row) =>
          row.workspaceId === required.workspaceId &&
          row.assetId === required.assetId &&
          row.transformName === required.transformName &&
          row.version === required.version
      ) ?? null
    );
  }

  async save(record: AssetRenditionRecord): Promise<void> {
    const index = this.rows.findIndex((row) => row.id === record.id);
    if (index === -1) {
      this.rows.push(record);
      return;
    }
    this.rows[index] = record;
  }

  async removeByAsset(required: { workspaceId: UUID; assetId: UUID }): Promise<void> {
    this.rows = this.rows.filter(
      (row) => !(row.workspaceId === required.workspaceId && row.assetId === required.assetId)
    );
  }
}

/**
 * In-memory `blob_gc_journal` adapter (ADR-027 §5 INV-1 two-phase protocol —
 * see `blob-gc.ts`). Same disclosed limit as every other repo in this file:
 * rows do not survive a process restart, so a real crash between the
 * delete-pass and unlink-pass loses the journal entry in this build (a real
 * database-backed table would not).
 */
export class InMemoryBlobGcJournalRepo implements BlobGcJournalRepoPort {
  private rows: BlobGcJournalEntry[];

  constructor(initialRows: BlobGcJournalEntry[] = []) {
    this.rows = [...initialRows];
  }

  async save(entry: BlobGcJournalEntry): Promise<void> {
    const index = this.rows.findIndex((row) => row.id === entry.id);
    if (index === -1) {
      this.rows.push(entry);
      return;
    }
    this.rows[index] = entry;
  }

  async list(required: { workspaceId: UUID }): Promise<BlobGcJournalEntry[]> {
    return this.rows.filter((row) => row.workspaceId === required.workspaceId);
  }

  async remove(required: { workspaceId: UUID; id: UUID }): Promise<void> {
    this.rows = this.rows.filter(
      (row) => !(row.workspaceId === required.workspaceId && row.id === required.id)
    );
  }
}

/**
 * In-memory `transform_registry` adapter (ADR-027 §4). `insert` enforces the
 * append-only contract defensively at the adapter boundary: a duplicate
 * `(workspaceId, name, version)` throws rather than silently overwriting —
 * the immutability guarantee should never be reachable via this adapter, not
 * just conventionally honored by callers.
 */
export class InMemoryTransformDefinitionRepo implements TransformDefinitionRepoPort {
  private rows: TransformDefinitionRecord[];

  constructor(initialRows: TransformDefinitionRecord[] = []) {
    this.rows = [...initialRows];
  }

  async listByName(required: { workspaceId: UUID; name: string }): Promise<TransformDefinitionRecord[]> {
    return this.rows.filter(
      (row) => row.workspaceId === required.workspaceId && row.name === required.name
    );
  }

  async findByNameVersion(required: {
    workspaceId: UUID;
    name: string;
    version: number;
  }): Promise<TransformDefinitionRecord | null> {
    return (
      this.rows.find(
        (row) =>
          row.workspaceId === required.workspaceId &&
          row.name === required.name &&
          row.version === required.version
      ) ?? null
    );
  }

  async insert(record: TransformDefinitionRecord): Promise<void> {
    const clash = this.rows.some(
      (row) =>
        row.workspaceId === record.workspaceId &&
        row.name === record.name &&
        row.version === record.version
    );
    if (clash) {
      throw new Error(
        `transform_registry row (workspace=${record.workspaceId}, name=${record.name}, v${record.version}) ` +
          "already exists — append-only violation"
      );
    }
    this.rows.push(record);
  }
}
