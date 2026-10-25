# `@jini-ai/infra`

Deprecated compatibility package: replace `@jini-ai/infra/db/core` with `@jini-ai/db/core` and
`@jini-ai/infra/db/sqlite` with `@jini-ai/db/sqlite`.

This package and its published exports remain available for compatibility. The package owner
applies npm registry deprecation at publish time; the manifest notice does not deprecate existing
registry versions by itself. The retained outbox owner is exposed as `@jini-ai/infra/events/outbox`;
the database entries remain compatibility shims.

`@jini-ai/db` is an optional peer, required only by `./db/core` and `./db/sqlite`.
Hosts using those entries must declare and install it explicitly; the published peer range
tracks the matching workspace db release. `./events/outbox` works without db installed and
requires only the regular `@jini-ai/core` dependency. The compatibility entries continue to
re-export db's implementations; no database driver is loaded by the shim itself.

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

`src/db/core` remains an R12 neutral directory declaring the naming port. The published `./db/core`
compatibility entry binds that port in `src/db/driver` and preserves the canonical helper identities
and original exports, including erased types. `shim-surface.test.ts` freezes both original name lists.

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

### Opt-in fenced delivery

`processFencedOutbox(input, options = {})` accepts `scope`, `outbox: FencedOutboxPort<Event>`,
`authorize({ claim }, options = {})`, `dispatch({ claim }, options = {})`, and the same injected
clock, scheduler, randomness and logger as `processOutbox`. Its second argument is the existing
`OutboxWorkerOptions`. It returns the number of claims, including denied/unresolved attempts.
It never changes `OutboxPort`, its four statuses or the legacy worker's recovery behavior.

The host adapter implements four methods: `recoverExpired`, `claimReady`, `beginDispatch` and
`complete`. Storage and schema remain host-owned.

Enqueueing is the separate, opt-in `FencedEnqueuePort<Event, Tx>`:
`enqueueWithReceipt({ intent }, { transaction } = {})`. The intent carries `event`, `scope`,
`idempotencyKey` and `requestDigest` (use `outboxRequestDigest({ request })`: sha-256 of the
request's canonical JSON). Unique `(scope, idempotencyKey)` returns `{ status: 'inserted' }`, a
same-digest replay `{ status: 'existing' }`, and a different digest
`{ status: 'conflict', reason: 'request-digest-mismatch' }` with the original row preserved. With
`{ transaction: liveSession }` the insert joins the caller's exact live session and commits or rolls
back with the caller's own intent writes; enqueue never opens, commits or retries a transaction.

`InMemoryFencedOutbox` (with `InMemoryTransaction`) is a reference adapter implementing both ports.
`fencedOutboxConformance({ createSubject })` returns framework-neutral `{ name, run }` cases
(receipts, transaction commit/rollback, fencing, lease recovery, uncertainty); run them against
every host adapter, e.g. `for (const c of cases) it(c.name, c.run)`. Jini runs them against the
reference adapter; it does not run them against any real database.

Claims include a mandatory token, expiry and one-based attempts. The worker authorizes each claim,
persists `leased → dispatching` under a scope/id/token/state/expiry fence, and rechecks expiry after
that await before dispatch. An expired `leased` row never passed that fence, so it was never sent
and recovers to `pending`; only an expired `dispatching` row recovers into `uncertain`, which is
excluded from automatic claims. Transport returns `DispatchResult`:

| kind | completion |
|---|---|
| `delivered` | delivered |
| `permanent-failure` | failed |
| `confirmed-no-effect` | pending with existing retry policy/backoff, or failed at its cap |
| `uncertain`, invalid result, throw, timeout | uncertain; host reconciliation required |

Late results never release uncertain rows. Completion acknowledgement failure never becomes a
delivery retry: storage may have committed before throwing. `authorize` and `beginDispatch` are
each bounded by `deliveryTimeoutMs`; a hung gate records no completion and the lease expiry decides,
so a pump's `stop()` cannot wait on it forever. An unavailable fence prevents dispatch;
unavailable storage can leave a leased/dispatching marker until recovery rather than immediately
recording literal uncertainty. Only host reconciliation can resolve uncertain effects. The port
contract and DI tests do not establish real host-adapter atomicity; run the conformance cases.

### Independent serial pump

`createSerialPump({ scheduler, intervalMs, callback }, { onError } = {})` has no outbox dependency.
Construction schedules nothing. `intervalMs` must be a positive safe integer. `start({}, {})` is
idempotent while running and waits the full interval before the first callback. Each subsequent
callback waits the same interval after settlement, regardless of its result or failure. Callback
and error-reporter arguments follow the `(input, options = {})` convention.

`stop({}, {})` is terminal and idempotent: it cancels queued work and awaits the **entire** active
callback, including rejection. A throwing error reporter cannot end the loop. Each instance owns
its lifecycle independently. The legacy `startOutboxDrainer` keeps its initial zero delay, full-batch
acceleration, nonnegative interval and bounded-drain shutdown behavior through the same private
scheduling mechanism.

```ts
import { createSerialPump, processFencedOutbox } from '@jini-ai/infra/events/outbox';

const pump = createSerialPump({ scheduler, intervalMs: 1000,
  callback: async () => processFencedOutbox({ scope, outbox, authorize, dispatch,
    clock, scheduler, random: Math.random, logger }),
}, { onError: ({ error }) => logger.error({ message: 'pump failed' }, { error }) });
pump.start({});
// During host shutdown:
await pump.stop({});
```
