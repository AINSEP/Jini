/**
 * @file Pinned checksums of the payments ledger's migration steps (ADR-066 §3). The runner records
 * these in `commerce_payments_migrations` and refuses a database whose recorded checksum differs.
 * `../__tests__/migrations.vitest.test.ts` re-derives each from its `NNNN_name.ts` source (comments
 * removed, whitespace collapsed, sha256 via `sourceChecksum`), so an edit to a shipped step goes red
 * instead of silently differing between databases. Pinned rather than computed at runtime: tsx runs
 * the `.ts` and production runs tsc output, which would hash differently.
 *
 * Add new ids with `UPDATE_COMMERCE_PAYMENTS_CHECKSUMS=1`; the updater never changes an existing one.
 */
export const COMMERCE_PAYMENTS_MIGRATION_CHECKSUMS: Readonly<Record<string, string>> = {
  "0001_payments_ledger": "ae31911eaebaab4e0060a17f8ebf36e74c98050d1572409c3c9655e1ed3ec4b3",
};
