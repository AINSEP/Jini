Spec ID: SPEC-JINI-DB-API
Version: 2.0.0
Last Edited: 2026-10-03T04:10:53Z
Hash: sha256:e3831ec77ea1732cdf735f75df7a233a51249eee2841dc1e7f3bb7d48870b7f8
spec_mode: reverse_spec


# Database API contract

Scope: all thirteen `package.json` exports, including metadata. There is no root `@jini-ai/db` export. Desired calling convention is `(required, optional = {})`, two objects; this specification preserves actual signatures, including positional legacy/kernel APIs and options mixed into a single object. Those exceptions are not yet converted. No driver package is imported at runtime by these entries; consumers supply their driver/module/class. Kernel entries require Kysely at runtime; tools require the optional @jini-ai/core peer at runtime. Structural type references to optional peers remain in declarations.

## `./core`

| Entry point | Current signature/shape |
|---|---|
| `sanitizeForFilename` | `(value: string) => string` (positional exception) |
| `restorePointFilename` | `({ scopeId: string; watermarkAtCapture: number; timestamp: number; extension?: string }) => string` (optional extension in first object) |
| `parseInt8` | `(text: string) => number | bigint` (positional exception) |
| `parseJsonOrUndef` | `(value: unknown) => any` (positional exception; undefined for invalid/non-string input) |
| `row`, `rows` | `(value: unknown) => DbRow | null`; `(value: unknown[]) => DbRow[]` (positional exceptions) |
| `PG_OID`, `PG_PARSERS` | OIDs int8 20/json 114/jsonb 3802; readonly mapping number -> `(text: string) => unknown` |
| `PGLITE_SOCKET_FILE` | `'.s.PGSQL.5432'` |

Types: `DbRow = Record<string, any>`, `JsonObject = Record<string, unknown>`; `RestoreCostClass = 'cheap' | 'expensive'`, `RestoreKind = 'file-snapshot' | 'logical-dump'`, `RestoreCapability { costClass; kind }`, `RestorePoint { artifactRef; watermarkAtCapture }`, `WatermarkReader = () => number | Promise<number>`. `DbOpsPort` exposes getCapabilities() => Promise<{ restorePoint: RestoreCapability }>, captureRestorePoint({ scopeId }) => Promise<RestorePoint>, restoreFromArtifact({ artifactRef }) => Promise<{ restartRequired: boolean }>.

```ts
import { restorePointFilename, parseInt8 } from '@jini-ai/db/core';
const name = restorePointFilename({ scopeId: 'workspace-1', watermarkAtCapture: 8, timestamp: 1234 });
const integer = parseInt8('9007199254740993'); // bigint
```

## `./sqlite`

| Entry point | Current signature and return |
|---|---|
| `openSqliteConnection` | `(options: OpenSqliteConnectionOptions<Connection>) => Connection` |
| `SqliteDbOpsAdapter` | `new (deps: SqliteDbOpsAdapterDeps)`; implements DbOpsPort |
| `inspectSqliteDatabase` | `({ db: SqliteDb, file: string }) => Promise<DaemonDbStatusReport>` |
| `verifySqliteIntegrity` | `({ db: SqliteDb, quick?: boolean }: VerifyDbOptions) => DbIntegrityReport` |
| `DEFAULT_PRAGMAS` | readonly `['journal_mode = WAL', 'foreign_keys = ON', 'busy_timeout = 5000']` |

`OpenSqliteConnectionOptions` requires open/filePath; optional pragmas/recover are currently in that same object. `SqliteOpener(filePath, options: SqliteOpenOptions) => Connection`; options readonly?/fileMustExist?. `SqliteRecoveryHook(filePath) => void`; `SqliteBackupSource.backup(destination) => Promise<unknown>`. Restore deps require connection (backup source), filePath, readWatermark; optional now() defaults Date.now.

