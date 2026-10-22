import type { StorageKernel } from "@jini-ai/db/kernel";
import type { PluginActivationTable } from "./repo.rows.js";
export interface PluginActivationDatabase { [table: string]: PluginActivationTable }
export interface PluginActivationSqlRequired {
  readonly kernel: StorageKernel<PluginActivationDatabase>;
  readonly tables: { readonly activations: string };
}
import type { PluginActivationRecord, PluginActivationRepoPort } from "../activation.js";
import { toActivationRecord, toActivationRow } from "./repo.rows.js";

/**
 * @file THE `PluginActivationRepoPort` adapter: one Kysely query body for every database the
 * storage kernel drives (SQLite, PGlite, Postgres). One row per (workspace, plugin); `save` upserts
 * on that key. Every statement goes through `kernel.run` and is awaited. Satisfies
 * `__tests__/integration/repo.contract.test.ts`, the suite `repo.memory.ts` runs identically.
 */
export class SqlPluginActivationRepo implements PluginActivationRepoPort {
  protected readonly kernel: StorageKernel<PluginActivationDatabase>;
  protected readonly tables: { readonly activations: string };
  constructor(required: PluginActivationSqlRequired, _optional: Record<string, never> = {}) {
    this.kernel = required.kernel;
    this.tables = required.tables;
  }

  async getActivation(required: { workspaceId: string; pluginId: string }, _optional: Record<string, never> = {}): Promise<PluginActivationRecord | null> {
    const row = await this.kernel.run((db) =>
      db
        .selectFrom(this.tables.activations)
        .selectAll()
        .where("workspace_id", "=", required.workspaceId)
        .where("plugin_id", "=", required.pluginId)
        .limit(1)
        .executeTakeFirst()
    );
    return row ? toActivationRecord({ row }) : null;
  }

  async save(record: PluginActivationRecord, _optional: Record<string, never> = {}): Promise<void> {
    const row = toActivationRow({ record });
    const { workspace_id: _workspaceId, plugin_id: _pluginId, ...set } = row;
    await this.kernel.run((db) =>
      db
        .insertInto(this.tables.activations)
        .values(row)
        .onConflict((oc) => oc.columns(["workspace_id", "plugin_id"]).doUpdateSet(set))
        .execute()
    );
  }

  async deleteActivation(required: { workspaceId: string; pluginId: string }, _optional: Record<string, never> = {}): Promise<void> {
    await this.kernel.run((db) =>
      db
        .deleteFrom(this.tables.activations)
        .where("workspace_id", "=", required.workspaceId)
        .where("plugin_id", "=", required.pluginId)
        .execute()
    );
  }

  async listAll(_required: Record<string, never> = {}, _optional: Record<string, never> = {}): Promise<PluginActivationRecord[]> {
    const rows = await this.kernel.run((db) => db.selectFrom(this.tables.activations).selectAll().execute());
    return rows.map((row) => toActivationRecord({ row }));
  }
}

/** The plugin-activation repo for `kernel`. */
export function pluginActivationRepoFor(required: PluginActivationSqlRequired, _optional: Record<string, never> = {}): SqlPluginActivationRepo {
  return new SqlPluginActivationRepo(required);
}
