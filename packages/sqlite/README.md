# @jini-ai/sqlite — deprecated compatibility release

Version 0.5.0 is a deprecated compatibility surface for chat, daemon, registry and driver concerns,
including their erased types. Server-owned composition is no longer forwarded by this package. Prefer `@jini-ai/chat/store/{sqlite,legacy/sqlite}`,
`@jini-ai/daemon/store/{event-log/sqlite,agent-sessions/sqlite}`, `@jini-ai/registry/tool-catalog/sqlite`,
`@jini-ai/db/{core,sqlite}`, and `@jini-ai/server/{storage,storage/legacy/sqlite,store/projects/sqlite}`.

Pre-1.0 breaking acquisition change: Jini never autoloads a database driver. Use
`createSqliteEventLog({ db }, options)` for a borrowed connection. Canonical owned acquisition is
`openSqliteEventLog({ file, open }, options)` from the daemon concern entry. Server
`openDatabase({ projectRoot, open }, { dataDir? })` likewise requires the host opener. Hosts may use `(file, options) => new Database(file, options)`.
Borrowed event-log close never closes the host handle. Owned close is idempotent; failed setup
closes the newly acquired handle. The remaining event/CRUD/cursor/schema semantics stay unchanged.

This explicit re-export shim depends on concern owners. None depends on it. It eagerly loads
several adapters and requires the db/Kysely SQL peers; lean consumers should use the concern subpaths.
No driver is bundled, a hard dependency, dynamically imported, or obtained from a global registry.
The unpublished sqlite-chat implementation directory is drained; no registry release is changed here.

Backend config and types now come directly from `@jini-ai/server/storage`;
`openDatabase`, `closeDatabase` and `migrate` from `@jini-ai/server/storage/legacy/sqlite`;
project CRUD/status helpers from `@jini-ai/server/store/projects/sqlite`. This removes
the sqlite-to-server dependency rather than adding a wrapper or duplicated implementation.
