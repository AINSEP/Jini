import { ownerStoreMigration } from "./0000_owner_store.js";

/** Independent history: a site migration ledger must never govern this database. Read-only now:
 * no host opens an owner store for writing, so this history only describes legacy files.
 */
export const OWNER_STORE_LEDGER = "owner_migrations";
export const ownerStoreMigrations = [ownerStoreMigration] as const;
