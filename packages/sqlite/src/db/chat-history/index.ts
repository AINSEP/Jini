/**
 * @module db/chat-history
 *
 * Durable, owner-scoped chat history — the SQLite side of `@jini-ai/chat/core`'s
 * `ChatHistoryStore`. Takes an injected handle and never opens a database of its own, so a host
 * with its own file (and its own migration tooling) can use it without adopting this package's
 * `app.sqlite`.
 *
 * Distinct from the older `db/conversations` module, which is `project_id`-scoped with no owner
 * predicate at all — correct for a single-user local app, unsafe for a shared one. See
 * `store.ts`'s header.
 */
export * from './schema.js';
export * from './store.js';
