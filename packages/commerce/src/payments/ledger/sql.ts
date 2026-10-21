/**
 * @file The payments ledger's SQL half: the `@jini-ai/db` storage-kernel adapter and the ADR-066
 * migration history. Kept out of the `payments/kernel` barrel because it loads `kysely` and
 * `@jini-ai/db` at runtime (optional peers); a host that persists payments imports this.
 */
export { constraintKindOf, sqlPaymentsLedger } from "./repo.sql.js";
export {
  COMMERCE_PAYMENTS_LEDGER_TABLE, COMMERCE_PAYMENTS_MIGRATIONS, migrateCommercePayments, pinnedChecksum,
} from "./migrations/index.js";
export { PAYMENTS_LEDGER_ID, paymentsLedger } from "./migrations/0001_payments_ledger.js";
export { PAYMENTS_OPERATOR_ACTIONS_ID, paymentsOperatorActions } from "./migrations/0002_payments_operator_actions.js";
export {
  LEGACY_LIPAY_IMPORT_ID, legacyLipayImport, readLegacyLipayHistory,
  type LegacyLipayHistory, type LegacyLipayMapping, type LegacyLipayScope,
} from "./migrations/0005_legacy_lipay_import.js";
