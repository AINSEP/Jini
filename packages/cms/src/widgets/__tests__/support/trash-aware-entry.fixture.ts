import { InMemoryEntryRepo, EntrySlugConflictError, VersionConflictError } from "../../../entries/index.js";
import type { EntryRecord, EntrySaveOptions } from "../../../entries/index.js";

/** Test-only trash reads around the existing Jini entry repository; no collection-list behavior. */
export class TrashAwareInMemoryEntryRepo extends InMemoryEntryRepo {
  private readonly deleted = new Map<string, string>();
  override async findById(required: Parameters<InMemoryEntryRepo["findById"]>[0]): Promise<EntryRecord | null> {
    return this.deleted.has(required.id) ? null : super.findById(required);
  }
  override async findBySlug(required: Parameters<InMemoryEntryRepo["findBySlug"]>[0]): Promise<EntryRecord | null> {
    const row = await super.findBySlug(required);
    return row && !this.deleted.has(row.id) ? row : null;
  }
  override async listByWorkspace(required: Parameters<InMemoryEntryRepo["listByWorkspace"]>[0], optional: NonNullable<Parameters<InMemoryEntryRepo["listByWorkspace"]>[1]> = {}): Promise<EntryRecord[]> {
    const { limit, ...rest } = optional;
    const rows = (await super.listByWorkspace(required, rest)).filter((row) => !this.deleted.has(row.id));
    return typeof limit === "number" ? rows.slice(0, limit) : rows;
  }
  override async save(row: EntryRecord, options: EntrySaveOptions = {}): Promise<void> {
    if (this.deleted.has(row.id) && options.expectedVersion !== null) {
      if (options.expectedVersion === undefined) return;
      throw new VersionConflictError({ message: `expected version ${options.expectedVersion} for entry '${row.id}', found none` });
    }
    const holder = await super.findBySlug({ workspaceId: row.workspaceId, type: row.type, slug: row.slug });
    if (holder && holder.id !== row.id && this.deleted.has(holder.id)) {
      throw new EntrySlugConflictError({ message: `an entry with slug '${row.slug}' is in the Trash — restore it, or delete it permanently from the Trash, to reuse the slug` });
    }
    await super.save(row, options);
  }
  async findAnyById(required: Parameters<InMemoryEntryRepo["findById"]>[0]): Promise<(EntryRecord & { deletedAt: string | null }) | null> {
    const row = await super.findById(required);
    return row ? { ...row, deletedAt: this.deleted.get(row.id) ?? null } : null;
  }
  async saveAny(record: EntryRecord & { deletedAt: string | null }): Promise<void> {
    const { deletedAt, ...row } = record;
    await super.save(row);
    if (deletedAt === null) this.deleted.delete(row.id);
    else this.deleted.set(row.id, deletedAt);
  }
}
