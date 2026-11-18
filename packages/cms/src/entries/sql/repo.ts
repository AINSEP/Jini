import { isUniqueViolation, type StorageKernel } from "@jini-ai/core/contracts/storage";
import { type Kysely, type SelectQueryBuilder, sql } from "kysely";
import type { CollectionListQuery, EntryDisplayListPort, EntryListExcludingTypesPort } from "../../widgets/resolvers/ports.js";
import { EntrySlugConflictError, VersionConflictError } from "../errors.js";
import type { EntryListPort } from "../list.js";
import type { EntryPublishReadPort, TrashableEntryRecord } from "../publish-read-port.js";
import type { EntryRecord, EntryStatus } from "../types.js";
import type { EntryRepoPort, EntryRevisionInput } from "../write-service.js";
import type { EntryJsonDialectPort } from "./json-dialect-port.js";
import {
  type EntryRevisionTableViews,
  type EntrySqlRequired,
  type EntryTableRow,
  type EntryTables,
  type EntryTableViews,
  toRecord,
  toRevisionRow,
  toRow,
} from "./repo.rows.js";

/**
 * @file THE durable `EntryRepoPort` + `EntryListPort` (and the display / exclude-types / publish
 * read ports): one Kysely query body for every database the storage kernel drives (SQLite, PGlite,
 * Postgres). The second rule-of-two adapter (`trash-aware-memory-repo.ts` is the first);
 * `repo.sqlite.ts` keeps `SqliteEntryRepo` as a thin subclass built from the content db handle.
 *
 * Trash: a row with `deleted_at` set is in the Trash (only widgets get there today). Every read here
 * hides it, so every widget reader — region placements, embeds, the admin list — treats a trashed
 * widget as missing (the REQ-28 placeholder). `save` never writes `deleted_at` and never touches a
 * trashed row; only the Trash moves a row in or out.
 *
 * In this package: the host keeps `SqliteEntryRepo` and its memory twin; table names, the JSON dialect helpers and
 * the write-settled hook are host-owned.
 */

type EntriesSelect = SelectQueryBuilder<EntryTableViews, string, EntryTableRow>;
type ListParams = Parameters<EntryListPort["listByWorkspace"]>[0] & NonNullable<Parameters<EntryListPort["listByWorkspace"]>[1]>;

/** A write refused by the slug index: the reads hide a trashed holder, so that is the one the
 *  chokepoint's own slug check could not have seen. */
function trashedSlugConflict({ slug }: { slug: string }, _options = {}): EntrySlugConflictError {
  return new EntrySlugConflictError({ message: `an entry with slug '${slug}' is in the Trash — restore it, or delete it permanently from the Trash, to reuse the slug` });
}

/**
 * What a custom field's name must look like to be used as a JSON path key. Content-type field names
 * are `^[a-z][a-z0-9_]{0,63}$` (`IDENTIFIER_GRAMMAR_PATTERN`), which always passes; anything else
 * can only be a caller that skipped that validation, and it matches nothing rather than throwing
 * (today's behaviour) — the name never reaches SQL either way.
 */
const SITE_FIELD_KEY = /^\w+$/;

/** The path of a custom field's value inside `entries.fields_json`. */
const siteFieldPath = ({ field }: { field: string }, _options = {}): string[] => ["ext", "site", field];

export class SqlEntryRepo implements EntryRepoPort, EntryListPort, EntryDisplayListPort, EntryListExcludingTypesPort, EntryPublishReadPort {
  protected readonly kernel: StorageKernel<Kysely<unknown>, unknown>;
  protected readonly tables: EntryTables;
  private readonly json: EntryJsonDialectPort;
  private readonly onWriteSettled: (event: { repo: object }) => void;

  constructor({ kernel, tables, json, onWriteSettled }: EntrySqlRequired, _optional: Record<string, never> = {}) {
    this.kernel = kernel;
    this.tables = tables;
    this.json = json;
    this.onWriteSettled = onWriteSettled;
  }

