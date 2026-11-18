/**
 * @file THE `TrashRepoPort` over `trashed_items` (migration `0070_trashed_items.sql`): one Kysely
 * query body for every database the storage kernel drives (SQLite, PGlite, Postgres). Every
 * statement goes through `kernel.run` and is awaited.
 *
 * Every statement in this file is column-only. Nothing here reads a domain table, which is what
 * keeps the Trash list working on rows whose payload is corrupt.
 */
import type { StorageKernel } from "@jini-ai/core/contracts/storage";
import type { Kysely, Selectable } from "kysely";

import { decodeTrashCursor, encodeTrashCursor } from "../cursor.js";
import type { TrashEntityType, TrashItem, TrashPage, TrashRepoPort, TrashSweepClaim } from "../ports.js";

/**
 * The `trashed_items` columns, copied from the host's generated schema in the same key order; the host's own type-level
 * pin fails if a later copy drifts from it. A type alias of a record, not an interface, below: Kysely's `withTables`
 * needs the implicit index signature only an alias has.
 */
export interface TrashedItemRow {
  id: string;
  workspace_id: string;
  entity_type: string;
  entity_id: string;
  trashed_at: string;
  purge_after: string;
  actor_principal_id: string;
  actor_plugin_id: string | null;
  display_title: string;
  display_subtitle: string | null;
  entity_version: number | null;
  prior_marker: string | null;
  purge_lease_owner: string | null;
  purge_lease_expires_at: string | null;
}
export type TrashedItemTables = Record<string, TrashedItemRow>;

/** Host-owned table name. No schema or product table default lives in the adapter. */
export interface TrashTables { trashedItems: string }

/** Everything the host must bind; a missing binding is a compile error. */
export interface TrashSqlRequired {
  kernel: StorageKernel<Kysely<unknown>, unknown>;
  tables: TrashTables;
}

/** The one lock every sweeper claim takes, so two sweepers never lease the same rows (Postgres; a
 *  SQLite transaction already holds the write lock). */
const SWEEP_LOCK_KEY = "trash:sweep-claim";

const ITEM_COLUMNS = [
  "id",
  "workspace_id",
  "entity_type",
  "entity_id",
  "trashed_at",
  "purge_after",
  "actor_principal_id",
  "actor_plugin_id",
  "display_title",
  "display_subtitle",
  "entity_version",
  "prior_marker",
] as const;

type TrashRow = Pick<Selectable<TrashedItemRow>, (typeof ITEM_COLUMNS)[number]>;

/** @complexity O(1). */
function toItem(row: TrashRow): TrashItem {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    entityType: row.entity_type,
    entityId: row.entity_id,
    trashedAt: row.trashed_at,
    purgeAfter: row.purge_after,
    actorPrincipalId: row.actor_principal_id,
    actorPluginId: row.actor_plugin_id,
    displayTitle: row.display_title,
    displaySubtitle: row.display_subtitle,
    entityVersion: row.entity_version === null ? null : Number(row.entity_version),
    priorMarker: row.prior_marker,
  };
}

export class SqlTrashRepo implements TrashRepoPort {
  protected readonly kernel: StorageKernel<Kysely<unknown>, unknown>;
  private readonly tables: TrashTables;

  constructor({ kernel, tables }: TrashSqlRequired, _optional: Record<string, never> = {}) {
    this.kernel = kernel;
    this.tables = tables;
  }

  /**
   * Insert-or-ignore on any unique conflict (`trashed_items_identity_unique`, or the id) —
   * re-trashing an already-trashed entity is a no-op, not a duplicate row and not an error, because
   * a domain's own delete path may be idempotent (media's is).
   *
   * @complexity O(1), one indexed insert.
   */
  async insert({ row }: { row: TrashItem }): Promise<void> {
    await this.kernel.run((db) =>
      db
        .withTables<TrashedItemTables>()
        .insertInto(this.tables.trashedItems)
        .values({
          id: row.id,
          workspace_id: row.workspaceId,
          entity_type: row.entityType,
          entity_id: row.entityId,
          trashed_at: row.trashedAt,
          purge_after: row.purgeAfter,
          actor_principal_id: row.actorPrincipalId,
          actor_plugin_id: row.actorPluginId,
          display_title: row.displayTitle,
          display_subtitle: row.displaySubtitle,
          entity_version: row.entityVersion,
          // `priorMarker` is a required field on `TrashItem`, but a hand-built literal in a test can
          // still omit the key — default it here rather than trust every call site set it.
          prior_marker: row.priorMarker ?? null,
        })
        .onConflict((oc) => oc.doNothing())
        .execute()
    );
  }

  /** @complexity O(1) via `trashed_items_identity_unique`. */
  async findByEntity(required: { workspaceId: string; entityType: TrashEntityType; entityId: string }): Promise<TrashItem | null> {
    const row = await this.kernel.run((db) =>
      db
        .withTables<TrashedItemTables>()
        .selectFrom(this.tables.trashedItems)
        .select(ITEM_COLUMNS)
        .where("workspace_id", "=", required.workspaceId)
        .where("entity_type", "=", required.entityType)
        .where("entity_id", "=", required.entityId)
        .executeTakeFirst()
    );
    return row ? toItem(row) : null;
  }

