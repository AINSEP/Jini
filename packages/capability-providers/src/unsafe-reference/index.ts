/**
 * `@jini-ai/capability-providers/unsafe-reference` — UNSAFE, NON-PRODUCTION
 * reference implementations. Read this before importing anything from this
 * directory.
 *
 * Every factory exported from this module (`createInMemoryAuthProvider`,
 * `createInMemoryStorageProvider`, `createInMemoryPaymentsProvider`,
 * `createInMemoryDbProvider`, `createInMemoryRealtimeProvider`) is a
 * minimal, non-cryptographic, in-memory reference stub whose only purpose
 * is to prove that the corresponding port interface in the package's normal
 * entry point (`@jini-ai/capability-providers`) is genuinely implementable and
 * unit-testable. None of them is, or is intended to become, a production
 * adapter:
 *
 * - `createInMemoryAuthProvider` stores passwords in plaintext and issues
 *   predictable, incrementing `user-N`/`session-N` identifiers — no
 *   hashing, no secure randomness, no rate limiting, no password policy.
 * - `createInMemoryPaymentsProvider` deterministically succeeds every
 *   charge (rejecting only a non-positive amount) — no real money moves,
 *   no idempotency, no replay protection.
 * - `createInMemoryStorageProvider`, `createInMemoryDbProvider`, and
 *   `createInMemoryRealtimeProvider` have no principal/tenant/ACL
 *   dimension, no quotas, and no size bounds — all state is unbounded,
 *   process-local memory.
 *
 * Do not wire any of these into anything that handles real credentials,
 * payments, or user data — not behind a feature flag, not "just for now,"
 * not in a demo that might get deployed. If you need a real adapter,
 * implement the port interface (`AuthProvider`, `PaymentsProvider`,
 * `StorageProvider`, `DbProvider`, `RealtimeProvider`) against an actual
 * provider (Supabase, Auth0, Stripe, S3, a real Postgres/SQLite-backed
 * store, etc.) instead.
 *
 * This is why these implementations live at the separate
 * `@jini-ai/capability-providers/unsafe-reference` import path rather than the
 * package's normal `@jini-ai/capability-providers` barrel: importing them
 * requires opting in to this path by name, so they can't be pulled in by
 * accident alongside the port interfaces/types and typed DI tokens (which
 * *are* stable, safe-to-depend-on exports of the normal entry point). See
 * `packages/capability-providers/source-map.md` and
 * `ADS-memory/reports/security/SEC-remaining-backend-audit-2026-07-21.md`
 * finding SEC-RB-006 for the audit that prompted this split.
 */

export * from './auth.js';
export * from './storage.js';
export * from './payments.js';
export * from './db.js';
export * from './realtime.js';
