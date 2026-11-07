import type { Generated } from "kysely";

import type { StorageKernel } from "../kernel/index.js";

/**
 * @file The database a plugin data module works on: the storage kernel, whichever driver is
 * underneath (ADR-066). The core's own `_plugin_*` bookkeeping tables are typed here; the plugins'
 * own `p_{pluginId}__*` tables are declared at runtime and reached through raw kernel statements.
 */

/**
 * A composed kernel over ANY table typing (a `ContentKernel`, a `PluginKernel`…). `any`: a `Kysely<DB>` is invariant in
 * `DB`, so no narrower type admits every kernel; the engine only reads its own tables through it.
 */
export type PluginStore = StorageKernel<any>;

export interface PluginCoreTables {
  _plugin_migration_journal: {
    id: Generated<number>;
    plugin_id: string;
    phase: string;
    snapshot_path: string;
    started_at: number;
    updated_at: number;
  };
  _plugin_identity: {
    plugin_id: string;
    source_url: string;
    publisher: string;
    signature: string | null;
    minted_at: number;
  };
  _plugin_migrations: {
    id: Generated<number>;
    plugin_id: string;
    table_name: string;
    ddl: string;
    snapshot_path: string | null;
    at: number;
  };
}

export type PluginKernel = StorageKernel<PluginCoreTables>;

/** The composed kernel behind `store`, viewed through the plugin table contract. */
export function pluginKernel(
  { store }: { store: PluginStore },
  _optional: Record<string, never> = {}
): PluginKernel {
  // The type parameter only names the tables Kysely checks queries against; the kernel is the same.
  return store as unknown as PluginKernel;
}
