
# @jini-ai/server

Host composition requires the external host's SQLite opener for durable storage:

```ts
import Database from 'better-sqlite3';
import { createLocalNodeDaemon } from '@jini-ai/server';
const daemon = await createLocalNodeDaemon({
  dataDir, packs: [], open: (file, options) => new Database(file, options),
});
```

`composeJiniKernel` requires an explicit `security` choice: `{ mode: 'host' }` for host-owned
security, `jini-local` for local bearer/origin middleware, or `sidecar-strict` for mandatory
bearer validation before body parsing. Omitted and unknown modes fail before resources open.

For `composeJiniKernel`, use `storage: { kind: 'sqlite', dataDir, open }`; memory composition
uses `{ kind: 'memory' }` and needs no SQLite driver. All acquired event/journal/feature handles
belong to the kernel base, so independently disabling daemonDb/toolCatalog keeps health's
connection intact. Failed boot closes acquired handles; shutdown is idempotent.

`./storage` exports backend configuration resolution only, retaining the existing environment
names. It never selects or opens a driver. `./storage/legacy/sqlite` exports `openDatabase(root,
{ dataDir?, open })`, `closeDatabase()` and `migrate(db)`. This explicit local app.sqlite bootstrap
composes unchanged concern DDL for projects, conversations/messages and rich daemon sessions.
`./store/projects/sqlite` retains project CRUD and legacy run/awaiting-input projections over a
borrowed handle. No content/chat file is moved or host migration ledger applied.

No permanent package imports the compatibility shim. SQLite is an optional peer supplied by the
host; the server has no driver hard dependency or autoload behavior.

## Design decisions

- [Boot failure closes every resource already acquired](docs/decisions/DR-001-partial-boot-rollback.md).

Built-in daemon routes import `@jini-ai/daemon/http`. Middleware order is preserved:
probe routes first; in sidecar-strict mode bearer auth precedes JSON parsing, then the origin
guard; in jini-local mode JSON parsing precedes bearer auth and the origin guard. API packs,
the after-API hook and status packs follow. Hosts compose read-only attenuation innermost
around the bare executor to intercept nested recovery dispatches.

Backend config, legacy SQLite acquisition/bootstrap and project CRUD/status remain owned by `@jini-ai/server/{storage,storage/legacy/sqlite,store/projects/sqlite}`. Import these entries directly; the deprecated sqlite package no longer forwards them. Storage behavior and wire data are unchanged.

## Composition contracts

Built-in and caller packs use `definePack({ name, deps, services }, { tools, http, dispose })`.
Contribution callbacks receive an object (`{ app, services }` for HTTP, `{ services }` for tools
and disposal). Kernel composition forwards these hooks through the current core lifecycle helpers.

`agentExecutor` accepts the optional settings from `createAgentExecutor`'s second argument;
the kernel supplies its lifecycle, journal and retry classifier. Event-log cleanup passes `{}` to
the daemon's close port in both failed boot and normal shutdown.

The package TypeScript configuration includes source tests and fixtures. Published files continue
to exclude test output. The packed memory-boot fixture is local to this package so compiling server
does not pull another package's test sources outside server's source root.
