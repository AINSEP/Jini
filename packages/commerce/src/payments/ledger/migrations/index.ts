import { type MigrationOptions, type MigrationReport, type MigrationStep, runMigrations } from "@jini-ai/db/migrate";
import type { StorageKernel } from "@jini-ai/db/kernel";

import { paymentsLedger } from "./0001_payments_ledger.js";
import { paymentsOperatorActions } from "./0002_payments_operator_actions.js";
import { paymentsAttemptRecovery } from "./0004_payments_attempt_recovery.js";
import { LEGACY_LIPAY_IMPORT_ID, legacyLipayImport, type LegacyLipayMapping } from "./0005_legacy_lipay_import.js";
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
  legacyLipayImport({ checksum: pinnedChecksum({ id: LEGACY_LIPAY_IMPORT_ID }) }),
];

/** The history with the host's legacy-lipay mapping bound into step 5 (same id and checksum). */
function withLegacyLipay(mapping: LegacyLipayMapping | undefined): readonly MigrationStep[] {
  if (mapping === undefined) return COMMERCE_PAYMENTS_MIGRATIONS;
  return COMMERCE_PAYMENTS_MIGRATIONS.map((step) => (step.id === LEGACY_LIPAY_IMPORT_ID ? legacyLipayImport({ checksum: step.checksum }, { mapping }) : step));
}

/**
 * Applies every pending payments-ledger step to `kernel`'s database (idempotent: a rerun applies
 * nothing). `optional` passes through to `runMigrations` (e.g. `backupPath`), except the ledger
 * table, which this history owns. `optional.legacyLipay` names the site, provider account and mode
 * of a retired lipay install's rows (step `0005_legacy_lipay_import`); it is needed only when
 * `p_lipay__payments` holds rows, and that step fails without it rather than guess.
 */
export function migrateCommercePayments(
  required: { kernel: StorageKernel<unknown> },
  optional: Omit<MigrationOptions, "ledgerTable"> & { legacyLipay?: LegacyLipayMapping } = {}
): Promise<MigrationReport> {
  const { legacyLipay, ...options } = optional;
  return runMigrations(required.kernel, withLegacyLipay(legacyLipay), { ...options, ledgerTable: COMMERCE_PAYMENTS_LEDGER_TABLE });
}
