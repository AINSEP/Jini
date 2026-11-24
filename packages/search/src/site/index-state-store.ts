/**
 * @file The site-search indexer's bookkeeping on the host's content database: one Kysely
 * body for SQLite, PGlite and Postgres, behind this package's `SearchIndexStatePort` and
 * `SearchTargetPort`. No search logic here: the generic indexer decides, this only stores.
 *
 * The two ports are returned as two objects because both name a `get` with different inputs.
 *
 * The four tables are host-owned: the host names them (`tables`) and creates them. `kysely` is a
 * type-only import here, so the host's Kysely instance is the only runtime dependency.
 */
import type { StorageKernel } from "@jini-ai/core/contracts/storage";
import type { ExpressionBuilder, Kysely } from "kysely";

import { encodeSearchKey } from "../contract.js";
import type {
  SearchIndexStatePort, SearchIndexStateRow, SearchIndexStatus, SearchSiteTargets,
  SearchStatusCounts, SearchTarget, SearchTargetPort,
} from "../ports.js";

/** Numbers stored as `bigint` come back as a number (SQLite), a string or a bigint (Postgres drivers). */
type Big = number | string | bigint;

interface StateTable {
  site_id: string; provider_id: string; generation: number; doc_key: string;
  workspace_id: string; collection: string; document_id: string;
  revision: Big; deleted: number; status: string; attempts: number;
  task_id: string | null; last_error: string | null; updated_at_ms: Big;
}
interface WatermarkTable { site_id: string; provider_id: string; generation: number; collection: string; cursor: string | null; done: number }
interface RetiredTable { site_id: string; provider_id: string; generation: number; retired_at_ms: Big }
interface TargetTable {
  site_id: string; active_provider_id: string | null; active_generation: number | null;
  building_provider_id: string | null; building_generation: number | null; updated_at_ms: Big;
}

/** The three bookkeeping tables plus the retired generations. They are host-managed raw SQL, so the
 *  host's generated database type never holds them; this local shape is what the queries are typed
 *  against. The keys are type-level names only: the host's real table names arrive in `tables`. */
export interface SearchIndexDatabase {
  search_index_state: StateTable;
  search_index_watermarks: WatermarkTable;
  search_index_targets: TargetTable;
  search_index_retired: RetiredTable;
}

/** Host-owned table names, quoted by Kysely; no product table defaults live in the adapter. */
export interface SearchIndexTables { state: string; watermarks: string; targets: string; retired: string }

/** The storage kernel, typed against {@link SearchIndexDatabase} (Kysely types are compile-time only). */
type IndexKernel = StorageKernel<Kysely<SearchIndexDatabase>, unknown>;

/** The injected names, typed as the literal keys of {@link SearchIndexDatabase} so the builders stay typed. */
interface TypedTables {
  readonly state: "search_index_state"; readonly watermarks: "search_index_watermarks";
  readonly targets: "search_index_targets"; readonly retired: "search_index_retired";
}

export interface SqlSearchIndexStore {
  readonly indexState: SearchIndexStatePort;
  readonly targets: SearchTargetPort;
}

const STATUSES: readonly SearchIndexStatus[] = ["pending", "indexed", "unknown", "failed"];

/** Row → port shape; optional fields are omitted rather than `undefined`. @complexity O(1). */
function toStateRow(row: StateTable): SearchIndexStateRow {
  return {
    target: { siteId: row.site_id, providerId: row.provider_id, generation: Number(row.generation) },
    key: { siteId: row.site_id, workspaceId: row.workspace_id, collection: row.collection, documentId: row.document_id },
    revision: Number(row.revision),
    deleted: Number(row.deleted) === 1,
    status: row.status as SearchIndexStatus,
    attempts: Number(row.attempts),
    ...(row.task_id === null ? {} : { taskId: row.task_id }),
    ...(row.last_error === null ? {} : { lastError: row.last_error }),
    updatedAtMs: Number(row.updated_at_ms),
  };
}