  /** `entries` in the workspace, the Trash hidden unless `includeTrashed`. */
  private scoped(
    { db, workspaceId }: { db: Kysely<unknown>; workspaceId: string },
    { includeTrashed = false }: { includeTrashed?: boolean } = {},
  ): EntriesSelect {
    const query = db.withTables<EntryTableViews>().selectFrom(this.tables.entries).selectAll().where("workspace_id", "=", workspaceId);
    return includeTrashed ? query : query.where("deleted_at", "is", null);
  }

  async findBySlug(params: { workspaceId: string; type: string; slug: string }): Promise<EntryRecord | null> {
    const row = await this.kernel.run((db) =>
      this.scoped({ db, workspaceId: params.workspaceId }).where("type", "=", params.type).where("slug", "=", params.slug).limit(1).executeTakeFirst()
    );
    return row ? toRecord(row) : null;
  }

  async findById(params: { workspaceId: string; id: string }): Promise<EntryRecord | null> {
    const row = await this.kernel.run((db) => this.scoped({ db, workspaceId: params.workspaceId }).where("id", "=", params.id).limit(1).executeTakeFirst());
    return row ? toRecord(row) : null;
  }

  /** Trash-blind: see {@link EntryPublishReadPort}. @complexity O(1). */
  async findAnyById(params: { workspaceId: string; id: string }): Promise<TrashableEntryRecord | null> {
    const row = await this.kernel.run((db) => this.scoped({ db, workspaceId: params.workspaceId }, { includeTrashed: true }).where("id", "=", params.id).limit(1).executeTakeFirst());
    return row ? { ...toRecord(row), deletedAt: row.deleted_at } : null;
  }

  /** Trash-blind: see {@link EntryPublishReadPort}. @complexity O(1). */
  async findAnyBySlug(params: { workspaceId: string; type: string; slug: string }): Promise<TrashableEntryRecord | null> {
    const row = await this.kernel.run((db) =>
      this.scoped({ db, workspaceId: params.workspaceId }, { includeTrashed: true }).where("type", "=", params.type).where("slug", "=", params.slug).limit(1).executeTakeFirst()
    );
    return row ? { ...toRecord(row), deletedAt: row.deleted_at } : null;
  }

  /**
   * Upserts an `entries` row by id — full-replace semantics, matching `InMemoryEntryRepo.save`'s
   * `Map.set` behavior exactly. A trashed row is left as it is (a stale save cannot bring it back).
   *
   * With `expectedVersion` the save is a compare-and-set instead (wm S3): one conditional UPDATE on
   * the live row holding that version, inside the caller's transaction, so two writers that read the
   * same version cannot both land (a Postgres writer blocked on the row lock re-checks the WHERE
   * against the winner's row). With `expectedVersion: null` (an import-as-create) it is an insert that
   * lands only when the id is free, so two creates of one id cannot both land either.
   * @throws EntrySlugConflictError when a trashed row holds the slug: the reads above hide it, so the
   *         chokepoint's own slug check could not see it.
   * @throws VersionConflictError ``expected version <n> for entry '<id>', found <stored|none>`` when the
   *         compare-and-set misses (stale version, trashed or missing row), or
   *         ``expected no entry '<id>', found <stored>`` when a create finds the id taken.
   * @complexity O(1).
   */
  async save(record: EntryRecord, options: { expectedVersion?: number | null } = {}): Promise<void> {
    const values = toRow(record);
    try {
      if (options.expectedVersion === null) {
        await this.insertIfAbsent(record, values);
        return;
      }
      if (options.expectedVersion !== undefined) {
        await this.compareAndSet({ record, values, expectedVersion: options.expectedVersion });
        return;
      }
      await this.kernel.run((db) =>
        db
          .withTables<EntryTableViews>()
          .insertInto(this.tables.entries)
          .values(values)
          .onConflict((oc) => oc.column("id").doUpdateSet(values).where(`${this.tables.entries}.deleted_at`, "is", null))
          .execute()
      );
    } catch (error) {
      if (isUniqueViolation(error)) throw trashedSlugConflict({ slug: record.slug });
      throw error;
    } finally {
      this.onWriteSettled({ repo: this });
    }
  }