`SqliteClient` structurally exposes memory/name/inTransaction, exec(sql), prepare(sql), pragma(sql), backup(path), close(). `SqliteStatement` exposes reader and positional all/run/iterate bindings; run returns changes/lastInsertRowid (number|bigint). `SqliteSyncClient` adds open, typed prepare/get/all/iterate, pragma(sql, { simple? }?), transaction(body). `SqliteSyncTransaction` is callable and supplies deferred/immediate/exclusive variants. `SqliteSyncOpener` preserves the richer host connection type; `SqliteDb` aliases SqliteSyncClient. These driver-compatible signatures remain positional.

Status result has kind/location/sizeBytes/schemaVersion/tables/generatedAt; `DaemonDbTableInfo` is name/rowCount. Integrity result has ok/mode/issues/elapsedMs/generatedAt; `DbIntegrityIssue` kind/message, `DbIntegrityIssueKind = 'integrity' | 'foreign_key'`; quick chooses quick_check instead of integrity_check.

`SqliteSyncStatement` names the richer generic prepare result with get/all/iterate/run and reader. `UnsupportedCapabilityError`, `StorageOpNotSupportedError` and `StorageOpError` are exported by the kernel barrel, with constructor/fields/triggers in [errors.spec.md](errors.spec.md).

```ts
import { openSqliteConnection, SqliteDbOpsAdapter } from '@jini-ai/db/sqlite';
const connection = openSqliteConnection({ filePath: '/srv/data/store.db', open: hostSqliteOpener });
const ops = new SqliteDbOpsAdapter({ connection, filePath: '/srv/data/store.db', readWatermark });
const point = await ops.captureRestorePoint({ scopeId: 'workspace-1' });
// Host owns the raw connection and must coordinate/reopen after a physical restore.
```

## `./postgres`

`pgTypesFor(pg: PgModule, parsers: Readonly<Record<number, (text: string) => unknown>>) => NonNullable<PgPoolOptions['types']>` is a positional exception. It supplies per-pool getTypeParser, without changing global parsers.

`PgModule` requires Pool constructor and types.getTypeParser; `PgPoolOptions` permits connectionString/host/port/user/database/max/idleTimeoutMillis/types. `PgPool` exposes connect() => Promise<PgPoolClient>, end(), options, on('error', listener). Client query(sql, parameters) => Promise<PgQueryResult<Row>> or query(PgCursor<Row>) => PgCursor<Row>, release(), optional processID. Result is command/rowCount/rows; cursor read(rowsCount)/close() are async.

```ts
import { pgTypesFor } from '@jini-ai/db/postgres';
import { PG_PARSERS } from '@jini-ai/db/core';
const pool = new hostPg.Pool({ connectionString, types: pgTypesFor(hostPg, PG_PARSERS) });
// hostPg is the consumer's pg module; pool lifetime is owned here.
```

## `./pglite`

| Entry point | Current signature and return |
|---|---|
| `startPgliteOwner` | `({ dataDir, PGlite: PgliteClass, lockFileName, runDirName }, { socketDir?, idleInTransactionTimeoutMs?, maxConnections?, log?: (message: string) => void } = {}) => Promise<PgliteOwner>` |
| `runningPgliteOwner` | `(dataDir: string) => PgliteOwner | undefined` (positional exception) |
| `acquireOwnerLock` | `({ dataDir, lockFileName }) => () => void` |
| `defaultPgliteSocketDir` | `({ dataDir, runDirName }, { home?: string } = {}) => string` |
| `assertSocketPathFits` | `(socketPath: string) => void` (positional exception) |
| `ensurePrivateDir` | `(dir: string, { privateParent?: boolean } = {}) => void` (scalar first argument) |
| `pgliteLowMemoryStartParams` | `(pglite: Pick<PgliteClass, 'defaultStartParams'>) => string[]` (class object, no wrapping required object) |
| `PgliteSocketServer` | `new (options: PgliteSocketServerOptions)` |
| `errorResponseFrame` | `(severity: 'ERROR' | 'FATAL', code: string, message: string) => Buffer` (positional exception) |
| `PgliteOwnerLockedError` | `new (dataDir: string, pid: number | undefined)` (positional exception) |

