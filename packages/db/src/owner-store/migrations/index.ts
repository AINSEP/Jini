import { ownerStoreMigration } from "./0000_owner_store.js";
import { ownerRevocationsMigration } from "./0001_owner_revocations.js";

/** Independent history: a site migration ledger must never govern this database. */
export const OWNER_STORE_LEDGER = "owner_migrations";
export const ownerStoreMigrations = [ownerStoreMigration, ownerRevocationsMigration] as const;
