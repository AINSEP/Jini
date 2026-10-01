# Vendored: @electric-sql/pglite-socket

- Upstream: `@electric-sql/pglite-socket` **0.2.11** (npm), `packages/pglite-socket/src/index.ts` in
  github.com/electric-sql/pglite. Copyright Electric DB Limited. Apache License 2.0: `LICENSE.pglite-socket` beside this file.
- Vendored 2026-09-28 into `src/pglite/socket-server.ts`, used with `@electric-sql/pglite` **0.5.8** (pinned).
- Why vendored: the fixes below, and to drop the 7 extension packages the upstream CLI pulls in
  (age, pgtap, pg_ivm, pgvector, pg_uuidv7, pg_hashids, pg_textsearch).

## Changes from upstream

1. **ReadyForQuery filter.** PGlite 0.5.8 answers an error in Parse/Bind/Execute with ErrorResponse +
   ReadyForQuery and the later Sync with a second ReadyForQuery, which shifts every later answer on the
   connection by one. `Z` frames are dropped from the answer to every typed message except Sync, Query,
   FunctionCall, CopyDone and CopyFail. Re-check on any PGlite upgrade (the "RED evidence" test in
   `src/pglite/__tests__/socket-server.test.ts` fails once PGlite fixes it).
2. **Queue wedge.** Upstream's `processQueue` returned on a PGlite exception with `processing` still true,
   so nothing was ever served again. Now the failing message's job rejects alone (its connection closes).
3. **Idle-in-transaction timeout** (new; default 30 s): FATAL 25P03, disconnect, roll back.
4. **`runExclusive(fn)`** (new): the owning process's only way to query while it serves.
5. **Disconnect rollback goes through the queue** (upstream ran `ROLLBACK` directly, beside the queue).
6. **Per-connection ordering**: a connection's data chunks are handled strictly one after another
   (upstream started each chunk's handler on its own `setImmediate`).
7. **Unix socket only** (TCP listener removed). Owner-only permissions are set by `src/pglite/owner.ts`.
8. **Refusals speak the protocol**: over the connection cap a client gets FATAL 53300 (upstream wrote plain
   text); a CancelRequest closes its connection; GSSENC requests are answered `N` like SSL.
9. Removed: hex `inspect` dumps, `EventTarget` events, debug `console.log` (replaced by an optional `log`
   callback), TCP host/port options, stats beyond connections/queued.
