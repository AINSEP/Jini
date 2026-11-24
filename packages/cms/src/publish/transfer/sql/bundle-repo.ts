import type { Generated, Kysely, Selectable } from "kysely";
import type { StorageKernel } from "@jini-ai/core/contracts/storage";

import type { PublishContentBundleRepoPort, StagedBundleRecord } from "../bundle-staging.js";

/**
 * @file THE `PublishContentBundleRepoPort` adapter over the host's publish-content bundles table
 * (migration `0066` in the first host): one Kysely query body for every dialect (storage plan §4).
 * Publish-content task 6 (`ADS-memory/reports/2026-09-18-publish-feature-implementation-plan.md`
 * §2/§4). A plain `INSERT` per write (a staged bundle has no group invariant across rows), a scoped
 * read by `(workspace_id, id)`. The host injects the table name and a schema-erased kernel; its thin
 * binding builds this class from its content db handle.
 */

/** Host-owned table name. No schema or product table default lives in the adapter. */
export interface PublishContentBundleTables { bundles: string }

/** The structural row this adapter reads and writes; the host's generated table type must match it. */
export interface PublishContentBundlesTable {
  id: string;
  workspace_id: string;
  source_principal_id: string;
  artifact_format_version: Generated<number>;
  hash_version: number;
  entities_json: string;
  blob_manifest_json: string;
  size_bytes: number;
  received_at: string;
  expires_at: string;
}

export interface PublishContentBundleSqlRequired {
  kernel: StorageKernel<Kysely<unknown>, unknown>;
  tables: PublishContentBundleTables;
}

/** @complexity O(1) — fixed-shape field mapping, no iteration. */
function toRecord(row: Selectable<PublishContentBundlesTable>): StagedBundleRecord {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    sourcePrincipalId: row.source_principal_id,
    artifactFormatVersion: row.artifact_format_version,
    hashVersion: row.hash_version,
    entitiesJson: row.entities_json,
    blobManifestJson: row.blob_manifest_json,
    sizeBytes: row.size_bytes,
    receivedAt: row.received_at,
    expiresAt: row.expires_at,
  };
}

/** The adapter's narrow typed view of the schema-erased kernel's connection. */
function view(db: Kysely<unknown>) {
  return db.withTables<Record<string, PublishContentBundlesTable>>();
}

export class SqlPublishContentBundleRepo implements PublishContentBundleRepoPort {
  protected readonly kernel: StorageKernel<Kysely<unknown>, unknown>;
  protected readonly tables: PublishContentBundleTables;

  constructor({ kernel, tables }: PublishContentBundleSqlRequired, _optional: Record<string, never> = {}) {
    this.kernel = kernel;
    this.tables = tables;
  }

  /** Append-only insert — a staged bundle id is minted fresh by `stageBundle` (`deps.idGen`), so
   *  this never needs to handle a duplicate-id conflict in practice (no transaction needed for a
   *  single-row append with no cross-row invariant). */
  async save({ record }: { record: StagedBundleRecord }): Promise<void> {
    await this.kernel.run((db) =>
      view(db)
        .insertInto(this.tables.bundles)
        .values({
          id: record.id,
          workspace_id: record.workspaceId,
          source_principal_id: record.sourcePrincipalId,
          artifact_format_version: record.artifactFormatVersion,
          hash_version: record.hashVersion,
          entities_json: record.entitiesJson,
          blob_manifest_json: record.blobManifestJson,
          size_bytes: record.sizeBytes,
          received_at: record.receivedAt,
          expires_at: record.expiresAt,
        })
        .execute()
    );
  }

  async findById(input: { workspaceId: string; id: string }): Promise<StagedBundleRecord | null> {
    const row = await this.kernel.run((db) =>
      view(db)
        .selectFrom(this.tables.bundles)
        .selectAll()
        .where("workspace_id", "=", input.workspaceId)
        .where("id", "=", input.id)
        .limit(1)
        .executeTakeFirst()
    );
    return row ? toRecord(row) : null;
  }

  async deleteExpired(input: { expiredBefore: string }): Promise<number> {
    const result = await this.kernel.run((db) =>
      view(db).deleteFrom(this.tables.bundles).where("expires_at", "<", input.expiredBefore).executeTakeFirst()
    );
    return Number(result.numDeletedRows);
  }
}
