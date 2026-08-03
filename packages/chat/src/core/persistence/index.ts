/**
 * @module persistence
 *
 * Durable chat history: the storage-neutral port plus the local title heuristic. No driver, no
 * DDL, no I/O — a SQLite implementation lives in `@jini-ai/sqlite`'s `chat-history` module, and
 * a host binds it to its own auth. See `./ports.ts` for why the owner scope is bound into the
 * store rather than passed per call.
 */
export * from './ports.js';
export * from './title.js';
