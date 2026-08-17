---
"@jini-ai/infra": minor
---

Add `@jini-ai/infra`, a backing-service package exposing a driver-neutral persistence core and a
selectively-installable SQLite driver as two subpath exports: `./db/core` and `./db/sqlite`.

`./db/core` carries the ports every driver implements (`DbOpsPort`, `RestoreCapability`,
`WatermarkReader`) plus the pure restore-point naming helpers. It has zero runtime dependencies and
loads with no native module present. `./db/sqlite` carries the `better-sqlite3` driver:
`openSqliteDb` (pragmas, migrations, and a post-migrate hook, all parameterized so the package never
imports a host's schema), `findOneBy`, and `SqliteDbOpsAdapter` (whole-file online backup and atomic
restore).

`better-sqlite3` and `drizzle-orm` are optional peer dependencies and the package deliberately
publishes no `.` root export, so a host running a different backend never resolves or compiles the
SQLite driver. That separation is enforced rather than documented: a new `pnpm guard` check
(`R12-driver-isolation`) fails if `db/core` imports an optional peer, a subpath of one, or anything
outside its own directory, and a runtime test proves the consequence against a real install fixture
containing only the built output. R12 derives its forbidden list from `peerDependenciesMeta`, so
declaring a future driver's client as an optional peer extends the check automatically.
