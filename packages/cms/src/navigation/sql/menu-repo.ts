import { isUniqueViolation, type StorageKernel } from "@jini-ai/core/contracts/storage";
import type { Insertable, Kysely } from "kysely";
import { MenuConflictError, menuVersionConflictError } from "../menu-service.js";
import type { MenuRepoPort, MenuSaveOptions } from "../repo.memory.js";
import type { MenuStatus, NavMenuEntry } from "../types.js";
import { type MenuTableRow, type MenuTableViews, type NavigationSqlRequired, type NavigationTables, toMenuRecord } from "./repo.rows.js";

/**
 * @file THE durable `MenuRepoPort`: one Kysely query body for every dialect the storage kernel drives.
 * The second rule-of-two adapter (`../repo.memory.ts` is the first). Table names are host-owned.
 *
 * `SqlMenuRepo` adds `findByIdIncludingTrashed`, a trash-blind seam not on `MenuRepoPort`, needed by a host's
 * menu trash follow-up hooks — same precedent as `TrashAwareInMemoryEntryRepo.findAnyById`.
 *
 * Trash: a menu row with `status = 'trash'` is in the Trash. `findById`/`findBySlug`/`list` all
 * hide it, so every reader treats a trashed menu as missing. `save` never revives a trashed row —
 * the upsert's UPDATE branch is scoped to live rows only, mirroring the entry repo's `LIVE` guard.
 */

/** The status a trashed menu row carries; every live read excludes it. */
const TRASH: MenuStatus = "trash";

/** A write refused by the slug index: the reads hide a trashed holder, so that is the one the
 *  app-level slug check could not have seen. */
function trashedSlugConflict({ slug }: { slug: string }, _optional: Record<string, never> = {}): MenuConflictError {
  return new MenuConflictError({ message: `a menu with slug '${slug}' is in the Trash — restore it, or delete it permanently from the Trash, to reuse the slug` });
}

export class SqlMenuRepo implements MenuRepoPort {
  protected readonly kernel: StorageKernel<Kysely<unknown>, unknown>;
  protected readonly tables: NavigationTables;
  constructor({ kernel, tables }: NavigationSqlRequired, _optional: Record<string, never> = {}) {
    this.kernel = kernel;
    this.tables = tables;
  }

  /** One menu row by id in the workspace, trashed rows included only when asked. */
  private async findOne(required: { workspaceId: string; id: string }, includeTrashed: boolean): Promise<NavMenuEntry | null> {
    const row = await this.kernel.run((db) => {
      let query = db.withTables<MenuTableViews>().selectFrom(this.tables.menus).selectAll().where("workspace_id", "=", required.workspaceId).where("id", "=", required.id);
      if (!includeTrashed) query = query.where("status", "!=", TRASH);
      return query.limit(1).executeTakeFirst();
    });
    return row ? toMenuRecord(row) : null;
  }

  async findById(required: { workspaceId: string; id: string }): Promise<NavMenuEntry | null> {
    return this.findOne(required, false);
  }

  /**
   * Trash-blind twin of `findById` — sees a trashed row too. Not part of `MenuRepoPort`; exists only
   * for the trash follow-up hooks, which run after a row's `status` has already flipped to `'trash'`.
   * @complexity O(1).
   */
  async findByIdIncludingTrashed(required: { workspaceId: string; id: string }): Promise<NavMenuEntry | null> {
    return this.findOne(required, true);
  }

  async findBySlug(required: { workspaceId: string; slug: string }): Promise<NavMenuEntry | null> {
    const row = await this.kernel.run((db) =>
      db
        .withTables<MenuTableViews>()
        .selectFrom(this.tables.menus)
        .selectAll()
        .where("workspace_id", "=", required.workspaceId)
        .where("slug", "=", required.slug)
        .where("status", "!=", TRASH)
        .limit(1)
        .executeTakeFirst()
    );
    return row ? toMenuRecord(row) : null;
  }

  async list(required: { workspaceId: string }): Promise<NavMenuEntry[]> {
    const rows = await this.kernel.run((db) =>
      db.withTables<MenuTableViews>().selectFrom(this.tables.menus).selectAll().where("workspace_id", "=", required.workspaceId).where("status", "!=", TRASH).execute()
    );
    return rows.map(toMenuRecord);
  }