/** Port row → columns. The key's own `siteId` is the target's (one site per target). @complexity O(key length). */
function toStateColumns(row: SearchIndexStateRow): StateTable {
  return {
    site_id: row.target.siteId, provider_id: row.target.providerId, generation: row.target.generation,
    doc_key: encodeSearchKey({ key: row.key }),
    workspace_id: row.key.workspaceId, collection: row.key.collection, document_id: row.key.documentId,
    revision: row.revision, deleted: row.deleted ? 1 : 0, status: row.status, attempts: row.attempts,
    task_id: row.taskId ?? null, last_error: row.lastError ?? null, updated_at_ms: row.updatedAtMs,
  };
}

/** A stored pointer pair, or `null` when that half is empty (the CHECK keeps both columns in step). */
function toTarget({ siteId, providerId, generation }: { siteId: string; providerId: string | null; generation: number | null }, _optional = {}): SearchTarget | null {
  return providerId === null || generation === null ? null : { siteId, providerId, generation: Number(generation) };
}
function createIndexWatermarks({ kernel, t }: { kernel: IndexKernel; t: TypedTables }, scoped: (target: SearchTarget) => { site_id: string; provider_id: string; generation: number }): Pick<SearchIndexStatePort, 'getWatermark' | 'putWatermark' | 'deleteTarget'> {
  return {
    async getWatermark({ target, collection }) {
      const row = await kernel.run(db => db.selectFrom(t.watermarks).select(["cursor", "done"])
        .where("site_id", "=", target.siteId).where("provider_id", "=", target.providerId)
        .where("generation", "=", target.generation).where("collection", "=", collection)
        .executeTakeFirst());
      if (!row) return null;
      return { ...(row.cursor === null ? {} : { cursor: row.cursor }), done: Number(row.done) === 1 };
    },
    async putWatermark({ target, collection, cursor, done }) {
      const changes = { cursor: cursor ?? null, done: done ? 1 : 0 };
      await kernel.run(db => db.insertInto(t.watermarks).values({ ...scoped(target), collection, ...changes })
        .onConflict(oc => oc.columns(["site_id", "provider_id", "generation", "collection"]).doUpdateSet(changes))
        .execute());
    },
    async deleteTarget({ target }) {
      await kernel.transaction(async () => {
        for (const table of [t.state, t.watermarks] as const) {
          await kernel.run(db => db.deleteFrom(table).where("site_id", "=", target.siteId)
            .where("provider_id", "=", target.providerId).where("generation", "=", target.generation).execute());
        }
      });
    }
  };
}
async function readIndexCounts({ kernel, t }: { kernel: IndexKernel; t: TypedTables }, { target }: Parameters<SearchIndexStatePort['counts']>[0]): Promise<SearchStatusCounts> {
      const rows = await kernel.run(db => db.selectFrom(t.state)
        .select(eb => ["status", eb.fn.countAll<Big>().as("n")])
        .where("site_id", "=", target.siteId).where("provider_id", "=", target.providerId)
        .where("generation", "=", target.generation).groupBy("status").execute());
      const counts = Object.fromEntries(STATUSES.map(status => [status, 0])) as Record<SearchIndexStatus, number>;
      for (const row of rows) counts[row.status as SearchIndexStatus] = Number(row.n);
      return counts as SearchStatusCounts;
    }



