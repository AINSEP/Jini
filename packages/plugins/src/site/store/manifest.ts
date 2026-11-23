import type { DataModuleDecl } from "@jini-ai/core/contracts/site/db-data-modules";
const STORE_PLUGIN_ID = "store";
export const STORE_MANIFEST: DataModuleDecl = {
  pluginId: STORE_PLUGIN_ID,
  pluginTier: "tier-2",
  provenance: { sourceUrl: "builtin://store", publisher: "jini-core" },
  tables: [
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
  ],
};