`PgliteClass = typeof PGlite` from the consumer's optional peer. `PgliteOwner` provides readonly socketPath/socketDir, runExclusive(fn: (db: PGlite) => Promise<T>) => Promise<T>, close() => Promise<void>. Socket options require db/path, optional maxConnections/idleInTransactionTimeoutMs/log. Server provides path getter, start(), runExclusive(fn), stats() => `{ connections; queued }`, stop(). Server alone borrows db; owner closes its acquired db. `PGLITE_LOW_MEMORY_SETTINGS` exports start-param pairs for shared_buffers=16MB, work_mem=1MB, maintenance_work_mem=8MB, wal_buffers=256kB, max_connections=1.

```ts
import { startPgliteOwner } from '@jini-ai/db/pglite';
const owner = await startPgliteOwner({ dataDir: '/srv/data/pg', PGlite: hostPGlite,
  lockFileName: 'host-owner.pid', runDirName: 'sample-host' });
try { await owner.runExclusive(db => db.exec('SELECT 1')); }
finally { await owner.close(); }
```

## `./kernel`

`StorageDialect = 'sqlite' | 'postgres'`; `StorageTransport = 'better-sqlite3' | 'pglite' | 'node-postgres' | 'pglite-socket'`. `StorageCapabilities` contains interactiveTransactions/atomicBatch/transactionalDdl/backup; `StorageCapability` is their key union.

`StorageKernel<DB>` exposes dialect/transport/capabilities/ready; methods currently positional: run(fn: (db: Kysely<DB>) => T | Promise<T>) => Promise<T>, transaction(fn: () => Promise<T>) => Promise<T>, lockKey(key: string), query<Row>(statement: RawBuilder<Row>) => Promise<Row[]>, execute(statement) => Promise<void>, require(capability) => void, backupTo(destPath) => Promise<void>, inTransaction() => boolean, close() => Promise<void>.

| Entry point | Current signature and return |
|---|---|
| `buildKernel` | `(driver: KernelDriver<DB>) => StorageKernel<DB>` |
| `TurnLock` | `new ()`; acquire('shared'|'exclusive') => Promise<void>, release(kind) => void |
| `jsonText`, `jsonSortKey` | `(dialect, column: Expression<unknown>, path: readonly string[]) => RawBuilder<string | null> / RawBuilder<unknown>` |
| `jsonScalarEquals` | `(dialect, column, path, value: string | number | boolean) => RawBuilder<boolean>` |
| `jsonSet` | `(dialect, column, path, value: unknown) => RawBuilder<string>` |
| `nowIso` | `(dialect) => RawBuilder<string>` |
| `toBool` | `(value: boolean | number | null | undefined) => boolean | null` |
| `toBytes` | `(value: unknown) => Uint8Array` |
| `isUniqueViolation` | `(error: unknown) => boolean` |
| `listTables`, `tableExists`, `listColumns`, `listIndexes` | `(kernel) => Promise<string[]>`; `(kernel, table) => Promise<boolean / ColumnInfo[] / Map<string, IndexInfo>>` |
| `columnTypeSql`, `autoIdColumnSql` | `(dialect, affinity: ColumnAffinity) => string`; `(dialect) => string` |
| `checkpointWal` | `(kernel) => Promise<void>` |
| `scopeToSchema` | `(kernel, schema: string) => StorageKernel<DB>` |
| `readSchemaShape` | `(kernel, { exclude?: readonly string[] } = {}) => Promise<SchemaShape>` |
| `databaseFile` | `(kernel) => Promise<string | null>` |
| `renderDatabaseTypes` | `(kernel, required: { interfaceName; source; regenerate }) => Promise<string>` |
| `outsideTransactionOf` | `(kernel) => (op: keyof StorageOps) => void` |
| `verifyLedgerReadBack` | `(kernel, ledgerTable: string) => Promise<void>` |
| `postgresLockKey` | `(tx: Kysely<DB>, key: string) => Promise<void>` |

