import type { DataModuleDecl } from "@jini-ai/core/contracts/site/db-data-modules";
const STORE_PLUGIN_ID = "store";
/**
 * The publisher is the HOST's first-party id, not the engine's: it is persisted in `_plugin_identity`
 * and compared strictly on every boot (`checkNamespaceAdoption`), so a site that already minted the
 * `store` row under its host's id must keep declaring that id. Changing it is a data migration.
 */
export function createStoreManifest(required: { publisher: string }, _optional: Record<string, never> = {}): DataModuleDecl {
  return {
    pluginId: STORE_PLUGIN_ID,
    pluginTier: "tier-2",
    provenance: { sourceUrl: "builtin://store", publisher: required.publisher },
    tables: STORE_TABLES,
  };
}
const STORE_TABLES: DataModuleDecl["tables"] = [
  {
    name: "products",
    columns: [
      { name: "id", type: "TEXT", primaryKey: true },
      { name: "title", type: "TEXT", notNull: true },
      { name: "price", type: "INTEGER", notNull: true },
      { name: "stock", type: "INTEGER", notNull: true },
      { name: "version", type: "INTEGER", notNull: true },
    ],
  },
  {
    name: "orders",
    columns: [
      { name: "id", type: "TEXT", primaryKey: true },
      { name: "product_id", type: "TEXT", notNull: true },
      { name: "qty", type: "INTEGER", notNull: true },
      { name: "total", type: "INTEGER", notNull: true },
      { name: "at", type: "INTEGER", notNull: true },
    ],
  },
];
