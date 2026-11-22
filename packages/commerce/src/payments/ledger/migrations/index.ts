import type { Kysely } from "kysely";
import type { Clock } from "@jini-ai/core/primitives";
import type { MigrationContext, MigrationStep, StorageKernel } from "@jini-ai/core/contracts/storage";

import { paymentsLedger } from "./0001_payments_ledger.js";
import { paymentsOperatorActions } from "./0002_payments_operator_actions.js";
import { paymentsAttemptRecovery } from "./0004_payments_attempt_recovery.js";
import { paymentsIntentReplay } from "./0005_payments_intent_replay.js";
import { COMMERCE_PAYMENTS_MIGRATION_CHECKSUMS } from "./checksums.js";

/**
 * @file The payments ledger's migration history, in order, and its runner entry. A host
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
  const checksums = optional.checksums ?? COMMERCE_PAYMENTS_MIGRATION_CHECKSUMS;
  const checksum = Object.hasOwn(checksums, required.id) ? checksums[required.id] : undefined;
  if (checksum === undefined) throw new Error(`commerce payments migration ${required.id} has no pinned checksum in checksums.ts`);
  return checksum;
}

/** The kernel every payments step really needs: each step body only calls `kernel.run(db => db.schema…)`. */
export type PaymentsMigrationKernel = StorageKernel<Kysely<unknown>, unknown>;

/**
 * The options the host's migration runner accepts, minus `ledgerTable` (this history owns it).
 * Copied field by field from `@jini-ai/db`'s `MigrationOptions` because core has no options type and
 * this package no longer imports db; `migrations.options.typecheck.ts` fails when the two drift.
 */
export interface PaymentsMigrationOptions {
  allowUnknownApplied?: boolean;
  backupPath?: string;
  onBackupError?: MigrationContext["onBackupError"];
  onBackupComplete?: MigrationContext["onBackupComplete"];
  schema?: string;
  appName?: string;
  atomicity?: "step" | "batch";
  historyCheck?: "known" | "ordered-prefix";
  clock?: Clock;
  legacyLedger?: {
    columns: { version: string; name: string; checksum: string; appliedAt: string };
    identities: Readonly<Record<string, { version: number; name: string }>>;
    timestamps?: "database-default" | "iso";
  };
}

/** The host's migration runner (db's `runMigrations`). Positional on purpose: it is db's own shape. */
export type PaymentsMigrationRunner<Kernel extends PaymentsMigrationKernel, Report> = (
  kernel: Kernel,
  steps: readonly MigrationStep<PaymentsMigrationKernel>[],
  options: PaymentsMigrationOptions & { readonly ledgerTable: string },
) => Promise<Report>;

export const COMMERCE_PAYMENTS_MIGRATIONS: readonly MigrationStep<PaymentsMigrationKernel>[] = [
  paymentsLedger({ checksum: pinnedChecksum({ id: "0001_payments_ledger" }) }),
  paymentsOperatorActions({ checksum: pinnedChecksum({ id: "0002_payments_operator_actions" }) }),
  paymentsAttemptRecovery({ checksum: pinnedChecksum({ id: "0004_payments_attempt_recovery" }) }),
  paymentsIntentReplay({ checksum: pinnedChecksum({ id: "0005_payments_intent_replay" }) }),
];

/**
 * Applies every pending payments-ledger step to `kernel`'s database (idempotent: a rerun applies
 * nothing). `optional` passes through to the host's runner (e.g. `backupPath`), except the ledger
 * table, which this history owns: the spread order below is behaviour, a caller cannot override the
 * ledger (and so the migration lock's identity). There is no legacy lipay import: the owner ruled the
 * retired lipay code and data wrong (2026-10-21), so its rows are never migrated into this ledger.
 */
export function migrateCommercePayments<Kernel extends PaymentsMigrationKernel, Report>(
  required: { kernel: Kernel; runMigrations: PaymentsMigrationRunner<Kernel, Report> },
  optional: PaymentsMigrationOptions = {}
): Promise<Report> {
  return required.runMigrations(required.kernel, COMMERCE_PAYMENTS_MIGRATIONS, { ...optional, ledgerTable: COMMERCE_PAYMENTS_LEDGER_TABLE });
}