`KernelDriver` supplies dialect/transport/capabilities/ready/base, begin(body), lockKey(tx,key), oneConnection, close(), optional turnLock/foreignTransactionOpen()/backup(path). This is a low-level implementer contract; host factory users need only the driver-specific dependencies below. `ColumnAffinity` is TEXT|INTEGER|REAL|BLOB; `ColumnInfo` name/type/notNull/primaryKey; `IndexInfo` name/columns/unique. `SchemaShape` tables/others; `TableShape` columns/indexes/constraints string arrays. `StorageOps` copyTo(targetPath) and compactAndVerify() return Promise<void>. Error constructors are documented in [errors.spec.md](errors.spec.md). All helpers in this table retain positional arguments except buildKernel's driver object; no converted wrappers exist.

```ts
import { listTables, scopeToSchema } from '@jini-ai/db/kernel';
const tables = await listTables(kernel);
const scoped = scopeToSchema(postgresKernel, 'tenant_data');
// Host supplies an opened kernel; scoped raw query/execute still require explicit schemas.
```

## Driver kernel subpaths

| Subpath and entry point | Current signature and return |
|---|---|
| `./kernel/sqlite`: `sqliteKernel` | `(source: SqliteConnectionSource) => SqliteKernel<DB>` |
| `sqliteClientOf`, `closeSqliteConnection` | `(source) => SqliteClient / void` |
| `sqliteConnectionOf` | `(kernel) => SqliteClient | undefined` |
| `openSqliteFileKernel` | `({ filePath, open: SqliteOpener }, { readOnly?: boolean } = {}) => SqliteKernel<DB>` |
| `openMemorySqliteKernel` | `({ open: SqliteOpener }) => SqliteKernel<DB>` |
| `sqliteOps` | `(kernel) => StorageOps` |
| `./kernel/pglite`: `openPgliteKernel` | `({ PGlite: PgliteClass }, { dataDir?: string; prepare?: (client: PGlite) => Promise<void> } = {}) => PgKernel<DB>` |
| `PgliteDialect` | `new (client: PGlite)`; Kysely Dialect createAdapter()/createDriver()/createQueryCompiler()/createIntrospector(db) |
| `pgliteOps` | `(kernel, required: PgliteRestore & { ledgerTable }, optional: { pgliteOwner?: PgliteExclusive } = {}) => StorageOps` (three-argument exception) |
| `copyServedPgliteTo` | `(owner: PgliteExclusive, targetPath: string, required: PgliteRestore) => Promise<void>` (three-argument exception) |
| `./kernel/postgres`: `openPostgresKernel` | `({ pg: PgModule, connectionString }, { max?: number } = {}) => StorageKernel<DB>` |
| `openPgliteSocketKernel` | `({ pg: PgModule, socketPath }) => StorageKernel<DB>` |
| `postgresOps` | `(kernel, required: { ledgerTable }) => StorageOps` (kernel first) |

`SqliteKernel` and `PgKernel` alias StorageKernel; `SqliteConnectionSource` accepts raw SqliteClient or `{ $client }`. `PgliteExclusive.runExclusive(fn)` matches owner; `PgliteRestore` requires PGlite and optional ownerLockFileName for removing a copied pid lock.

```ts
import { openMemorySqliteKernel } from '@jini-ai/db/kernel/sqlite';
import { openPgliteKernel } from '@jini-ai/db/kernel/pglite';
import { openPostgresKernel, openPgliteSocketKernel } from '@jini-ai/db/kernel/postgres';
const sqlite = openMemorySqliteKernel({ open: hostSqliteOpener });
const embedded = openPgliteKernel({ PGlite: hostPGlite });
const remote = openPostgresKernel({ pg: hostPg, connectionString });
const socket = openPgliteSocketKernel({ pg: hostPg, socketPath: owner.socketPath });
// Each returned kernel here owns acquisition; await ready/use and close when finished.
```

## `./migrate`

