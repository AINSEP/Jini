/**
 * Outbox orchestration is independent of database connections and drivers. Keep this barrel
 * separate from the deprecated database shims so event-only consumers never load a SQL adapter.
 */
export * from './outbox/index.js';
