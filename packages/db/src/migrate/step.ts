/**
 * @file The migration identity rule and the runner's errors. The step contract itself
 * (`MigrationStep`, `MigrationContext`) is `@jini-ai/core/contracts/storage`; the runner (`runner.ts`) by default
 * applies each pending step in its own transaction and records it in the consumer's ledger table.
 */

/** `NNNN_snake_name`. Ordered by the number; never renamed or reused once shipped. */
export const MIGRATION_ID = /^\d{4}_[a-z0-9_]+$/;

/** An applied step's recorded checksum differs from this runtime's: the step was edited after shipping. */
export class MigrationChecksumError extends Error {
  constructor(
    readonly id: string,
    readonly recorded: string,
    readonly expected: string
  ) {
    super(`migration ${id} was applied with checksum ${recorded}, but this runtime's ${id} has ${expected}; an applied migration must never change`);
    this.name = "MigrationChecksumError";
  }
}

/** The database records steps this runtime does not have: it was migrated by a newer version of the app. */
export class UnknownAppliedMigrationError extends Error {
  /** @param appName names the app in the message ("a newer <appName>"); default "version". */
  constructor(
    readonly ids: readonly string[],
    appName?: string
  ) {
    super(`the database has migrations this runtime does not know (${ids.join(", ")}); it was upgraded by a newer ${appName ?? "version"} — run that version`);
    this.name = "UnknownAppliedMigrationError";
  }
}