/** The bookkeeping half. @complexity each method is one indexed statement (deleteTarget: two). */
function createIndexState({ kernel, t }: { kernel: IndexKernel; t: TypedTables }): SearchIndexStatePort {
  const scoped = (target: SearchTarget) => ({ site_id: target.siteId, provider_id: target.providerId, generation: target.generation });
  return {
    async get({ target, key }) {
      const row = await kernel.run(db => db.selectFrom(t.state).selectAll()
        .where("site_id", "=", target.siteId).where("provider_id", "=", target.providerId)
        .where("generation", "=", target.generation).where("doc_key", "=", encodeSearchKey({ key }))
        .executeTakeFirst());
      return row ? toStateRow(row) : null;
    },
    async put({ row }) {
      const values = toStateColumns(row);
      const { site_id: _s, provider_id: _p, generation: _g, doc_key: _k, ...updatable } = values;
      const result = await kernel.run(db => db.insertInto(t.state).values(values)
        .onConflict(oc => oc.columns(["site_id", "provider_id", "generation", "doc_key"]).doUpdateSet(updatable)
          .where(`${t.state}.revision` as "search_index_state.revision", "<=", row.revision))
        .executeTakeFirst());
      return Number(result.numInsertedOrUpdatedRows ?? 0n) === 1;
    },
    /**
     * Compare-and-swap settle: ONE UPDATE that matches only while the stored row still carries the
     * observed revision and task, so an older write's completion never replaces a newer revision's
     * bookkeeping. @complexity O(1), one primary-key UPDATE.
     */
    async settle({ row, expected }) {
      const values = toStateColumns(row);
      const { site_id: _s, provider_id: _p, generation: _g, doc_key: _k, ...updatable } = values;
      const result = await kernel.run(db => db.updateTable(t.state).set(updatable)
        .where("site_id", "=", values.site_id).where("provider_id", "=", values.provider_id)
        .where("generation", "=", values.generation).where("doc_key", "=", values.doc_key)
        .where("revision", "=", expected.revision)
        .where("task_id", expected.taskId === null ? "is" : "=", expected.taskId)
        .executeTakeFirst());
      return Number(result.numUpdatedRows) === 1;
    },
    async listByStatus({ target, statuses, limit }, { failedBelowAttempts } = {}) {
      // `IN ()` is not valid SQL; asking for no status matches no row.
      if (statuses.length === 0) return [];
      const rows = await kernel.run(db => {
        const candidates = db.selectFrom(t.state).selectAll()
          .where("site_id", "=", target.siteId).where("provider_id", "=", target.providerId)
          .where("generation", "=", target.generation).where("status", "in", [...statuses]);
        // Exhausted failures leave the candidate set BEFORE the limit, so they cannot starve the rest.
        const retryable = failedBelowAttempts === undefined
          ? candidates
          : candidates.where((eb: ExpressionBuilder<SearchIndexDatabase, "search_index_state">) =>
            eb.or([eb("status", "!=", "failed"), eb("attempts", "<", failedBelowAttempts)]));
        // Oldest first so a retry sweep reaches every row, with the key breaking ties stably.
        return retryable.orderBy("updated_at_ms", "asc").orderBy("doc_key", "asc").limit(limit).execute();
      });
      return rows.map(toStateRow);
    },
    counts: input => readIndexCounts({ kernel, t }, input),
    ...createIndexWatermarks({ kernel, t }, scoped),
  };
}

/**
 * ONE compare-and-swap statement: the building pointer must still be `expected` AND the active
 * pointer still `active` (as just read), so the caller's `replaced` is exactly what this switch
 * displaced. A concurrent promote, rebuild or clear changes one of them first and no row updates.
 * @complexity O(1), one primary-key UPDATE.
 */
async function swapPointers(
  { kernel, t }: { kernel: IndexKernel; t: TypedTables },
  required: { siteId: string; expected: SearchTarget; active: SearchTarget | null; nowMs: number },
): Promise<boolean> {
  const { siteId, expected, active, nowMs } = required;
  const result = await kernel.run(db => {
    const swap = db.updateTable(t.targets)
      .set(({ ref }) => ({
        active_provider_id: ref("building_provider_id"), active_generation: ref("building_generation"),
        building_provider_id: null, building_generation: null, updated_at_ms: nowMs,
      }))
      .where("site_id", "=", siteId)
      .where("building_provider_id", "=", expected.providerId).where("building_generation", "=", expected.generation);
    return (active === null
      ? swap.where("active_provider_id", "is", null)
      : swap.where("active_provider_id", "=", active.providerId).where("active_generation", "=", active.generation))
      .executeTakeFirst();
  });
  return Number(result.numUpdatedRows) === 1;
}

