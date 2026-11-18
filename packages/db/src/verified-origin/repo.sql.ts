import type { Kysely } from "kysely";
import type { StorageKernel } from "@jini-ai/core/contracts/storage";
import type { OriginSettingRepoPort, VerifiedOrigin } from "@jini-ai/core/contracts/server/verified-origin";
import type { UUID } from "@jini-ai/core/primitives";
import { toVerifiedOrigin, type OriginRow, type OriginSettingsTable } from "./repo.rows.js";

/**
 * @file THE durable `OriginSettingRepoPort` adapter: one Kysely query body for every dialect the storage
 * kernel drives (SQLite, PGlite, Postgres). The read adapter is read-only by design (the port declares no
 * write method); the operator-declared origin write is the standalone `registerConfiguredOrigin`
 * (`register.ts`), not a port method.
 *
 * Writes are async (the kernel is), so a host may hand the read adapter its boot write's promise as `after`:
 * every read waits for it, and a boot write that failed fails the reads instead of letting them see a
 * half-booted row.
 */

/** Host-owned table name. No schema or product table default lives in the adapter. */
export interface OriginTables { origins: string }
export interface OriginSqlRequired {
  kernel: StorageKernel<Kysely<unknown>, unknown>;
  tables: OriginTables;
}
export interface OriginSqlOptional {
  /** Reads wait for it (the host's boot write); see the file header. */
  after?: Promise<unknown>;
}

export class SqlOriginSettingRepo implements OriginSettingRepoPort {
  protected readonly kernel: StorageKernel<Kysely<unknown>, unknown>;
  protected readonly tables: OriginTables;
  private readonly after: Promise<unknown> | undefined;
  constructor({ kernel, tables }: OriginSqlRequired, optional: OriginSqlOptional = {}) {
    this.kernel = kernel;
    this.tables = tables;
    this.after = optional.after;
  }

  private async row(workspaceId: UUID): Promise<OriginRow | undefined> {
    await this.after;
    return this.kernel.run((db) =>
      db
        .withTables<Record<string, OriginSettingsTable>>()
        .selectFrom(this.tables.origins)
        .selectAll()
        .where("workspace_id", "=", workspaceId)
        .executeTakeFirst()
    );
  }

  async findByWorkspaceId({ workspaceId }: { workspaceId: UUID }, _optional: Record<string, never> = {}): Promise<VerifiedOrigin | null> {
    const row = await this.row(workspaceId);
    return row ? toVerifiedOrigin(row) : null;
  }

  async findRedirectAllowlist({ workspaceId }: { workspaceId: UUID }, _optional: Record<string, never> = {}): Promise<string[]> {
    const row = await this.row(workspaceId);
    return row ? (JSON.parse(row.redirect_allowlist_json) as string[]) : [];
  }

  async findEgressAllowlist({ workspaceId }: { workspaceId: UUID }, _optional: Record<string, never> = {}): Promise<string[]> {
    const row = await this.row(workspaceId);
    return row ? (JSON.parse(row.egress_allowlist_json) as string[]) : [];
  }
}