`runMigrations(kernel, steps: readonly MigrationStep[], options: MigrationOptions) => Promise<MigrationReport>`; `assertValidSteps(steps) => void`; `hasLedger(kernel, ledgerTable: string) => Promise<boolean>`; `sourceChecksum(text: string) => string`. All are positional exceptions.

`MigrationStep` requires id/checksum and up(kernel, context) => Promise<void>; optional prepare(kernel, context) runs outside transaction. `MigrationContext` carries optional backupPath and note(message: string). `MigrationOptions` requires ledgerTable and optional backupPath/schema/appName. `MigrationReport` has applied/alreadyApplied/notes string arrays. `MIGRATION_ID` is `/^\d{4}_[a-z0-9_]+$/`. `MigrationChecksumError` and `UnknownAppliedMigrationError` are public classes.

```ts
import { runMigrations, sourceChecksum } from '@jini-ai/db/migrate';
const step = { id: '0001_initial', checksum: sourceChecksum(frozenSource), up: installHostSchema };
const report = await runMigrations(kernel, [step], { ledgerTable: 'host_migrations' });
// Host provides immutable steps/checksums/schema installation and connection lifecycle.
```

## `./transfer`

This entry imports neither a driver nor Kysely. All table catalogs, exclusion policy and persisted marker names come from the consumer. Functions use `(required, optional = {})` except openSqliteSnapshotSource's mandatory second object; its required dependency is currently misplaced in optional position.

| Entry point | Current signature and return |
|---|---|
| `openSqliteSnapshotSource` | `({ bytes: Buffer }, { open: SnapshotOpener }) => TransferSource` (second object mandatory) |
| `parseConnectionString` | `({ raw: string }, { applicationName?: string } = {}) => { description: TargetDescription; env: Readonly<Record<string, string>> }` |
| `createPsqlPostgresTarget` | `({ connectionString }, { parentEnv?: NodeJS.ProcessEnv; applicationName?: string } = {}) => PostgresTargetPort` |
| `introspectedTable` | `({ name, layout: SourceTableLayout }, {} = {}) => TransferTable` |
| `planSnapshotTables` | `({ source: TransferSource, policy: SnapshotTablePolicy }, {} = {}) => SnapshotTablePlan` |
| `planTransfer` | `({ sources: readonly TransferPlanSource[] }, {} = {}) => { sources: readonly TransferPlanSource[] }` |
| `countSourceRows` | `({ source, tables: readonly TransferTable[] }, {} = {}) => TableCount[]` |
| `siteSchemaName` | `({ site: string, naming: TransferNaming }, {} = {}) => string` |
| `inspectTarget` | `({ target: PostgresTargetPort, site, naming }, {} = {}) => Promise<TargetInspection>` |
| `runCopy` | `(input: RunCopyInput, {} = {}) => Promise<CopyResult>` |
| `quoteIdent`, `quoteLiteral`, `qualified`, `fitIdentifier` | `({ name }, {} = {}) => string`; `({ value }, {} = {}) => string`; `({ schema, table: string }, {} = {}) => string`; `({ name }, {} = {}) => string` |
| `createTableSql`, `indexSql` | `({ schema: string, table: TransferTable }, {} = {}) => string` |
| `reseedIdentitySql` | `({ schema, table: TransferTable }, { sqlTag?: string } = {}) => string` |
| `constraintSql` | `({ schema, tables: readonly TransferTable[], unvalidatedTable: string }, { sqlTag?: string } = {}) => string` |
| `IncompleteTransferPlanError` | `new ({ missing: readonly { source; table }[] }, {} = {})` |
| `InvalidConnectionStringError`, `SourceSchemaMismatchError` | Error subclasses with inherited Error constructor; no custom name/code |
| `LEFT_OUT_REASON` | readonly bookkeeping/derived/secret reason strings |

