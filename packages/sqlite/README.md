# `@jini-ai/sqlite`

The durable SQLite adapter layer for a Jini host. Its headline export is `createSqliteEventLog`, a
real on-disk implementation of `@jini-ai/protocol`'s `EventLog` port (the dedupe-aware,
gap-detecting run-event log that `@jini-ai/daemon` also implements in memory) — swap one for the
other and runs survive a process restart. Alongside it sits the application schema and typed query
helpers a chat/agent host needs: projects, conversations, messages, agent sessions, a searchable
tool catalog, plus migration and integrity-inspection utilities. This package depends only on
`@jini-ai/protocol` and `better-sqlite3`; it does **not** depend on `@jini-ai/daemon`.

## Install

```sh
npm install @jini-ai/sqlite
```

`better-sqlite3` is a regular dependency (not an optional peer) because opening the database is this
package's entire job. It is a **native compiled addon**, so it needs a prebuild matching the exact
Node ABI it runs under — inside an Electron/Tauri shell that means an `electron-rebuild` step
whenever the shell's bundled Node/Electron version changes, not just a plain install.

## What you get

**Durable event log** — `createSqliteEventLog(dbPath, { maxEntriesPerRun })` returning a
`SqliteEventLog` (an `EventLog` plus its own close/lifecycle surface), and
`DEFAULT_MAX_ENTRIES_PER_RUN` (2000). Unlike the in-memory reference log, a durable store defaults
to a *bounded* retention window per run, because unbounded on-disk growth is a real unattended
operational risk; pass an explicit cap (larger, smaller, or `0`) to own that tradeoff yourself.

**Connection and migration** — `openDatabase(projectRoot, { dataDir })` (opens/creates
`<dataDir ?? projectRoot/.jini>/app.sqlite` and memoizes the handle), `closeDatabase()`, and
`migrate(db)`. Core types: `SqliteDb`, `DbRow`, `JsonObject`, `ChatSessionMode`.

**Backend selection** — `resolveSqliteBackendConfig(env)` → `SqliteBackendConfig`
(`kind: 'sqlite' | 'postgres'` plus Postgres resolution metadata a future adapter will read, with
secrets deliberately never read through env at this layer), and `SqliteBackendConfigError`.

**Application queries** — plain functions over a `SqliteDb`, grouped by table:
- projects: `listProjects`, `getProject`, `insertProject`, `updateProject`, `deleteProject`, and the
  run-status rollups (`listLatestRunStatuses`, `listLatestProjectRunStatuses`,
  `listLatestConversationRunStatuses`, `listFirstConversationRunStatuses`,
  `listProjectsAwaitingInput`, `listConversationsAwaitingInput`)
- conversations: `listConversations`, `getConversation`, `insertConversation`, `updateConversation`,
  `deleteConversation`, `normalizeConversationSessionMode`
- messages: `listMessages`, `upsertMessage`, `deleteMessage`, `appendMessageStatusEvent`,
  `appendMessageAgentEvent`, `getMessageTelemetryFinalizationState`, and
  `MessageConversationMismatchError`
- agent sessions: `getAgentSession`, `getAgentSessionRecord`, `upsertAgentSession`,
  `clearAgentSession`, `updateAgentSessionStableHash`, `latestCompletedAssistantMessageId`

**Tool catalog** — `ensureToolCatalogTables`, `reseedToolCatalog`, `getToolCatalogEntry`,
`searchToolCatalog` (FTS-backed), with `ToolCatalogEntry` / `ToolCatalogSearchHit`.

**Inspection** — `inspectSqliteDatabase({ db, file })` → `DaemonDbStatusReport` (table/row
inventory) and `verifySqliteIntegrity(opts)` → `DbIntegrityReport` (`PRAGMA integrity_check` plus
foreign-key violations).

**Row utilities** — `row`, `rows`, `parseJsonOrUndef`.

## Usage

```ts
import {
  createSqliteEventLog,
  openDatabase,
  migrate,
  listProjects,
  searchToolCatalog,
  verifySqliteIntegrity,
} from '@jini-ai/sqlite';
import type { EventLog } from '@jini-ai/protocol';

// The durable EventLog port — drop-in for @jini-ai/daemon's in-memory log.
const eventLog: EventLog = createSqliteEventLog('/var/lib/example/events.sqlite', {
  maxEntriesPerRun: 5000,
});

await eventLog.append({ runId: 'run_123', event: 'stdout', data: { text: 'hello' } });
const replay = await eventLog.replay('run_123', null);
if (replay.kind === 'replay-gap') {
  // The requested cursor was already evicted — resync rather than trusting a hole.
}

// The application database.
const db = openDatabase('/srv/workspace');
migrate(db);

const projects = listProjects(db);
const hits = searchToolCatalog(db, 'deploy', 5);
const integrity = verifySqliteIntegrity({ db });
```

## What's swappable

This package *is* an adapter — it implements `@jini-ai/protocol`'s `EventLog` so a host can bind
either it or an in-memory log behind the same token. Going the other way, very little inside is
injectable: `createSqliteEventLog` takes only a path plus the retention cap, and the query helpers
take an already-open `SqliteDb` handle (so you control connection lifetime, and can pass a
`:memory:` database in tests) but the SQL and schema themselves are fixed.
`resolveSqliteBackendConfig` reads a caller-supplied `env` record rather than `process.env` directly.

## Runtime

`jini.runtime: "node"` — `better-sqlite3` plus `node:fs`/`node:path`.
ESM only — ships `"type": "module"` with no CommonJS `require` build.

## Provenance

See [source-map.md](./source-map.md) for per-file provenance and scope decisions. Apache-2.0,
inherited from Open Design — see the repo `NOTICE`.
