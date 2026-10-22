Spec ID: SPEC-JINI-INFRA-API
Version: 2.0.0
Last Edited: 2026-10-03T04:10:53Z
Hash: sha256:cd26214e14d9d3be508eb403f3a4875d6be2732dd9c8de80b40067e7df83ff81
spec_mode: reverse_spec

# API Contract: @jini-ai/infra

## Public entry points

This package is a deprecated ESM compatibility shim. Its complete export map is `./db/core` and `./db/sqlite`; there is no root entry. Prefer the equivalent `@jini-ai/db/core` and `@jini-ai/db/sqlite` imports for new consumers. The source says the shim is removed after one release, without identifying a removal version.

Current signatures are preserved below. They do not uniformly support `(required, optional = {})`; do not invent an object wrapper or a second argument when using the current shim.

## ./db/core

| Export | Signature / shape | Dependencies |
|---|---|---|
| `sanitizeForFilename` | `(value: string): string` | None; positional |
| `restorePointFilename` | `({ scopeId: string, watermarkAtCapture: number, timestamp: number, extension?: string }): string` | None; extension currently stays in argument 1, default `db` |
| `RestoreCostClass` | `'cheap' | 'expensive'` | Type only |
| `RestoreKind` | `'file-snapshot' | 'logical-dump'` | Type only |
| `RestoreCapability` | `{ readonly costClass: RestoreCostClass; readonly kind: RestoreKind }` | Type only |
| `RestorePoint` | `{ readonly artifactRef: string; readonly watermarkAtCapture: number }` | Type only |
| `WatermarkReader` | `(): number | Promise<number>` | Host callback |
| `DbOpsPort` | Methods below | Host database operations |

`DbOpsPort.getCapabilities(): Promise<{ restorePoint: RestoreCapability }>`, `captureRestorePoint({ scopeId }): Promise<RestorePoint>`, and `restoreFromArtifact({ artifactRef }): Promise<{ restartRequired: boolean }>` are the full port.

```ts
import { restorePointFilename } from '@jini-ai/infra/db/core';
const name = restorePointFilename({ scopeId: 'account/alpha', watermarkAtCapture: 3, timestamp: 4 });
// restore-point-account_alpha-wm3-4.db
```

## ./db/sqlite

| Export | Current signature / shape | Dependencies |
|---|---|---|
| `DEFAULT_PRAGMAS` | `readonly string[]`: WAL, foreign keys ON, busy timeout 5000 ms | Constant |
| `openSqliteConnection<Connection>` | `(options: OpenSqliteConnectionOptions<Connection>): Connection` | Host `open(filePath, {}): Connection`; optional synchronous `recover(filePath)` |
| `new SqliteDbOpsAdapter` | `(deps: SqliteDbOpsAdapterDeps)` | Live `connection`, `filePath`, `readWatermark`; optional `now(): number` |
| `OpenSqliteConnectionOptions` | `{ open, filePath: string, pragmas?: readonly string[], recover?: SqliteRecoveryHook }` | Connection structurally implements the db package's SQLite client |
| `SqliteBackupSource` | `{ backup(destination: string): Promise<unknown> }` | Consumer-owned connection |
| `SqliteRecoveryHook` | `(filePath: string): void` | Consumer recovery policy |
| `SqliteDbOpsAdapterDeps` | `{ connection: SqliteBackupSource, filePath: string, readWatermark: WatermarkReader, now?: () => number }` | Host watermark/clock |

The adapter implements all `DbOpsPort` methods and reports `{ costClass: 'cheap', kind: 'file-snapshot' }`. Connection creation returns the original typed connection; recovery precedes open, and pragmas follow open sequentially. The shim supplies no native SQLite opener or driver.

```ts
import { openSqliteConnection, SqliteDbOpsAdapter } from '@jini-ai/infra/db/sqlite';
// open is the consumer's SQLite opener and connection supports pragma and backup.
const connection = openSqliteConnection({ filePath: '/var/lib/app/store.db', open });
const ops = new SqliteDbOpsAdapter({ connection, filePath: '/var/lib/app/store.db', readWatermark: () => 42 });
const point = await ops.captureRestorePoint({ scopeId: 'tenant-a' });
```

## Coverage boundary and evidence

Both exported entries and every re-exported runtime/type name are documented. `src/events/outbox/` contains worker, drainer, and enqueue-only source but is absent from `package.json.exports` and both shim barrels; it has no supported consumer import here and is not presented as a public API.

Evidence: `package.json`, `src/db/core/index.ts`, `src/db/sqlite/index.ts`, `src/__tests__/shim-surface.test.ts`, plus the actual re-export targets in `@jini-ai/db` (`src/core/ports.ts`, `artifact-naming.ts`, `src/sqlite/open.ts`, `db-ops.ts`, `restore-types.ts`). Tests were read only. No UI exists on the exported surface.

## Current manifest boundary

The current `package.json` exposes `./db/core`, `./db/sqlite`. Internal source exports do not create additional supported import paths. The contracts above describe source, not generated output.