Consumer ports: SnapshotOpener(bytes, { readonly: true }) => SnapshotClient; client prepare(sql)/close(), SnapshotStatement all/get/raw/safeIntegers/iterate. TransferSource tableNames()/layout(table)/columns(table)/countRows(table, keep?)/rows(table, columns, keep?)/close() is synchronous; row iteration preserves bigint integers. PostgresTargetPort describe() => TargetDescription { host; port: string; database; user }, query(sql) => Promise<TargetResult<string[][]>>, runScript(chunks: Iterable<string>) => Promise<TargetResult<null>>. TargetResult discriminates ok/value from failure error/optional copyTable. These port methods remain positional; host ports own network policy and atomic script execution.

Exported schema types: TransferColumn { name; sqlType; notNull; default?: SQL; identity?: 'ALWAYS'|'BY DEFAULT' }, TransferIndex { name; columns; unique }, TransferForeignKey { name; columns; foreignTable; foreignColumns: string[]|null; onDelete; onUpdate }, TransferCheck { name; sql }, TransferTable { name; columns; primaryKey; keep?: source SQL predicate; indexes; foreignKeys; checks }. SourceColumn exposes name/declaredType/notNull/defaultSql/primaryKeyPosition; SourceForeignKey exposes columns/foreignTable/nullable foreignColumns/onDelete/onUpdate; SourceIndex exposes name/unique/origin/partial/nullable columns; SourceTableLayout exposes virtual/columns/foreignKeys/indexes. All SQL fragments are trusted host input, not sanitized tool input.

SnapshotTablePolicy requires coreTables/coreNames/excludedTables/derivedNames/migrationLedgers/bookkeepingPrefixes/secretColumnPattern. SnapshotTablePlan is tables/leftOut { table; reason }. TransferPlanSource adds name/source/optional frozen counts. TransferNaming requires defaultSchema/markerTable/unvalidatedTable/schemaPrefix, optional sqlTag. TableCount is table/rows; CopyMarker is site/snapshotAt. RunCopyInput requires sources/target/naming/schema/marker/replaceExisting. TargetSchemaState is absent/ours/foreign; TargetInspection contains ok/serverVersionNum/schemaState/schema/lastCopy/canCreateSchema, or error; TransferCopyInfo is site/snapshotAt. CopyResult is ok/tables {name,rows}/unvalidatedConstraints/optional warning, or code/message/optional logDetail.

```ts
import { openSqliteSnapshotSource, planSnapshotTables, planTransfer, runCopy } from '@jini-ai/db/transfer';
const source = openSqliteSnapshotSource({ bytes: snapshotBytes }, { open: hostSnapshotOpener });
try {
  const catalog = planSnapshotTables({ source, policy: hostPolicy });
  const { sources } = planTransfer({ sources: [{ name: 'main', source, ...catalog }] });
  const result = await runCopy({ sources, target: hostTarget, naming: hostNaming, schema: 'host_copy',
    marker: { site: 'workspace-1', snapshotAt }, replaceExisting: false });
} finally { source.close(); }
```

The optional concrete target uses a host-installed psql executable and parentEnv (default process.env). parseConnectionString exposes secret-bearing libpq env to its caller; only description is safe destination metadata. The adapter is optional; a consumer can implement the structural target instead.

## `./tools`

| Entry point | Current signature and return |
|---|---|
| `getDatabaseAgentToolCatalog` | `(required: Record<string, never> = {}, optional: Record<string, never> = {}) => AgentToolDefinition[]` |
| `databaseTransferAgentToolCatalog` | mutable static AgentToolDefinition[] |
| `createDatabaseReadTools` | `(required: DatabaseReadToolPorts, {} = {}) => ToolRegistration[]` |
| `createDatabaseTransferTools` | `(required: DatabaseTransferToolPorts, {} = {}) => ToolRegistration[]` |
| `getTimeline` | `({ ledger: LedgerReadPort, filter?: TimelineFilter }, {} = {}) => Promise<{ items: LedgerRow[]; nextCursor: string | null }>` |
| `createRestorePoint` | `({ costClass: RestorePointCostClass, costAck?: boolean, capture: () => Promise<{ artifactRef; watermarkAtCapture }> }, {} = {}) => Promise<RestorePointSummary>` |
| `listRestorePoints` | `({ repo: RestorePointListPort }, {} = {}) => Promise<{ items: RestorePointRecord[] }>` |
| `DatabaseTransferPlanStore` | `new (required: Record<string, never> = {}, { now?: () => number } = {})`; save({principalId,workspaceId,content}, {} = {}) => DatabaseTransferPlan; take({planId,principalId,workspaceId}, {} = {}) => TakeDatabaseTransferPlanResult |
| `ValidationError`, `RestorePointUnavailableError` | `new (message: string)` (positional exceptions), named Error without code |