  /** @complexity O(k) primary-key lookups for k ids — parameterised, never interpolated. */
  async findByIds(required: { workspaceId: string; ids: readonly string[] }): Promise<TrashItem[]> {
    if (required.ids.length === 0) return [];
    const rows = await this.kernel.run((db) =>
      db
        .withTables<TrashedItemTables>()
        .selectFrom(this.tables.trashedItems)
        .select(ITEM_COLUMNS)
        .where("workspace_id", "=", required.workspaceId)
        .where("id", "in", [...required.ids])
        .execute()
    );
    return rows.map(toItem);
  }

  async deleteById(required: { workspaceId: string; id: string }): Promise<void> {
    await this.kernel.run((db) =>
      db.withTables<TrashedItemTables>().deleteFrom(this.tables.trashedItems).where("workspace_id", "=", required.workspaceId).where("id", "=", required.id).execute()
    );
  }

  async deleteByEntity(required: { workspaceId: string; entityType: TrashEntityType; entityId: string }): Promise<void> {
    await this.kernel.run((db) =>
      db
        .withTables<TrashedItemTables>()
        .deleteFrom(this.tables.trashedItems)
        .where("workspace_id", "=", required.workspaceId)
        .where("entity_type", "=", required.entityType)
        .where("entity_id", "=", required.entityId)
        .execute()
    );
  }

  /**
   * The Trash list: newest first, keyset-paginated on `(trashed_at, id)`, with the lazy expiry
   * filter (`purge_after > now`) so a site that sat closed past day 60 shows nothing expired on its
   * first render — no wait for a sweeper that may not have run on this machine in months.
   *
   * Fetches `limit + 1` to decide `nextCursor` without a second COUNT query.
   *
   * @complexity O(limit) via `idx_trashed_items_workspace_trashed_at`.
   */
  async list(required: {
    workspaceId: string;
    now: string;
    limit: number;
  }, optional: { entityTypes?: readonly TrashEntityType[]; cursor?: string | null } = {}): Promise<TrashPage> {
    const after = decodeTrashCursor({ cursor: optional.cursor });
    const rows = await this.kernel.run((db) => {
      let query = db
        .withTables<TrashedItemTables>()
        .selectFrom(this.tables.trashedItems)
        .select(ITEM_COLUMNS)
        .where("workspace_id", "=", required.workspaceId)
        .where("purge_after", ">", required.now);
      if (optional.entityTypes && optional.entityTypes.length > 0) {
        query = query.where("entity_type", "in", [...optional.entityTypes]);
      }
      if (after) {
        query = query.where((eb) =>
          eb.or([eb("trashed_at", "<", after.trashedAt), eb.and([eb("trashed_at", "=", after.trashedAt), eb("id", "<", after.id)])])
        );
      }
      return query
        .orderBy("trashed_at", "desc")
        .orderBy("id", "desc")
        .limit(required.limit + 1)
        .execute();
    });

    const items = rows.slice(0, required.limit).map(toItem);
    const last = items.at(-1);
    return { items, nextCursor: rows.length > required.limit && last ? encodeTrashCursor(last) : null };
  }

  /**
   * Atomically claims up to `limit` due, unleased rows across EVERY workspace in the file — the
   * `idx_trashed_items_purge_after` index is deliberately global for exactly this query.
   *
   * SELECT-then-UPDATE inside one transaction holding the sweep lock, rather than `UPDATE … LIMIT`
   * (a SQLite compile-time flag that is not guaranteed and does not port to Postgres). An expired
   * lease is reclaimable, which is what gives the sweeper crash recovery for free.
   *
   * @complexity O(limit) via the `purge_after` index.
   */
  async claimDue(required: { now: string; leaseOwner: string; leaseUntil: string; limit: number }): Promise<TrashSweepClaim[]> {
    return this.kernel.transaction(async () => {
      await this.kernel.lockKey(SWEEP_LOCK_KEY);
      const due = await this.kernel.run((db) =>
        db
          .withTables<TrashedItemTables>()
          .selectFrom(this.tables.trashedItems)
          .select(["id", "workspace_id", "entity_type", "entity_id", "entity_version"])
          .where("purge_after", "<=", required.now)
          .where((eb) => eb.or([eb("purge_lease_expires_at", "is", null), eb("purge_lease_expires_at", "<=", required.now)]))
          .orderBy("purge_after")
          .limit(required.limit)
          .execute()
      );
      if (due.length === 0) return [];

      await this.kernel.run((db) =>
        db
          .withTables<TrashedItemTables>()
          .updateTable(this.tables.trashedItems)
          .set({ purge_lease_owner: required.leaseOwner, purge_lease_expires_at: required.leaseUntil })
          .where(
            "id",
            "in",
            due.map((row) => row.id)
          )
          .execute()
      );

      return due.map((row) => ({
        id: row.id,
        workspaceId: row.workspace_id,
        entityType: row.entity_type,
        entityId: row.entity_id,
        entityVersion: row.entity_version === null ? null : Number(row.entity_version),
      }));
    });
  }

  /** @complexity O(1). */
  async releaseLease(required: { id: string }): Promise<void> {
    await this.kernel.run((db) =>
      db.withTables<TrashedItemTables>().updateTable(this.tables.trashedItems).set({ purge_lease_owner: null, purge_lease_expires_at: null }).where("id", "=", required.id).execute()
    );
  }
}