  /**
   * The insert behind `save`'s `expectedVersion: null`. `ON CONFLICT DO NOTHING` has no target on
   * purpose: with only `(id)` as the target, a Postgres create racing another on the same id can hit
   * the `(workspace_id, type, slug)` unique index first and fail with a unique violation, which also
   * aborts the transaction. Untargeted, a writer blocked on the winner's uncommitted insert waits,
   * then inserts nothing. A miss is told apart by whether a row (trashed, or in any workspace) holds
   * the id; if none does, the only other unique index, the slug, refused it.
   */
  private async insertIfAbsent(record: EntryRecord, values: ReturnType<typeof toRow>): Promise<void> {
    const inserted = await this.kernel.run((db) =>
      db.withTables<EntryTableViews>().insertInto(this.tables.entries).values(values).onConflict((oc) => oc.doNothing()).executeTakeFirst()
    );
    // A driver that reported no count reads as inserted: read as a miss, the holder lookup below would
    // find this very row and turn a create that succeeded into a false version conflict.
    if (Number(inserted.numInsertedOrUpdatedRows) !== 0) return;
    const holder = await this.kernel.run((db) =>
      db.withTables<EntryTableViews>().selectFrom(this.tables.entries).select("version").where("id", "=", record.id).executeTakeFirst()
    );
    if (!holder) throw trashedSlugConflict({ slug: record.slug });
    throw new VersionConflictError({ message: `expected no entry '${record.id}', found ${holder.version}` });
  }

  /** The conditional UPDATE behind `save`'s `expectedVersion`; on a miss, re-reads the live version for the message. */
  private async compareAndSet({ record, values, expectedVersion }: { record: EntryRecord; values: ReturnType<typeof toRow>; expectedVersion: number }, _options = {}): Promise<void> {
    const result = await this.kernel.run((db) =>
      db
        .withTables<EntryTableViews>()
        .updateTable(this.tables.entries)
        .set(values)
        .where("workspace_id", "=", record.workspaceId)
        .where("id", "=", record.id)
        .where("deleted_at", "is", null)
        .where("version", "=", expectedVersion)
        .executeTakeFirst()
    );
    if (Number(result.numUpdatedRows) > 0) return;
    const found = (await this.findById({ workspaceId: record.workspaceId, id: record.id }))?.version ?? "none";
    throw new VersionConflictError({ message: `expected version ${expectedVersion} for entry '${record.id}', found ${found}` });
  }

  async appendRevision(revision: EntryRevisionInput): Promise<void> {
    await this.kernel.run((db) => db.withTables<EntryRevisionTableViews>().insertInto(this.tables.revisions).values(toRevisionRow(revision)).execute());
  }

  async listByWorkspace(
    required: Parameters<EntryListPort["listByWorkspace"]>[0],
    optional: NonNullable<Parameters<EntryListPort["listByWorkspace"]>[1]> = {}
  ): Promise<EntryRecord[]> {
    const { type } = optional;
    return this.listLive({ params: { ...required, ...optional } }, { narrow: type ? (query) => query.where("type", "=", type) : undefined });
  }

  /**
   * Review fix 3b (`public-list.ts`'s {@link EntryListExcludingTypesPort} doc) — same shape as
   * {@link listByWorkspace}, but `excludeTypes` rows are filtered out in SQL, before `LIMIT`, so
   * they can never crowd a bounded result out of real content.
   *
   * @complexity O(log n + k) via `idx_entries_workspace(workspace_id, type)`; `k` is bounded by
   * `params.limit`, never a full-table scan.
   */
  async listByWorkspaceExcludingTypes(params: {
    workspaceId: string;
    excludeTypes: readonly string[];
    status?: EntryStatus;
    orderBy?: "updatedAt";
    orderDirection?: "asc" | "desc";
    limit?: number;
  }): Promise<EntryRecord[]> {
    return this.listLive(
      { params },
      { narrow: params.excludeTypes.length > 0 ? (query) => query.where("type", "not in", [...params.excludeTypes]) : undefined }
    );
  }

