import type { Insertable, Selectable, Kysely } from "kysely";

import type { StorageKernel } from "@jini-ai/core/contracts/storage";
import type { EntryRefsSqlRow, EntryRefsTables } from "./tables.js";
import type { UUID } from "@jini-ai/core/primitives";
// EntryRefsRepoPort is written only by the entries write chokepoint's extraction, in the same transaction.
import type { EntryRefRow, EntryRefsRepoPort } from "../ports.js";

type EntryRefSourceKind = EntryRefRow["sourceKind"];
type EntryRefTargetKind = EntryRefRow["targetKind"];

/**
 * @file THE durable `EntryRefsRepoPort` adapter (rule-of-two "second adapter" half —
 * `InMemoryEntryRefsRepo` from `@jini-ai/cms/widgets` is the first): one Kysely query body
 * for every dialect the storage kernel drives. The host binds its table name and kernel
 * at the composition root.
 *
 * `replaceForSource`/`rebuildForWorkspace` are delete-then-insert inside one `kernel.transaction`
 * (no per-row upsert race window) since `entry_refs` is a derived, rebuildable index (INV-06),
 * never hand-patched row by row. Reads order by the surrogate `id`, i.e. insertion order, on every
 * dialect.
 *
 * Lives in the SQL entry rather than beside the universal port so the port never has to
 * import concrete database types; only the composition root wires it behind `EntryRefsRepoPort`.
 */

type EntryRefsDbRow = Selectable<EntryRefsSqlRow>;

function toRecord(row: EntryRefsDbRow): EntryRefRow {
  return {
    workspaceId: row.workspace_id,
    sourceEntryId: row.source_entry_id,
    sourceKind: row.source_kind as EntryRefSourceKind,
    fieldPath: row.field_path,
    targetKind: row.target_kind as EntryRefTargetKind,
    targetId: row.target_id,
  };
}

function toRow(ref: EntryRefRow): Insertable<EntryRefsSqlRow> {
  return {
    workspace_id: ref.workspaceId,
    source_entry_id: ref.sourceEntryId,
    source_kind: ref.sourceKind,
    field_path: ref.fieldPath,
    target_kind: ref.targetKind,
    target_id: ref.targetId,
  };
}

export class SqlEntryRefsRepo implements EntryRefsRepoPort {
  protected readonly kernel: StorageKernel<Kysely<unknown>, unknown>;
  protected readonly tables: EntryRefsTables;
  constructor(
    { kernel, tables }: { kernel: StorageKernel<Kysely<unknown>, unknown>; tables: EntryRefsTables },
    _optional: Record<string, never> = {},
  ) { this.kernel = kernel; this.tables = tables; }

  async findByTarget(required: { workspaceId: UUID; targetKind: EntryRefTargetKind; targetId: UUID }): Promise<EntryRefRow[]> {
    const rows = await this.kernel.run((db) =>
      db
        .withTables<Record<string, EntryRefsSqlRow>>()
        .selectFrom(this.tables.entryRefs)
        .selectAll()
        .where("workspace_id", "=", required.workspaceId)
        .where("target_kind", "=", required.targetKind)
        .where("target_id", "=", required.targetId)
        .orderBy("id")
        .execute()
    );
    return rows.map(toRecord);
  }

  async findBySource(required: { workspaceId: UUID; sourceEntryId: UUID }): Promise<EntryRefRow[]> {
    const rows = await this.kernel.run((db) =>
      db
        .withTables<Record<string, EntryRefsSqlRow>>()
        .selectFrom(this.tables.entryRefs)
        .selectAll()
        .where("workspace_id", "=", required.workspaceId)
        .where("source_entry_id", "=", required.sourceEntryId)
        .orderBy("id")
        .execute()
    );
    return rows.map(toRecord);
  }

  /**
   * Delete-then-insert for one source entry — the entry_refs slice for that source is always
   * fully replaced, never incrementally patched (matches `EntryRefsRepoPort.replaceForSource`'s
   * own doc: "idempotent re-extraction on every write — never an incremental patch").
   *
   * @complexity O(1) plus O(r) for the replacement row count.
   */
  async replaceForSource(required: { workspaceId: UUID; sourceEntryId: UUID; refs: readonly EntryRefRow[] }): Promise<void> {
    await this.kernel.transaction(async () => {
      await this.removeBySource(required);
      await this.insertAll(required.refs);
    });
  }

  async removeBySource(required: { workspaceId: UUID; sourceEntryId: UUID }): Promise<void> {
    await this.kernel.run((db) =>
      db
        .withTables<Record<string, EntryRefsSqlRow>>()
        .deleteFrom(this.tables.entryRefs)
        .where("workspace_id", "=", required.workspaceId)
        .where("source_entry_id", "=", required.sourceEntryId)
        .execute()
    );
  }

  /**
   * Full workspace rebuild — the index is derived + rebuildable by definition.
   *
   * @complexity O(1) plus O(r) for the replacement row count.
   */
  async rebuildForWorkspace(required: { workspaceId: UUID; refs: readonly EntryRefRow[] }): Promise<void> {
    await this.kernel.transaction(async () => {
      await this.kernel.run((db) => db.withTables<Record<string, EntryRefsSqlRow>>().deleteFrom(this.tables.entryRefs).where("workspace_id", "=", required.workspaceId).execute());
      await this.insertAll(required.refs);
    });
  }

  private async insertAll(refs: readonly EntryRefRow[]): Promise<void> {
    if (refs.length === 0) return;
    await this.kernel.run((db) => db.withTables<Record<string, EntryRefsSqlRow>>().insertInto(this.tables.entryRefs).values(refs.map(toRow)).execute());
  }
}

/** The entry-refs repo for `kernel`. */
export function entryRefsRepoFor(
  { kernel, tables }: { kernel: StorageKernel<Kysely<unknown>, unknown>; tables: EntryRefsTables },
  _optional: Record<string, never> = {},
): SqlEntryRefsRepo {
  return new SqlEntryRefsRepo({ kernel, tables });
}