AgentToolDefinition fields name/description/sideEffects/authorization {permission}/optional actorClassRule/inputSchema; AgentToolSideEffect is none/mutates-durable-state/mints-token; AgentToolActorClassRule is confirmer-must-equal-own-delegatedBy/user-only/none. Catalog-only migrate-forward/restore-guidance entries are not handlers returned by the read factory.

DatabaseReadToolPorts requires workspaceId/readers/requirePermission({principalId,permission,entityType}), introspection.getHealth/getSchemaState/listPendingMigrations, ledger, restorePoints, dbOps.getCapabilities/captureRestorePoint({scopeId}), kernel Clock.nowMs() and idGen.newId(). Restore-point timestamps use core's nowIso({clock}) helper. InputReaders supplies inputRecord/string/noInput/isRecord/optionalString/optionalNumber/optionalBoolean with positional inputs. Core registration policy allows entry; permission enforcement is in each handler before effects. Returned six IDs are database_get_health/database_get_schema_state/database_list_pending_migrations/database_query_timeline/database_list_restore_points/backup_create_restore_point. Introspection results are host-defined unknown; timeline/list/capture results use the types below.

`DatabasePermissionRequest` names principalId/permission/entityType in the required permission port.

LedgerRow {id,kind,createdAt,restorePointId: string|null,outcome}; LedgerReadPort.query(filter) returns items/nextCursor. Filter permits kind/outcome/fromDate/toDate/cursor/limit. RestorePointCostClass is cheap/expensive/unavailable; summary id/costClass/kind. RestorePointRecord has id/trigger/costClass/kind/watermarkAtCapture/createdAt/artifactRef. RestorePointListPort.list() supplies newest-first ordering; RestorePointSavePort.save(row) accepts restorePointId/idempotencyKey/trigger/createdAt/createdBy plus optional costClass/kind/watermarkAtCapture/artifactRef. RestorePointIdempotencyLookupPort.findByIdempotencyKey(key) returns nullable restorePointId/idempotencyKey; createRestorePoint does not consume this port.

DatabaseTransferToolPorts requires workspaceId/site/naming/clock/dbOps/plans/destinations/target/openSource/catalog/partialExclusions/captureChatSnapshot/failureLog/describeError/schemaMismatchGuidance/readers/surfaces. target(connectionString) returns PostgresTargetPort; openSource(Buffer) returns TransferSource; catalog(sourceName, source) returns SnapshotTablePlan; partialExclusions(sourceName,source) returns table/rows/reason disclosures; captureChatSnapshot() returns Buffer. No host defaults fill missing ports. Snapshot artifact reading/deletion uses Node filesystem internally.

DatabaseDestinationStorePort provides get(workspaceId), save(workspaceId,destination), lastRun(workspaceId), recordRun(workspaceId,summary). SavedDatabaseDestination includes connectionString/description/savedAt. DatabaseTransferRunSummary records copied true with snapshotAt/tableCount/rowCount, or false with snapshotAt/code/message. DatabaseTransferPlanContent holds secret connectionString, description as destination, replaces, snapshot Buffer, optional chatSnapshot Buffer, snapshotAt/site/schema/tableCount/rowCount/leftOut. DatabaseTransferPlan adds planId/principalId/workspaceId/expiresAtMs. TakeDatabaseTransferPlanResult is ok/plan or PLAN_NOT_FOUND/PLAN_EXPIRED.

