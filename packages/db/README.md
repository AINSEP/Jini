# `@jini-ai/db`

One async storage kernel over [Kysely](https://kysely.dev) for SQLite, PGlite and Postgres, with a
migration runner. A query is one Kysely body that runs unchanged on every dialect.

| Subpath | What it holds | Needs installed |
| --- | --- | --- |
| `@jini-ai/db/kernel` | `StorageKernel` port, `buildKernel`, `TurnLock`, dialect helpers and introspection, `scopeToSchema`, `readSchemaShape`, `renderDatabaseTypes`, the `StorageOps` contract | `kysely` |
| `@jini-ai/db/sqlite` | `sqliteKernel`, `openSqliteFileKernel`, `openMemorySqliteKernel`, `closeSqliteConnection`, `sqliteOps` | `kysely`, your `better-sqlite3` |
| `@jini-ai/db/pglite` | `openPgliteKernel`, `PgliteDialect`, `startPgliteOwner` (one process serves a data dir on a private Unix socket), `PgliteSocketServer`, `pgliteOps` | `kysely`, your `@electric-sql/pglite` **0.5.8** |
| `@jini-ai/db/postgres` | `openPostgresKernel` (pool), `openPgliteSocketKernel` (one connection to a PGlite owner), `postgresOps` | `kysely`, your `pg` |
| `@jini-ai/db/migrate` | `runMigrations`, `assertValidSteps`, `hasLedger`, `sourceChecksum`, step and error types | `kysely` |

There is no `.` export: Node does not tree-shake, so a root barrel would load every driver for
everyone.

## This package never imports a driver

`better-sqlite3`, `pg` and `@electric-sql/pglite` are optional peer dependencies, and no file here
imports one at runtime. You pass your own:

```ts
import Database from 'better-sqlite3';
import { PGlite } from '@electric-sql/pglite';
import pg from 'pg';

const local = openSqliteFileKernel<MyDb>({ filePath: 'app.db', open: (p, o) => new Database(p, o) });
const embedded = openPgliteKernel<MyDb>({ PGlite }, { dataDir: './pgdata' });
const server = openPostgresKernel<MyDb>({ pg, connectionString: process.env.DATABASE_URL! });
```

Why: two copies of the SQLite library in one process share one set of POSIX locks, a documented way
to corrupt a database. With the driver always yours, there is only ever one copy.
`loads-without-driver.test.ts` imports every subpath in an install that has no driver at all, and
checks that each one loads only its own files plus `kernel/`.

## Nothing is named for you

This package ships no tables and no app names. You name them:

- `runMigrations(kernel, steps, { ledgerTable: 'myapp_migrations' })`: `ledgerTable` is required.
  `appName` sets the "upgraded by a newer …" error text.
- `startPgliteOwner({ dataDir, PGlite, lockFileName: 'myapp-owner.pid', runDirName: 'myapp' })`:
  the pid lock file in the data dir, and the socket dir `~/.myapp/run/<key>` (or
  `/tmp/myapp-<uid>/<key>` when home is too deep for a socket path).
- `pgliteOps(kernel, { PGlite, ledgerTable, ownerLockFileName })` and
  `postgresOps(kernel, { ledgerTable })`: compaction reads your ledger back.

Your schema, your `DB` interface (generate it with `renderDatabaseTypes` from a migrated Postgres or
PGlite), your ordered `MigrationStep[]` and their pinned checksums all stay in your app.

## Types across a linked install

`kysely` is a peer. Kysely's classes carry `#private` fields, so TypeScript treats two installed
copies as different types unless they have the same name and version. Install the same kysely
version as this package's dev copy (`0.29.6`). The better-sqlite3 and pg types here are structural
(`SqliteClient`, `PgModule`), so they never conflict; `PgliteClass` is `typeof PGlite`, so keep
`@electric-sql/pglite` at exactly 0.5.8 on both sides.

## License

Apache-2.0. `src/pglite/socket-server.ts` is derived from `@electric-sql/pglite-socket` 0.2.11
(Apache-2.0): see `LICENSE.pglite-socket` and `NOTICE.md`.
