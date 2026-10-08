# `@jini-ai/infra`

Deprecated compatibility package: replace `@jini-ai/infra/db/core` with `@jini-ai/db/core` and
`@jini-ai/infra/db/sqlite` with `@jini-ai/db/sqlite`.

This package and its published exports remain available for compatibility. The package owner
applies npm registry deprecation at publish time; the manifest notice does not deprecate existing
registry versions by itself. The retained outbox owner is exposed as `@jini-ai/infra/events/outbox`;
the database entries remain compatibility shims.

Version 0.4.0 keeps the 0.3.3 names at `@jini-ai/infra/db/core` and
`@jini-ai/infra/db/sqlite` for existing ESM consumers. Database implementations and their tests
now live in `@jini-ai/db`. This shim has no driver peer dependency and no CommonJS build.

```ts
import type { DbOpsPort } from '@jini-ai/db/core';
import { openSqliteConnection, SqliteDbOpsAdapter } from '@jini-ai/db/sqlite';
import Database from 'better-sqlite3';

const connection = openSqliteConnection({
  filePath: 'app.db',
  open: (filePath, options) => new Database(filePath, options),
});
```

`openSqliteConnection` now requires an injected `open`. It has no known host callers; the existing
consumer uses `SqliteDbOpsAdapter`. The injected opener returns the host's own driver handle, and
custom pragmas still replace the defaults. See `packages/db/README.md` for the complete subpath map,
load-time requirements and isolation tests.

`src/db/core` remains an R12 neutral entry. Its explicit re-exports preserve the old surface rather
than exposing db's new shared constants. `shim-surface.test.ts` freezes both original name lists,
including type-only exports.

## Design decisions

- [Worker-owned bounded outbox retries](docs/decisions/DR-001-bounded-outbox-retries.md).

## Kernel contracts

The outbox entry owns generic delivery, retries, enqueue-only views and drain scheduling. Its source
uses core `Clock` (`nowMs()`) and `Pick<Logger, 'error'>`; structured errors go in logging's second
argument. Reliability rationale stays in symbol JSDoc. The existing six-attempt policy,
claim leases, timeouts, envelope identity and host-owned storage remain unchanged.

```ts
import { createNodeOutboxScheduler, processOutbox } from '@jini-ai/infra/events/outbox';

await processOutbox({ outbox, bus, clock, logger, random: Math.random,
  scheduler: createNodeOutboxScheduler({}) });
```

The host's outbox and bus receive `{ event }` objects. Claims receive `{ batchSize, nowIso,
claimLeaseMs }`; storage remains host-owned. Start the drainer only after the delivering process
subscribes its real handlers. Importing the entry or creating a scheduler starts no background work.
