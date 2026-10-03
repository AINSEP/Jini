# `@jini-ai/db`

Database ports, connection helpers, ownership, Kysely kernels and migrations in one package.
This package absorbs the database code from `@jini-ai/infra`. Infra 0.4.0 keeps its old two
subpaths as deprecated re-export shims for one release; import db directly in new code.

| Subpath | What it holds | Needs at load |
| --- | --- | --- |
| `./core` | `DbOpsPort`, restore-point types and naming, `PGLITE_SOCKET_FILE`, `PG_OID`, `PG_PARSERS`, `parseInt8` | Nothing |
| `./sqlite` | Structural SQLite client/opener types, `openSqliteConnection`, `DEFAULT_PRAGMAS`, `SqliteDbOpsAdapter` and restore types | Nothing |
| `./pglite` | Owner process, owner lock, private socket paths, low-memory settings, `PgliteSocketServer`, `PgliteClass` | Nothing |
| `./postgres` | Structural pool/module types and `pgTypesFor` | Nothing |
| `./kernel` | `StorageKernel`, `buildKernel`, `TurnLock`, dialect helpers, schema introspection and type generation, `StorageOps`, errors, `postgresLockKey` | `kysely` |
| `./kernel/sqlite` | `sqliteKernel`, file/memory kernels, connection lookup/close, `sqliteOps` | `kysely` |
| `./kernel/pglite` | `openPgliteKernel`, `PgKernel`, `PgliteDialect`, `pgliteOps`, served-data copy and restore types | `kysely` |
| `./kernel/postgres` | `openPostgresKernel`, `openPgliteSocketKernel`, `postgresOps` | `kysely` |
| `./migrate` | `runMigrations`, `assertValidSteps`, `hasLedger`, `sourceChecksum`, step/error types | `kysely` |
| `./transfer` | Snapshot sources, completeness, DDL and transactional psql COPY | Nothing |
| `./kernel/store-copy` | Scope-selected Postgres store copy over borrowed kernels | `kysely` |
| `./tools` | DB catalogs, portable read/restore-point/transfer handlers and injected ports | `@jini-ai/core` |

There is no `.` export. Each part loads only its own files and its explicitly shared dependencies.
The connection subpaths load no optional peer. Kernels need Kysely at load time, but all drivers
are injected when a connection is opened. Transfer and database tools have their own isolated subpaths.

Each JavaScript subpath declares `types`, `import` and `default` export conditions.
The `default` condition points to the same ESM file as `import`, so loaders such as
the tsx CommonJS bootstrap can resolve the subpaths without an active `import` condition.

## Import and driver isolation

`kysely` is an optional peer (`^0.29.6`), imported as a value or type only under `src/kernel/`
and `src/migrate/`. `better-sqlite3`, `pg` and `@electric-sql/pglite` are also optional peers.
Production code never imports a driver at runtime. PGlite type imports are confined to
`src/pglite/` and `src/kernel/pglite/`; SQLite and Postgres use structural types.

`src/core` is closed under relative imports and imports no optional peers, including type-only
imports. `pnpm guard`'s R12 checks it. `import-isolation.test.ts` parses every production TypeScript
file and checks the remaining boundaries, including re-exports and dynamic imports, with forbidden
fixture strings as positive controls. `loads-without-driver.test.ts` copies the built package into
two isolated installs: one with Kysely and core, and one with core but no database peers. It checks actual behavior and
resolved module directories for each subpath, and proves kernel entries fail without Kysely.

The consumer opens with its own driver copy. This also avoids loading two SQLite libraries in one
process, which would share POSIX file locks.

```ts
import Database from 'better-sqlite3';
import { PGlite } from '@electric-sql/pglite';
import pg from 'pg';
import { openSqliteConnection, SqliteDbOpsAdapter } from '@jini-ai/db/sqlite';
import { sqliteKernel } from '@jini-ai/db/kernel/sqlite';
import { openPgliteKernel } from '@jini-ai/db/kernel/pglite';
import { openPostgresKernel } from '@jini-ai/db/kernel/postgres';
import { runMigrations } from '@jini-ai/db/migrate';

const connection = openSqliteConnection({
  filePath: 'app.db',
  open: (filePath, options) => new Database(filePath, options),
});
const local = sqliteKernel<MyDb>(connection);
const embedded = openPgliteKernel<MyDb>({ PGlite }, { dataDir: './pgdata' });
const server = openPostgresKernel<MyDb>({ pg, connectionString: process.env.DATABASE_URL! });
await runMigrations(local, steps, { ledgerTable: 'app_migrations', appName: 'My app' });
const restore = new SqliteDbOpsAdapter({
  connection,
  filePath: 'app.db',
  readWatermark: () => readApplicationWatermark(local),
});
```

