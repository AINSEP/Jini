import type { StorageKernel } from "@jini-ai/core/contracts/storage";
import { assertVersionedWrite } from "@jini-ai/core/optimistic-concurrency";
import type { Kysely } from "kysely";
import type { WorkspaceRecord, WorkspaceRepoPort } from "../create.js";

/**
 * @file THE workspace repository: one Kysely query body for every database the storage kernel drives.
 * Satisfies `WorkspaceRepoPort`, the same port as `../repo.memory.ts`. Every statement goes through
 * `kernel.run`; table names are host-owned.
 */

/** Stored column shape of the host's workspaces table; the table name itself is host-owned. */
export interface WorkspacesTable {
  id: string;
  name: string;
  slug: string;
  created_at: string;
  version: number;
}

/** Host-owned table names. No schema or product table defaults live in the adapter. */
export interface WorkspaceTables { workspaces: string }
export interface WorkspaceSqlRequired { kernel: StorageKernel<Kysely<unknown>, unknown>; tables: WorkspaceTables }

/** The install-wide roster lock: every workspace writer that must not interleave takes this one key. */
const ROSTER_LOCK_KEY = "workspace:roster";

function toRecord(row: WorkspacesTable): WorkspaceRecord {
  return { id: row.id, name: row.name, slug: row.slug, createdAt: row.created_at, version: row.version };
}

export class SqlWorkspaceRepo implements WorkspaceRepoPort {
  protected readonly kernel: StorageKernel<Kysely<unknown>, unknown>;
  protected readonly tables: WorkspaceTables;
  constructor(
    { kernel, tables }: WorkspaceSqlRequired,
    _optional: Record<string, never> = {},
  ) {
    this.kernel = kernel;
    this.tables = tables;
  }

  async insert(record: WorkspaceRecord): Promise<void> {
    await this.kernel.run((db) =>
      db
        .withTables<Record<string, WorkspacesTable>>()
        .insertInto(this.tables.workspaces)
        .values({ id: record.id, name: record.name, slug: record.slug, created_at: record.createdAt, version: record.version })
        .execute()
    );
  }

  async findBySlug({ slug }: { slug: string }): Promise<WorkspaceRecord | null> {
    const row = await this.kernel.run((db) =>
      db.withTables<Record<string, WorkspacesTable>>().selectFrom(this.tables.workspaces).selectAll().where("slug", "=", slug).limit(1).executeTakeFirst()
    );
    return row ? toRecord(row) : null;
  }

  async findById({ id }: { id: string }): Promise<WorkspaceRecord | null> {
    const row = await this.kernel.run((db) =>
      db.withTables<Record<string, WorkspacesTable>>().selectFrom(this.tables.workspaces).selectAll().where("id", "=", id).limit(1).executeTakeFirst()
    );
    return row ? toRecord(row) : null;
  }

  /** All workspace rows (v1 always has exactly one; see `../delete.ts`'s header). */
  async list(): Promise<WorkspaceRecord[]> {
    const rows = await this.kernel.run((db) => db.withTables<Record<string, WorkspacesTable>>().selectFrom(this.tables.workspaces).selectAll().execute());
    return rows.map(toRecord);
  }

  async update(record: WorkspaceRecord, optional: { expectedVersion?: number } = {}): Promise<void> {
    const { expectedVersion } = optional;
    if (expectedVersion !== undefined) {
      // Match the editor's basis in the UPDATE so concurrent saves cannot both succeed.
      const result = await this.kernel.run((db) => db.withTables<Record<string, WorkspacesTable>>().updateTable(this.tables.workspaces)
        .set({ name: record.name, slug: record.slug, version: record.version })
        .where("id", "=", record.id)
        .where("version", "=", expectedVersion)
        .executeTakeFirst());
      await assertVersionedWrite({ changedRows: result.numUpdatedRows, recordKind: "workspace", recordId: record.id,
        expectedVersion, readCurrentVersion: async () => (await this.findById({ id: record.id }))?.version ?? null });
      return;
    }
    await this.kernel.run((db) =>
      db
        .withTables<Record<string, WorkspacesTable>>()
        .updateTable(this.tables.workspaces)
        .set({ name: record.name, slug: record.slug, version: record.version })
        .where("id", "=", record.id)
        .execute()
    );
  }

  /** The port's row deletion only: the last-workspace guard is the caller's (`../delete.ts`). */
  async delete({ id }: { id: string }): Promise<void> {
    await this.kernel.run((db) => db.withTables<Record<string, WorkspacesTable>>().deleteFrom(this.tables.workspaces).where("id", "=", id).execute());
  }

  /**
   * Serialize the workspace-count guard and delete on the same kernel as the repository reads.
   * Awaited reads can interleave, so one event loop does not protect the last-workspace floor.
   * The install-wide roster lock covers every workspace; nested kernel calls join this transaction.
   * All workspace writers must use this lock before the multi-workspace delete path is enabled.
   * @complexity O(1) transaction overhead plus the callback's database work.
   */
  async transaction<T>({ fn }: { fn: () => Promise<T> }): Promise<T> {
    return this.kernel.transaction(async () => {
      await this.kernel.lockKey(ROSTER_LOCK_KEY);
      return fn();
    });
  }
}

/** The workspace repo on `kernel`'s database, whichever dialect. */
export function workspaceRepoFor(required: WorkspaceSqlRequired, _optional: Record<string, never> = {}): SqlWorkspaceRepo {
  return new SqlWorkspaceRepo(required, {});
}
