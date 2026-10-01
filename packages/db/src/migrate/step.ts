import type { StorageKernel } from "../kernel/index.js";

/**
 * @file What a migration step is. Steps form ONE ordered history for every dialect; the runner
 * (`runner.ts`) applies each pending one in its own transaction and records it in the consumer's
 * ledger table.
 */

/** `NNNN_snake_name`. Ordered by the number; never renamed or reused once shipped. */
export const MIGRATION_ID = /^\d{4}_[a-z0-9_]+$/;

export interface MigrationContext {
  /** Where the runner copied (or would copy) the database before the first pending step; the caller decides. */
  readonly backupPath?: string;
  /** Something worth telling the operator (a backup taken, a legacy tail applied). */
  note(message: string): void;
}

export interface MigrationStep {
  readonly id: string;
  /** sha256 hex of what the step does, pinned by the consumer (a test re-derives it with `sourceChecksum`). */
  readonly checksum: string;
  /** Runs OUTSIDE the transaction, only when the step is pending (backups: they cannot run inside one). */
  prepare?(kernel: StorageKernel<unknown>, context: MigrationContext): Promise<void>;
  /** Runs inside the step's transaction, after the runner holds the migration lock. */
  up(kernel: StorageKernel<unknown>, context: MigrationContext): Promise<void>;
}

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
