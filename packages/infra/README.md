# `@jini-ai/infra`

Backing-service infrastructure for a Jini-hosted site. Today that means one thing — the database —
exposed as two subpath exports: `./db/core` (driver-neutral ports and pure helpers) and
`./db/sqlite` (the `better-sqlite3` driver).

```ts
import type { DbOpsPort } from '@jini-ai/infra/db/core';
import { openSqliteConnection, SqliteDbOpsAdapter } from '@jini-ai/infra/db/sqlite';
```

## The point of the split

A host that runs Postgres or Supabase should never compile `better-sqlite3`. That is not a
nice-to-have here, it is the reason the package is shaped this way:

- **No ORM on the public surface.** This package exports connection lifecycle and database
  operations, never query building. It has no opinion about — and no dependency on — how you query.
  An earlier version exported Drizzle-typed helpers; they were removed because an ORM's class types
  carry private/protected members and therefore cannot cross a package boundary when the consumer
  resolves its own copy. Schemas, migrations and queries belong to the host.
- **The driver is an optional peer dependency.** `better-sqlite3` is declared in
  `peerDependenciesMeta` as optional, so `npm install @jini-ai/infra` on its own pulls no native
  module and triggers no node-gyp build.
- **There is no `.` export.** A root barrel re-exporting both subpaths would load the driver for
  everyone regardless of which subpath they imported, because Node does not tree-shake — whatever
  the static import graph reaches gets resolved and executed. Omitting `.` is what makes the
  separation real rather than aspirational.
- **`db/core` is closed under relative imports.** Nothing in it may import a sibling directory, so
  it cannot reach a driver transitively either.

## How that promise is enforced

Two checks, because the static and behavioural failure modes are different:

| Check | Where | Catches |
| --- | --- | --- |
| `R12-driver-isolation` | `pnpm guard` (`scripts/check-driver-isolation.ts`) | `db/core` importing an optional peer, a subpath of one, or anything outside its own directory |
| `loads-without-driver.test.ts` | `pnpm --filter @jini-ai/infra test` | The consequence: a real install fixture containing only the built `dist/`, proving `./db/core` imports with no driver resolvable |

R12's forbidden list is **derived from `peerDependenciesMeta`**, not hardcoded. Adding `pg` as an
optional peer automatically extends the check with no edit to it. Opt-in is via `jini.neutralEntries`
in `package.json`; packages that do not declare it are not scanned.

The runtime test carries a deliberate positive control (`./db/sqlite` must *fail* to import in the
same fixture). Without it, a fixture that accidentally included the driver would still show
`./db/core` loading fine and the test would prove nothing.

## Adding a second driver

The layout anticipates it: add `src/db/<driver>/`, declare its client as another optional peer, and
add the subpath to `exports` and `typesVersions`. Nothing in `db/core` changes, and R12 starts
guarding the new driver's package name on its own. Shared logic goes in `db/core` — there is
deliberately no "shared but not core" bucket, because a third directory is exactly how the isolation
rule gets quietly bypassed.

## `DEFAULT_PRAGMAS`, and a measured caveat

`openSqliteConnection` applies `journal_mode = WAL`, `foreign_keys = ON`, and `busy_timeout = 5000` unless
you pass your own list (which **replaces** the defaults rather than extending them).

Measured against better-sqlite3 11.x opened with no pragmas at all: `foreign_keys` is already `1` and
`busy_timeout` is already `5000`. Only `journal_mode = WAL` actually changes behaviour; the other two
restate a driver default so the guarantee survives a driver change. The practical consequence is that
neither can be used to test whether the pragma list ran — `journal_mode` on a file-backed database is
the only usable probe.