/** The pointer half. `promote` is the atomic generation switch. @complexity O(1) per call. */
function createTargets({ kernel, t, now }: { kernel: IndexKernel; t: TypedTables; now: () => number }, _optional = {}): SearchTargetPort {
  const retainRetired = async ({ siteId, active }: { siteId: string; active: SearchTarget }, _options = {}) => {
    await kernel.run(db => db.insertInto(t.retired)
      .values({ site_id: siteId, provider_id: active.providerId, generation: active.generation, retired_at_ms: now() })
      .onConflict(oc => oc.columns(["site_id", "provider_id", "generation"]).doNothing()).execute());
  };
  const read = async ({ siteId }: { siteId: string }, _optional = {}): Promise<SearchSiteTargets> => {
    const row = await kernel.run(db => db.selectFrom(t.targets).selectAll().where("site_id", "=", siteId).executeTakeFirst());
    if (!row) return { active: null, building: null };
    return {
      active: toTarget({ siteId, providerId: row.active_provider_id, generation: row.active_generation }),
      building: toTarget({ siteId, providerId: row.building_provider_id, generation: row.building_generation }),
    };
  };
  return {
    get: ({ siteId }) => read({ siteId }),
    async setBuilding({ target }) {
      const building = { building_provider_id: target.providerId, building_generation: target.generation, updated_at_ms: now() };
      await kernel.run(db => db.insertInto(t.targets)
        .values({ site_id: target.siteId, active_provider_id: null, active_generation: null, ...building })
        .onConflict(oc => oc.column("site_id").doUpdateSet(building)).execute());
    },
    promote: ({ siteId, expected }) => kernel.transaction(async () => {
      const { active } = await read({ siteId });
      const swapped = await swapPointers({ kernel, t }, { siteId, expected, active, nowMs: now() });
      if (!swapped) return false;
      // Same transaction as the switch: the replaced index is dropped later even if this process dies now.
      if (active !== null) {
        await retainRetired({ siteId, active });
      }
      return { replaced: active };
    }),
    async listRetired({ siteId }) {
      const rows = await kernel.run(db => db.selectFrom(t.retired).select(["provider_id", "generation"])
        .where("site_id", "=", siteId).orderBy("retired_at_ms", "asc").orderBy("provider_id", "asc").orderBy("generation", "asc").execute());
      return rows.map(row => ({ siteId, providerId: row.provider_id, generation: Number(row.generation) }));
    },
    async forgetRetired({ target }) {
      await kernel.run(db => db.deleteFrom(t.retired).where("site_id", "=", target.siteId)
        .where("provider_id", "=", target.providerId).where("generation", "=", target.generation).execute());
    },
    async clearBuilding({ siteId }) {
      await kernel.run(db => db.updateTable(t.targets)
        .set({ building_provider_id: null, building_generation: null, updated_at_ms: now() })
        .where("site_id", "=", siteId).execute());
    },
  };
}

/**
 * The SQL search-index store on one content database.
 * @example const { indexState, targets } = createSqlSearchIndexStore({ kernel, now: clock.nowMs, tables });
 * @complexity O(1) to build; see each half for per-call cost.
 */
export function createSqlSearchIndexStore(
  required: { readonly kernel: StorageKernel<Kysely<unknown>, unknown>; readonly now: () => number; readonly tables: SearchIndexTables },
  _optional: Record<string, never> = {},
): SqlSearchIndexStore {
  // The host kernel is typed against its own schema, which never lists these raw-SQL tables; the
  // same kernel is re-typed for them, and the injected names are typed as their literal keys
  // (Kysely types are compile-time only, the real names reach the SQL).
  const kernel = required.kernel as unknown as IndexKernel;
  const t = required.tables as unknown as TypedTables;
  return { indexState: createIndexState({ kernel, t }), targets: createTargets({ kernel, t, now: required.now }) };
}