TransferSurfacePorts supplies open(binding, emit), resolveDecision(exchange, emission), askThenReport(exchange, emission, handler), confirmation(plan,exchangeId), destinationForm(exchangeId), destinationOutcome({exchangeId,state,message}), dismissedParam/addressField. SurfaceExchange exposes id/send(emission)/receive()/close(); SurfaceMessage is received/params or expired/abandoned. The host supplies UI builders, authenticated principal binding, expiry and mandatory exchange cleanup; this package exports no components or styles. Tool results are Record<string,unknown> unions: planned/planId/expiresAt/destination/area/counts/leftOut/notes/nextStep; copied/destination/area/counts/tables/optional unvalidatedConstraints; saved/destination/replaces; status destination/lastRun/copyOnDestination. Refusals carry code/message or cancellation reason. Connection strings are not returned as tool results.

```ts
import { createDatabaseReadTools, createDatabaseTransferTools, DatabaseTransferPlanStore } from '@jini-ai/db/tools';
const reads = createDatabaseReadTools(hostReadPorts);
const copies = createDatabaseTransferTools({ ...hostTransferPorts, plans: new DatabaseTransferPlanStore({}) });
// Host registers these with its core executor and supplies permission/surface/storage ports.
```

## `./kernel/store-copy`

readCatalog({kernel, scope}, {} = {}) => Promise<CatalogTable[]>; nonEmptyTables({kernel,scope}, {} = {}) => Promise<string[]>; assertLedgersAgree({source,target,scope}, {} = {}) => Promise<void>; copyPgStore({source,target,scope}, {onCopied?: () => Promise<void>} = {}) => Promise<CopiedTable[]>; StoreCopyError(message: string) is a named Error, positional constructor. BATCH_ROWS = 500. StoreCopyScope requires schemas: readonly string[] and ledgers: readonly {schema,name}[]; CatalogTable includes schema/name/columns/primaryKey, column fields name/type/notNull/expression/identity/generated; CopiedTable is table/rows/created.

The consumer supplies opened Postgres-dialect kernels, a stable source (held owner exclusive or otherwise quiescent), migrated empty target and trusted schema scope. No connection acquisition, migration or source locking happens here. onCopied runs inside target transaction after verification and can roll it back by throwing.

```ts
import { copyPgStore } from '@jini-ai/db/kernel/store-copy';
const report = await owner.runExclusive(() => copyPgStore({ source, target, scope: hostCopyScope }));
```

## `./package.json` and exclusions

The metadata export is the package's JSON manifest, with no functions or dependency ports. For example, read it using the host runtime's JSON import mechanism to inspect exports/peer ranges. No `./testing` subpath is exported even though source exists; it is not part of this consumer contract.

Evidence: export barrels/current source and existing kernel, owner, ops, migration, import-isolation and SQLite tests. Tests were read, not executed. Public signatures above are pre-wave; object-argument conversion and shared base types remain refresh work.

## Host copy and dynamic transfer catalogs

`./tools` exports DbTransferMessages, DbMessages and defaultDbMessages. `getDatabaseTransferAgentToolCatalog({}, {naming = {defaultSchema: "app",schemaPrefix: "app_"}, messages = defaultDbMessages} = {}): AgentToolDefinition[]` returns four definitions with stable IDs/risk/permissions and host-selected descriptions. databaseTransferAgentToolCatalog is the default snapshot. Naming here describes copy; actual persisted schema/marker naming remains required in execution ports. createDatabaseTransferTools(deps, {messages?} = {}) combines neutral runtime defaults with supplied copy and calls the dynamic catalog with deps.naming. Read-tool/catalog/copy/restore helpers accept the source's scoped messages options; copy replacement does not redefine machine error codes or SQL bytes.

## Current manifest boundary

The current `package.json` exposes `./core`, `./sqlite`, `./pglite`, `./postgres`, `./kernel`, `./kernel/sqlite`, `./kernel/pglite`, `./kernel/postgres`, `./migrate`, `./package.json`, `./transfer`, `./tools`, `./kernel/store-copy`. Internal source exports do not create additional supported import paths. The contracts above describe source, not generated output.
