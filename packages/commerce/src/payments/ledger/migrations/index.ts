import { type MigrationOptions, type MigrationReport, type MigrationStep, runMigrations } from "@jini-ai/db/migrate";
import type { StorageKernel } from "@jini-ai/db/kernel";

import { paymentsLedger } from "./0001_payments_ledger.js";
import { paymentsOperatorActions } from "./0002_payments_operator_actions.js";
import { paymentsAttemptRecovery } from "./0004_payments_attempt_recovery.js";
import { COMMERCE_PAYMENTS_MIGRATION_CHECKSUMS } from "./checksums.js";

/**
 * @file The payments ledger's migration history (ADR-066), in order, and its runner entry. A host
 * calls {@link migrateCommercePayments} with its own storage kernel at boot; the history keeps its
 * own ledger table, so it never collides with the host's content migrations in the same database.
 *
 * Add a step as `NNNN_name.ts` exporting a factory taking its pinned checksum, append it here, and
 * pin it with `UPDATE_COMMERCE_PAYMENTS_CHECKSUMS=1` (see `checksums.ts`).
 */

/** The ledger table this history is recorded in (and the migration lock key). */
export const COMMERCE_PAYMENTS_LEDGER_TABLE = "commerce_payments_migrations";

/** The pinned checksum for `id`; a step without one is a programming error caught at import. */
export function pinnedChecksum(
  required: { id: string },
  optional: { checksums?: Readonly<Record<string, string>> } = {}
): string {
  const checksum = (optional.checksums ?? COMMERCE_PAYMENTS_MIGRATION_CHECKSUMS)[required.id];
  if (checksum === undefined) throw new Error(`commerce payments migration ${required.id} has no pinned checksum in checksums.ts`);
  return checksum;
}

export const COMMERCE_PAYMENTS_MIGRATIONS: readonly MigrationStep[] = [
  paymentsLedger({ checksum: pinnedChecksum({ id: "0001_payments_ledger" }) }),
  paymentsOperatorActions({ checksum: pinnedChecksum({ id: "0002_payments_operator_actions" }) }),
  paymentsAttemptRecovery({ checksum: pinnedChecksum({ id: "0004_payments_attempt_recovery" }) }),
];

/**
 * Applies every pending payments-ledger step to `kernel`'s database (idempotent: a rerun applies
 * nothing). `optional` passes through to `runMigrations` (e.g. `backupPath`), except the ledger
 * table, which this history owns.
 */
export function migrateCommercePayments(
  required: { kernel: StorageKernel<unknown> },
  optional: Omit<MigrationOptions, "ledgerTable"> = {}
): Promise<MigrationReport> {
  return runMigrations(required.kernel, COMMERCE_PAYMENTS_MIGRATIONS, { ...optional, ledgerTable: COMMERCE_PAYMENTS_LEDGER_TABLE });
}
