/**
 * @module @injini/sqlite
 *
 * The default durable store adapter behind `@injini/daemon`'s ports (extraction-plan §8 task 8),
 * plus backend-selection and inspection helpers for `better-sqlite3`-backed daemons.
 * See `source-map.md` for full provenance and scope-decision notes.
 */
export * from './event-log.js';
export * from './backend-config.js';
export * from './db-inspect.js';
export * from './db/index.js';
