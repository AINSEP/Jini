import type { MigrationStep } from "@jini-ai/db/migrate";
import type { StorageKernel } from "@jini-ai/db/kernel";

/**
 * @file Payments ledger step 4 (ADR-066; L4 review fixes R2-F4 and R2-F8): what a capture/void
 * attempt needs to be compared on replay and recovered after a lost response. Same portable-DDL
 * rules as `0001_payments_ledger` (TEXT/BIGINT only). Earlier steps are frozen, so the columns and
 * the index are added here.
 *
 * - `commerce_payment_attempts.currency` / `.amount_minor` (both NULL-able): the amount a capture
 *   requested. A replay of the same idempotency key with another amount is an
 *   `IDEMPOTENCY_CONFLICT`, not a silent success. NULL for ops without an amount (void, intent,
 *   refund — the refund row holds its own) and for attempts written before this step.
 * - `commerce_payment_attempts_open` (outcome, updated_at): the reconciler lists stale
 *   `dispatched`/`unknown` capture and void attempts (a lost response leaves the payment authorized
 *   and only the attempt knows a call went out).
 *
 * Frozen once shipped: its checksum is pinned in `checksums.ts`.
 */
export const PAYMENTS_ATTEMPT_RECOVERY_ID = "0004_payments_attempt_recovery";

async function up(kernel: StorageKernel<unknown>): Promise<void> {
  await kernel.run((db) => db.schema.alterTable("commerce_payment_attempts").addColumn("currency", "text").execute());
  await kernel.run((db) => db.schema.alterTable("commerce_payment_attempts").addColumn("amount_minor", "bigint").execute());
  await kernel.run((db) => db.schema.createIndex("commerce_payment_attempts_open").on("commerce_payment_attempts").columns(["outcome", "updated_at"]).execute());
}

/** The step, carrying its pinned checksum. @example paymentsAttemptRecovery({ checksum }) */
export function paymentsAttemptRecovery(required: { checksum: string }, _optional: Record<string, never> = {}): MigrationStep {
  return { id: PAYMENTS_ATTEMPT_RECOVERY_ID, checksum: required.checksum, up };
}
