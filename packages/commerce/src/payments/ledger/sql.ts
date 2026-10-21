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
