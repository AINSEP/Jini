import type { StorageKernel } from "@jini-ai/core/contracts/storage";
import type { Kysely } from "kysely";
import type { ContentTypeListPort } from "../list.js";
import type { ContentTypeRecord } from "../types.js";
import type { ContentTypeRepoPort, ContentTypeRevisionInput } from "../write-service.js";
import {
  type ContentTypeRevisionTableViews,
  type ContentTypeRowMapper,
  type ContentTypeSqlRequired,
  type ContentTypeTables,
  type ContentTypeTableViews,
  contentTypeRowMapper,
} from "./repo.rows.js";

/**
 * @file THE content-type repository: one Kysely query body for every database the storage kernel
 * drives (SQLite, PGlite, Postgres). Satisfies the same certified ports `repo.memory.ts` does; `id`
 * is a synthetic `${workspaceId}::${key}` key so `save()` can upsert by primary key. Every
 * statement goes through `kernel.run` and is awaited; `transaction` delegates to the kernel, which
 * joins the caller's transaction when there is one. Table names and declared owners are host-owned.
 */
export class SqlContentTypeRepo implements ContentTypeRepoPort, ContentTypeListPort {
  protected readonly kernel: StorageKernel<Kysely<unknown>, unknown>;
  protected readonly tables: ContentTypeTables;
  private readonly rows: ContentTypeRowMapper;

  constructor({ kernel, tables, declaredOwners }: ContentTypeSqlRequired, _optional: Record<string, never> = {}) {
    this.kernel = kernel;
    this.tables = tables;
    this.rows = contentTypeRowMapper({ declaredOwners });
  }

  /**
   * Upserts a `content_types` row by its synthetic `(workspaceId, key)` id — full-replace
   * semantics, matching `InMemoryContentTypeRepo.save`'s `Map.set` behavior exactly.
   *
   * @complexity O(1).
   */
  async save(record: ContentTypeRecord): Promise<void> {
    const row = this.rows.toRow(record);
    await this.kernel.run((db) =>
      db
        .withTables<ContentTypeTableViews>()
        .insertInto(this.tables.contentTypes)
        .values(row)
        .onConflict((oc) => oc.column("id").doUpdateSet(this.rows.updatableColumns(row)))
        .execute()
    );
  }

  async appendRevision(revision: ContentTypeRevisionInput): Promise<void> {
    await this.kernel.run((db) =>
      db.withTables<ContentTypeRevisionTableViews>().insertInto(this.tables.revisions).values(this.rows.toRevisionRow(revision)).execute()
    );
  }

  async findByKey(params: { workspaceId: string; key: string }): Promise<ContentTypeRecord | null> {
    const row = await this.kernel.run((db) =>
      db
        .withTables<ContentTypeTableViews>()
        .selectFrom(this.tables.contentTypes)
        .selectAll()
        .where("workspace_id", "=", params.workspaceId)
        .where("key", "=", params.key)
        .limit(1)
        .executeTakeFirst()
    );
    return row ? this.rows.toRecord(row) : null;
  }

  async listByWorkspace(params: { workspaceId: string }): Promise<ContentTypeRecord[]> {
    const rows = await this.kernel.run((db) =>
      db.withTables<ContentTypeTableViews>().selectFrom(this.tables.contentTypes).selectAll().where("workspace_id", "=", params.workspaceId).execute()
    );
    return rows.map((row) => this.rows.toRecord(row));
  }

  /** Callback repo calls join ONE transaction; nested calls join the outer one. */
  async transaction<T>({ fn }: { fn: () => Promise<T> }): Promise<T> {
    return this.kernel.transaction(fn);
  }
}
