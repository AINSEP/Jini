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
  "0001_payments_ledger": "484498a844675099a2cd1b6ddcaba4e2b0f2293597b4c4a8be81458bc9424749",
  "0002_payments_operator_actions": "b25706b7606c5e9be93eba63ae2a415cf81212307e06bf511f158a14701aa74d",
};