  /**
   * Upserts a menu row by id. A trashed row is left as it is — the upsert's UPDATE branch is
   * scoped to live rows only, so a stale save cannot revive one.
   *
   * With `expectedVersion` the save is a compare-and-set instead: one conditional UPDATE on
   * the live row holding that version, so two writers that read the same version cannot both land
   * (a Postgres writer blocked on the row lock re-checks the WHERE against the winner's row). With
   * `expectedVersion: null` (an id-preserving import-as-create) it is an insert that lands only when
   * the id is free, so two creates of one id cannot both land either.
   * @throws MenuConflictError when a trashed row holds the slug: `findBySlug` above hides it, so the
   *         app-level slug check could not see it before the INSERT hit the real unique index (the
   *         only unique index left once the id conflict is absorbed by the upsert).
   * @throws MenuVersionConflictError ``menu '<id>' was modified concurrently (expected version <n>, found <stored|none>)``
   *         when the compare-and-set misses (stale version, trashed or missing row), or
   *         ``menu '<id>' already exists (expected no menu, found version <n>)`` when a create finds the id taken.
   * @complexity O(1).
   */
  async save(record: NavMenuEntry, options: MenuSaveOptions = {}): Promise<void> {
    const values = {
      workspace_id: record.workspaceId,
      slug: record.slug,
      title: record.title,
      status: record.status,
      doc_json: JSON.stringify(record.doc),
      locations_json: JSON.stringify(record.locations),
      updated_at: record.updatedAt,
      version: record.version,
    };
    try {
      if (options.expectedVersion === null) {
        await this.insertIfAbsent(record, values);
        return;
      }
      if (options.expectedVersion !== undefined) {
        await this.compareAndSet(record, values, options.expectedVersion);
        return;
      }
      const { menus } = this.tables;
      await this.kernel.run((db) =>
        db
          .withTables<MenuTableViews>()
          .insertInto(menus)
          .values({ id: record.id, ...values })
          .onConflict((oc) => oc.column("id").doUpdateSet(values).where(`${menus}.status` as const, "!=", TRASH))
          .execute()
      );
    } catch (error) {
      if (isUniqueViolation({ err: error })) throw trashedSlugConflict({ slug: record.slug });
      throw error;
    }
  }

  /**
   * The insert behind `save`'s `expectedVersion: null`. `ON CONFLICT DO NOTHING` has no target on
   * purpose (as in the entry repo's): with only `(id)` as the target, a Postgres create racing another
   * on the same id can hit the `(workspace_id, slug)` unique index first and fail with a unique
   * violation, which also aborts the transaction. Untargeted, a writer blocked on the winner's
   * uncommitted insert waits, then inserts nothing. A miss is told apart by whether a row (trashed, or
   * in any workspace) holds the id; if none does, the only other unique index, the slug, refused it.
   */
  private async insertIfAbsent(record: NavMenuEntry, values: Omit<Insertable<MenuTableRow>, "id">): Promise<void> {
    const inserted = await this.kernel.run((db) =>
      db.withTables<MenuTableViews>().insertInto(this.tables.menus).values({ id: record.id, ...values }).onConflict((oc) => oc.doNothing()).executeTakeFirst()
    );
    // A driver that reported no count reads as inserted: read as a miss, the holder lookup below would
    // find this very row and turn a create that succeeded into a false version conflict.
    if (Number(inserted.numInsertedOrUpdatedRows) !== 0) return;
    const holder = await this.kernel.run((db) =>
      db.withTables<MenuTableViews>().selectFrom(this.tables.menus).select("version").where("id", "=", record.id).executeTakeFirst()
    );
    if (!holder) throw trashedSlugConflict({ slug: record.slug });
    throw menuVersionConflictError({ id: record.id, expectedVersion: null, found: holder.version });
  }

  /** The conditional UPDATE behind `save`'s `expectedVersion`; on a miss, re-reads the live version for the message. */
  private async compareAndSet(record: NavMenuEntry, values: Omit<Insertable<MenuTableRow>, "id">, expectedVersion: number): Promise<void> {
    const result = await this.kernel.run((db) =>
      db
        .withTables<MenuTableViews>()
        .updateTable(this.tables.menus)
        .set(values)
        .where("workspace_id", "=", record.workspaceId)
        .where("id", "=", record.id)
        .where("status", "!=", TRASH)
        .where("version", "=", expectedVersion)
        .executeTakeFirst()
    );
    if (Number(result.numUpdatedRows) > 0) return;
    const found = (await this.findById({ workspaceId: record.workspaceId, id: record.id }))?.version ?? null;
    throw menuVersionConflictError({ id: record.id, expectedVersion, found });
  }

  /** One kernel transaction; the binding repo and outbox built on the same kernel join it, as does a
   *  nested call (`assignLocation`, `importMenuEntity`). @complexity O(1) beyond `fn`. */
  async transaction<T>({ fn }: { fn: () => Promise<T> }): Promise<T> {
    return this.kernel.transaction(fn);
  }

  async remove(required: { workspaceId: string; id: string }): Promise<void> {
    await this.kernel.run((db) =>
      db.withTables<MenuTableViews>().deleteFrom(this.tables.menus).where("workspace_id", "=", required.workspaceId).where("id", "=", required.id).execute()
    );
  }
}
