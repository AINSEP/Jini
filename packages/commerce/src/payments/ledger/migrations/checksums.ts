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
  "0004_payments_attempt_recovery": "902fb1230f456c3420e64c2093cbdbc0ab18ee65184febdc777c76a0574bbe4c",
  "0005_payments_intent_replay": "7d49e170dbe7f7b89befc1bcc0d02429e0bbc6f169b3c7c597469038b15bbbac",
};

/** sha256 of each step file's normalized source as it stands now (the edit guard). It differs from the ledger
 * checksum above only after a reviewed edit that changes no behavior (2026-11-15, C3: import specifiers and kernel
 * type arguments). The ledger checksum is what databases recorded; it never changes. */
export const COMMERCE_PAYMENTS_SOURCE_DIGESTS: Readonly<Record<string, string>> = {
  "0001_payments_ledger": "f47c10d3e9f452afcced611376bb3b87f4a8af25d42b2c037828107d7836aed5",
  "0002_payments_operator_actions": "6eb5c38d18650b2759876abbce57e9863f208221ee29e9e95af39473399c3da0",
  "0004_payments_attempt_recovery": "7c0b2e6b9fab580dd21504d4a67ba97713cf2b67b8b5fd816cfe9f91e6bb9101",
  "0005_payments_intent_replay": "25886c9450c6524a4a8b1fbc41897ba7a4250518b8480257f70d53ea0e8702ec",
};
