/** Legacy owner database schema history; the read-only reader lives in @jini-ai/server/owner-store. */
export { OWNER_STORE_LEDGER, ownerStoreMigrations } from "./migrations/index.js";
export { ownerStoreDdl, ownerStoreMigration } from "./migrations/0000_owner_store.js";
