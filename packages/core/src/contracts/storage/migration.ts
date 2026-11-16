import type { StorageKernel } from "./kernel.js";

/**
 * @file What a migration step is. Steps form ONE ordered history for every dialect; the host's runner
 * (`@jini-ai/db/migrate` `runMigrations`) by default applies each pending one in its own transaction and records it in
 * the consumer's ledger table. A package ships steps as data from its storage-adapter subpath; it never runs them.
 */

export interface MigrationContext {
  /** Where the runner copied (or would copy) the database before the first pending step; the caller decides. */
  readonly backupPath?: string;
  /** A host may explicitly continue after selected backup failures; throwing preserves refusal. */
  readonly onBackupError?: (input: { error: unknown; backupPath: string }) => void;
  /** Runs only after the copy succeeds, before any step changes the source database. */
  readonly onBackupComplete?: (input: { backupPath: string }) => Promise<void>;
  /** Something worth telling the operator (a backup taken, a legacy tail applied). */
  note(message: string): void;
}

/** `Kernel` is the kernel the step's body needs; a step written against a query-builder handle is `MigrationStep<StorageKernel<ThatHandle<unknown>>>`. */
export interface MigrationStep<Kernel extends StorageKernel<unknown, unknown> = StorageKernel<unknown>> {
  readonly id: string;
  /** sha256 hex of what the step does, pinned by the consumer (a test re-derives it with `sourceChecksum`). */
  readonly checksum: string;
  /** Runs OUTSIDE the transaction, only when the step is pending (backups: they cannot run inside one). */
  prepare?(kernel: Kernel, context: MigrationContext): Promise<void>;
  /** Runs inside the step's transaction, after the runner holds the migration lock. */
  up(kernel: Kernel, context: MigrationContext): Promise<void>;
}