  /** The shared body of the two workspace lists: live rows, an optional type filter, status, order, limit. */
  private async listLive(
    { params }: { params: ListParams },
    { narrow }: { narrow?: ((query: EntriesSelect) => EntriesSelect) | undefined } = {},
  ): Promise<EntryRecord[]> {
    const rows = await this.kernel.run((db) => {
      let query = this.scoped({ db, workspaceId: params.workspaceId });
      if (narrow) query = narrow(query);
      if (params.status) query = query.where("status", "=", params.status);
      if (params.orderBy === "updatedAt") query = query.orderBy("updated_at", params.orderDirection === "asc" ? "asc" : "desc");
      if (typeof params.limit === "number") query = query.limit(params.limit);
      return query.execute();
    });
    return rows.map(toRecord);
  }

  /** Callback repo calls join ONE transaction; nested calls join the outer one (the widget adoption
   *  runs an entry update and its Trash move as one). */
  async transaction<T>({ fn }: { fn: () => Promise<T> }): Promise<T> {
    try { return await this.kernel.transaction(fn); }
    finally { this.onWriteSettled({ repo: this }); }
  }

  /**
   * C2 (plan lines 149-167) — the `{"type":"collection"}` marker's read path: published,
   * non-trashed rows of `query.type`, narrowed by every `query.where` clause, ordered by
   * `query.sort`, bounded to `query.limit`. Every `where`/`sort` field name and value reaches SQL
   * only as a bound parameter, never interpolated into the query text. NULL sort keys come first
   * ascending and last descending on every dialect, and `entries.id` is the final tiebreak so a
   * result is stable across calls when the primary key ties.
   *
   * @complexity O(log n + k): `idx_entries_workspace(workspace_id, type)` narrows to the
   * workspace+type first; each matched row is then charged one JSON read per `where` clause plus the
   * sort key (no expression index yet — plan §1 unknown 3's "queryable index provisioner" follow-up
   * is later work). `k` is bounded by `query.limit` at the SQL layer.
   */
  async listPublishedForDisplay(params: { workspaceId: string; query: CollectionListQuery }): Promise<EntryRecord[]> {
    const { workspaceId, query } = params;
    const rows = await this.kernel.run((db) => {
      let select = this.scoped({ db, workspaceId }).where("type", "=", query.type).where("status", "=", "published");
      for (const clause of query.where) {
        select = select.where(
          SITE_FIELD_KEY.test(clause.field)
            ? this.json.scalarEquals({ column: sql.ref("fields_json"), path: siteFieldPath({ field: clause.field }), value: clause.value })
            : sql<boolean>`(1 = 0)`
        );
      }
      const dir = query.sort.dir;
      const key = this.sortKey(query.sort.by);
      if (key) select = select.orderBy(key, (ob) => (dir === "asc" ? ob.asc().nullsFirst() : ob.desc().nullsLast()));
      return select.orderBy("id", "asc").limit(query.limit).offset(query.offset ?? 0).execute();
    });
    return rows.map(toRecord);
  }

  /** The `ORDER BY` target: the three built-in keywords are real columns; `{field}` is the JSON sort
   *  key. A field name that cannot be a path key has none (`null`): `id` alone decides the order. */
  private sortKey(by: CollectionListQuery["sort"]["by"]) {
    if (by === "published") return sql.ref("published_at");
    if (by === "updated") return sql.ref("updated_at");
    if (by === "title") return sql.ref("title");
    if (!SITE_FIELD_KEY.test(by.field)) return null;
    return this.json.sortKey({ column: sql.ref("fields_json"), path: siteFieldPath({ field: by.field }) });
  }
}
