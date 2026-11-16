# Coverage pass: packages/db + packages/agent-runtime

Branch `test/coverage-jini-db-runtime` (from `origin/integ/wave-b`). Node 24.22.3, per-package vitest v8 with `--coverage.reportOnFailure` (a failing baseline suite otherwise writes no coverage at all).

## Totals (lines / branches)

| package | before | after | tests before -> after |
|---|---|---|---|
| db | 86.21% / 98.6% (8 pre-existing failures) | **100% / 99.95%** | 861 -> 936 |
| agent-runtime | 99.71% / 99.43% (6 pre-existing failures) | **100% / 99.98%** | 4490 -> 4557 |

No test was deleted, skipped, softened, and no `exclude`/threshold/ignore comment was changed.

## packages/db, per file (before -> after, lines/branches)

Root cause of the 85% figure: `src/data-modules/*` showed **0%** because its only tests import `@jini-ai/db/data-modules` (resolves to `dist`), so v8 never saw `src`. New `src/data-modules/__tests__/data-module.unit.test.ts` imports src directly (real in-memory + temp-file SQLite, PGlite for the Postgres dialect, injected `checkHeadroom`, wrapped-store fakes for post-commit/verification failure).

| file | before | after |
|---|---|---|
| data-modules/data-module.ts | 0/0 | 100/100 |
| data-modules/migration-journal, plugin-identity, snapshot, disk-headroom, migration-recovery, restore, plugin-store, index | 0/0 | 100/100 |
| migrate/runner.ts | 97.8/97.1 | 100/100 (onBackupError/onBackupComplete paths) |
| migrate/legacy-ledger.ts | 100/88.6 | 100/100 |
| sqlite/db-ops.ts | 95.6/90.9 | 100/100 |
| kernel/session-lock.ts | 100/81.3 (1 fn) | 100/100 |
| transfer/copy-order.ts | 100/89.7 | 100/100 (see seams) |
| sqlite/transaction.ts | 100/95.5 | 100/97.7 |
| sqlite/checked-client.ts, kernel/kernel-core.ts, secrets-vault/repo.sql.ts, sqlite/backup-policy.ts | 100/95-99 | 100/100 |

## packages/agent-runtime, per file (before -> after, lines/branches)

| file | before | after |
|---|---|---|
| model-discovery-yaml.ts | 78.1/78.4 | 100/100 (differential test against the original regex over ~600k strings) |
| defs/antigravity/event-stream.ts | 86.4/80.4 | 100/100 |
| ai-trace/recorder.ts | 97.5/94.6 | 100/100 |
| ai-trace/sinks.ts, providers/tool-turn.ts, agent-protocol/core/json-line-stream.ts | 96.8-99 | 100/100 |
| defs/antigravity/index.ts | 99.1/94.9 | 100/100 |
| claude-stream, claude-code-models, diagnostics, claude-filesystem-policy, model-discovery, native-tool-policy, defs/claude | 100/95-99 | 100/100 |
| agent-protocol/acp/models.ts | 100/98.7 (1 fn) | 100/99.3 |

## Files left / exceptions (all >= owner floor 99% lines)

- `db/src/sqlite/transaction.ts` 1 branch: the `finally { revoke() }` backstop at the end of `withSqliteTransaction`; v8 reports the implicit finally alternative, no distinct runtime path.
- `agent-runtime/src/agent-protocol/acp/models.ts:393` `if (completed) return;` in `finishAcpProbeProcess.settle`: defensive idempotency guard. Every path that could re-enter `settle` first removes the `close` listener and clears `exitTimer`, so it is unreachable; left in place (removing a defensive guard is a behaviour/robustness call for the owner).
- No file needed a live Postgres. The Postgres dialect is exercised through PGlite; the `pg` pool path (`session-lock`) through the existing fake-Pool style. `*.postgres.test.ts` (live-DB) suites were not run.

## Seams / production edits (no behaviour change)

1. `db/src/transfer/copy-order.ts`: three unreachable guards replaced by typed assertions with the invariant in a comment (`inDegree.get(...) ?? 0` x2, `ready.shift() === undefined` throw). Endpoint membership is validated earlier in the same function and the loop condition guarantees a non-empty queue.
2. `db/src/sqlite/db-ops.ts` `reserveRestorePoint`: `for(;;)` rewritten as recursion on `EEXIST` (identical filenames/stamps) so the function has no unreachable tail.
3. `agent-runtime/src/agent-protocol/acp/models.ts`: removed `if (signal?.aborted) { abort(); return; }` after `addEventListener`; an already-aborted signal throws synchronously at the top of the same executor, so it was dead.

No DI seams were needed.

## Bugs found

None asserted RED. Observation only (not changed, both adapters agree, pinned by a test): `SqlSecretsVaultRepo.put` with `isDefault` omitted on an existing, unmoved record returns `isDefault: false` (`secrets-vault/repo.sql.ts` `defaultForPut`, line ~163), i.e. rotating the sole default without an explicit flag clears the default. Probably intended to be set explicitly by the service layer; worth an owner check.

## Pre-existing failures on the unmodified tree (not caused by this work)

- db (8): `loads-without-driver.test.ts` x7 (`m.toBool is not a function`, subpath imports of `@jini-ai/core` in an isolated install; likely stale/partial `core` dist vs the test's packed install) and `security-defaults.source.test.ts` (8 files mention `apps/website` in comments).
- db `tsc --noEmit`: `transfer/__tests__/copy-order.test.ts(65)` type error, pre-existing.
- agent-runtime (6): `index.test.ts` (barrel name collisions), `providers/__tests__/oauth-tokens.test.ts` x3 (warn args now `"Error(EIO)"` and full path vs test's expected `"Error"`/filename), `defs/__tests__/amr.test.ts` x2 (preferred-model ordering).

## Commits

All on `test/coverage-jini-db-runtime`; see `git log origin/integ/wave-b..`.
