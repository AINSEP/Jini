import type { Kysely, Selectable } from "kysely";
import type { StorageKernel } from "@jini-ai/core/contracts/storage";

import type { PublishContentBaselineRecord, PublishContentBaselineRepoPort } from "../baseline-repo.js";

/**
 * @file THE `PublishContentBaselineRepoPort` adapter over the host's publish-content baselines
 * table (migration `0066` in the first host): one Kysely query body for every dialect (storage
 * plan §4). Publish-content task 7 (`ADS-memory/reports/2026-09-18-publish-feature-implementation-plan.md` §2/§4).
 * `upsert` targets the table's own 4-column unique index
 * (`workspace_id, peer_principal_id, entity_type, entity_id`). The host injects the table name and a
 * schema-erased kernel; its thin binding builds this class from its content db handle.
 */

/** Host-owned table name. No schema or product table default lives in the adapter. */
export interface PublishContentBaselineTables { baselines: string }

/** The structural row this adapter reads and writes; the host's generated table type must match it. */
export interface PublishContentBaselinesTable {
  workspace_id: string;
  peer_principal_id: string;
  entity_type: string;
  entity_id: string;
  hash_at_last_sync: string;
  hash_version: number;
  synced_at: string;
  run_id: string;
}

export interface PublishContentBaselineSqlRequired {
  kernel: StorageKernel<Kysely<unknown>, unknown>;
  tables: PublishContentBaselineTables;
}

/** @complexity O(1) — fixed-shape field mapping, no iteration. */
function toRecord(row: Selectable<PublishContentBaselinesTable>): PublishContentBaselineRecord {
  return {
    workspaceId: row.workspace_id,
    peerPrincipalId: row.peer_principal_id,
    entityType: row.entity_type,
    entityId: row.entity_id,
    hashAtLastSync: row.hash_at_last_sync,
    hashVersion: row.hash_version,
    syncedAt: row.synced_at,
    runId: row.run_id,
  };
}

/** The adapter's narrow typed view of the schema-erased kernel's connection. */
function view(db: Kysely<unknown>) {
  return db.withTables<Record<string, PublishContentBaselinesTable>>();
}

export class SqlPublishContentBaselineRepo implements PublishContentBaselineRepoPort {
  protected readonly kernel: StorageKernel<Kysely<unknown>, unknown>;
  protected readonly tables: PublishContentBaselineTables;

  constructor({ kernel, tables }: PublishContentBaselineSqlRequired, _optional: Record<string, never> = {}) {
    this.kernel = kernel;
    this.tables = tables;
  }

  async findOne(input: {
    workspaceId: string;
    peerPrincipalId: string;
    entityType: string;
    entityId: string;
  }): Promise<PublishContentBaselineRecord | null> {
    const row = await this.kernel.run((db) =>
      view(db)
        .selectFrom(this.tables.baselines)
        .selectAll()
        .where("workspace_id", "=", input.workspaceId)
        .where("peer_principal_id", "=", input.peerPrincipalId)
        .where("entity_type", "=", input.entityType)
        .where("entity_id", "=", input.entityId)
        .limit(1)
        .executeTakeFirst()
    );
    return row ? toRecord(row) : null;
  }

  async upsert({ record }: { record: PublishContentBaselineRecord }): Promise<void> {
    const columns = {
      workspace_id: record.workspaceId,
      peer_principal_id: record.peerPrincipalId,
      entity_type: record.entityType,
      entity_id: record.entityId,
      hash_at_last_sync: record.hashAtLastSync,
      hash_version: record.hashVersion,
      synced_at: record.syncedAt,
      run_id: record.runId,
    };
    await this.kernel.run((db) =>
      view(db)
        .insertInto(this.tables.baselines)
        .values(columns)
        .onConflict((oc) =>
          oc.columns(["workspace_id", "peer_principal_id", "entity_type", "entity_id"]).doUpdateSet(columns)
        )
        .execute()
    );
  }
}