`MyDb`, `steps` and `readApplicationWatermark` above are supplied by the host. `openSqliteConnection`
now requires `open`; its returned type preserves the injected handle's additional methods. The
recovery hook runs before opening. A supplied `pragmas` array replaces the defaults. The defaults
are `journal_mode = WAL`, `foreign_keys = ON`, and `busy_timeout = 5000`. WAL is the observable
change from better-sqlite3's file-backed defaults.

## Host wiring and names

A host composition root imports connections from `./sqlite`, owner lifecycle from
`./pglite`, kernel bindings from `./kernel/<backend>`, shared constants from `./core`, and migrations
from `./migrate`. It supplies its own DB interface, schemas, ordered migration steps, ledger name,
application name, owner lock filename, run directory name, driver modules and watermark reader.

- `runMigrations(kernel, steps, { ledgerTable, appName })`: the ledger name is required.
- `startPgliteOwner({ dataDir, PGlite, lockFileName, runDirName })`: both filesystem names belong to
  the consumer. The socket uses a private short Unix path rather than TCP.
- `pgliteOps(kernel, { PGlite, ledgerTable, ownerLockFileName }, { pgliteOwner })` and
  `postgresOps(kernel, { ledgerTable })`: compaction verifies the host's ledger.

`DbOpsPort` is the restore-point contract with an injected watermark reader. `StorageOps` is the
kernel copy/compaction contract. They remain distinct because their operations and inputs differ.

Owner-lock release handles are idempotent and bound to the acquired inode. Stale-lock reapers use
an empty `<lockFileName>.reaping-<inode>` directory to serialize removal of that inode. A process
interrupted during this short removal window can leave the guard behind; acquisition then fails
closed. After confirming that no owner or starter is running for the data directory, the operator
may remove that empty guard and retry. Ordinary owner crashes leave the pid lock, which is still
automatically taken over once its process is dead.

## Tests

```sh
pnpm --filter @jini-ai/db build
cd packages/db
npx tsc -p tsconfig.json --noEmit
npx vitest run
pnpm test:postgres
```

The default suite excludes `**/*.postgres.test.ts`. `test:postgres` runs the copied
real-Postgres suites (transactions/advisory locks, idle-pool reconnection, storage ops and transfer
ownership/rollback) plus the transfer child-before-parent and multi-source cases. They
fail, never skip, when Postgres is unavailable. They require `psql` and a server accepting database
creation. `PGHOST` defaults to `/tmp`, `PGUSER` to `os.userInfo().username`, and `PGPORT` and
`PGPASSWORD` follow libpq. Fixtures under `src/testing/` are neither built nor exported.
PGlite socket integration tests require permission to bind Unix sockets.

## Types across a linked install

The dev copy of Kysely is exactly `0.29.6`. Match that in linked consumers: Kysely classes carry
`#private` fields, so different versions are incompatible nominal types. SQLite and Postgres types
are structural. `PgliteClass` is `typeof PGlite`, so the peer and dev copies remain exactly `0.5.8`.

## License

Apache-2.0. `src/pglite/socket-server.ts` is derived from `@electric-sql/pglite-socket` 0.2.11
(Apache-2.0): see `LICENSE.pglite-socket` and `NOTICE.md`.

## Synchronous SQLite compatibility and inspection

`./sqlite` additionally exports structural `SqliteSyncClient`, `SqliteSyncStatement`,
`SqliteSyncTransaction`, `SqliteSyncOpener` and the old `SqliteDb` alias. These are separate from
the kernel's minimal `SqliteClient`; no driver type import or broader kernel requirements were added.
`inspectSqliteDatabase`/`verifySqliteIntegrity` receive borrowed handles and preserve the existing
file/table/integrity reports. Neither opens a connection. `./core` exports the generic `DbRow`,
`JsonObject`, `parseJsonOrUndef`, `row`, and `rows` helpers, without driver/Kysely dependencies.


## Transfer and assistant tools (j03)

