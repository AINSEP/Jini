/**
 * `@jini-ai/capability-providers` — abstract, swappable capability-provider
 * ports (auth/storage/payments/db/realtime): stable interfaces and typed DI
 * tokens only. Speculative port-design exploration, built with no current
 * consumer — see `source-map.md` for the full scope note and sign-off
 * status.
 *
 * This entry point intentionally does NOT export any concrete
 * implementation. The non-cryptographic, non-production in-memory
 * reference stubs that prove each port is genuinely implementable
 * (`createInMemoryAuthProvider` and friends) live under
 * `src/unsafe-reference/` and are exported only from the separate
 * `@jini-ai/capability-providers/unsafe-reference` entry point — see that
 * directory's `index.ts` header before importing anything from it.
 */
export * from './auth.js';
export * from './storage.js';
export * from './payments.js';
export * from './db.js';
export * from './realtime.js';
export * from './tokens.js';
