/**
 * @file `@jini-ai/db/migrate`: one migration runner for every dialect. The consumer owns its steps,
 * their pinned checksums and the ledger table's name (required, no default).
 */
export { assertValidSteps, hasLedger, migrate, type MigrationOptions, type MigrationReport, runMigrations } from "./runner.js";
export type { LegacyLedgerMapping } from "./legacy-ledger.js";
export {
  MIGRATION_ID,
  MigrationChecksumError,
  type MigrationContext,
  type MigrationStep,
  UnknownAppliedMigrationError,
} from "./step.js";
export { sourceChecksum } from "./checksum.js";