`@jini-ai/db/transfer` imports without Kysely, a driver, or core. Supply an opener to
`openSqliteSnapshotSource({ bytes }, { open })`. A consumer owns its table layouts, order,
exclusion reasons and all four required `TransferNaming` fields (`defaultSchema`, `markerTable`,
`unvalidatedTable`, `schemaPrefix`). `planTransfer({ sources })` raises
`IncompleteTransferPlanError` for every source table lacking a copied layout or a nonblank
exclusion reason. No source table names or application schema names are library defaults.

`runCopy({ sources, target, naming, schema, marker, replaceExisting })` creates and loads every
table before adding indexes and validating CHECK/FK constraints. Caller order is retained,
including child-before-parent loads. Multiple physical snapshots share one destination
transaction. Copies retain the existing marker protocol; a consumer must supply its existing
marker name to keep re-copy ownership protection. A precomputed count may be supplied on each
source; its coverage is checked before SQL and its values are checked inside the transaction.
The psql adapter keeps credentials out of argv and clears inherited PG variables.

`@jini-ai/db/kernel/store-copy` uses Kysely and borrowed kernels. Supply
`{ source, target, scope: { schemas, ledgers } }`; ledgers are compared, never copied. No second
connection/kernel is opened by this entry.

`@jini-ai/db/tools` uses the regular `@jini-ai/core` dependency. Catalog types (`AgentToolDefinition`,
`AgentToolActorClassRule`, `AgentToolSideEffect`) are imported directly from core. It exports
DB tool catalogs plus `createDatabaseReadTools(ports)` and `createDatabaseTransferTools(ports)`.
The host injects authorization, input readers, introspection, repositories, clocks, catalogs,
snapshot capture, plan/destination storage, and surface protocol/builders. The host migration
plan/execute handlers and their gateway, lock and confirmation policy remain host composition.
The restore-guidance descriptor remains declared without a handler. Hosts retain their own
independent risk checks and error adapters around the returned registrations.

`DatabaseReadToolPorts.clock` uses `Clock` from `@jini-ai/core/primitives` and exposes
`nowMs()`. Restore-point timestamps use the canonical `nowIso({ clock })` helper.
`databaseFile<DB>(kernel: StorageKernel<DB>)` accepts a typed kernel without erasing
its database schema; SQLite file lookup and null results are unchanged.

Interactive transfer handlers follow core's two-object invocation contract:
`registration.handler(context, { emitSurface })`. Supply the emitter in the second argument
for destination forms and replacement confirmation; omitted channels still fail closed.
`TransferSurfacePorts.open` receives core's canonical `SurfaceEmitter`.

Transfer planning snapshots content and chat separately; they are not a cross-database atomic
snapshot. The exact captured bytes are held in a principal/workspace-bound, single-use plan
until expiration. No migration, driver installation, live cutover, or publishing occurs here.

Transfer descriptions use `defaultDbMessages`, replaceable as a whole through
`createDatabaseTransferTools(ports, { messages })`. The factory describes the actual
`ports.naming.defaultSchema` and `schemaPrefix`; persisted naming and schema/exclusion policy
remain required host inputs. `getDatabaseTransferAgentToolCatalog({}, { naming, messages })`
builds the same four definitions for catalog inspection; its display-only default is `app` /
`app_`. `databaseTransferAgentToolCatalog` remains the neutral default display catalog.


## Design decisions

- [Operational history is a bounded read surface](docs/decisions/DR-001-bounded-operational-timeline.md).
- [Unavailable restore mechanisms have no attestation override](docs/decisions/DR-002-restore-point-precondition.md).
- [Storage copying takes its schemas from the host](docs/decisions/DR-003-host-owned-schema-copy.md).

### Host database prose

`defaultDbMessages` and `DbMessages` are exported from `@jini-ai/db/tools`.
The neutral defaults say “the source”; hosts may pass their existing wording explicitly.
`getDatabaseAgentToolCatalog({}, { messages })`, `createDatabaseReadTools(ports, { messages })`
and `createRestorePoint(required, { messages })` render catalog/cost/refusal copy.
`createDatabaseTransferTools(ports, { messages })` also forwards copy-preflight errors and
transfer refusal, unchecked-link and saved-destination messages. Existing transfer-only
message replacements remain supported; unspecified runtime fields retain neutral defaults.
`countSourceRows(required, { messages })` and `runCopy(required, { messages })` accept the
missing-source-table/column formatter subset. Messages never select a schema or rewrite SQL.
Persisted `TransferNaming` remains required with no fallback; its display-only catalog
examples still default to `app` / `app_`. Keep each host's existing wire names explicit.
