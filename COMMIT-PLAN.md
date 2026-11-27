# r62t-rev-p3 Jini handoff

Base: `010c8cd874f709ffa2c61de0de4e1dde4f808aad`, branch `codex/f-p3j`.
No commits, index writes, tests, builds, installs, type-checks, linters, baseline refreshes, migration-pin generation, or catalog/lockfile generation were performed. No subagents were used. Verification and mutation executions are for Opus/cloud. All named source anchors matched this HEAD.

## Intended commits, in design order

### 1. P3-J1.J — durable scheduler and lease fencing

Implementation written; execution evidence is pending. Coordinator can review this unit separately from the stopped J2 draft.

Files:
- `packages/daemon/src/routines/types.ts`
- `packages/daemon/src/routines/scheduler.ts`
- `packages/daemon/src/routines/durable-scheduler.ts` (new)
- `packages/daemon/src/routines/__tests__/scheduler.durable.test.ts` (new)
- `.changeset/durable-routine-scheduler.md` (new)

The existing routines index and daemon root already export the scheduler/types; no additional export shell was added. `RoutineRunAttempt` and its existing why-comment moved to the durable implementation with the named claim strategy. The legacy schedule type remains in daemon pending completion of J2, so J1 has no dependency on J2's new core entry.

The durable path acquires/renews a lease, preserves the start/enable reason across passive retry, interrupts stale runs before arming, classifies stored slots, uses per-routine and service generations, claims before prepare/start, advances an active slot, and keeps active entries through terminal persistence. Manual insertion delegates the atomic holder check to persistence. Timers use the injected SchedulerPort cancellation function. Quiesce retains the heartbeat; drain uses the injected clock/timers. Persistence retries use 1/2/4/8/16 seconds and a delayed bounded reread after exhaustion.

Tests were written before production changes. Named mutation pairs (expected proofs, NOT executed proofs):

| Test | Mutation | Assertion |
| --- | --- | --- |
| restart after three missed slots fires once with catchUp and schedules the next future slot | Ignore the stored slot on boot | One handler call carries the old slot and catchUp=true; next stored slot is future. |
| 20 ms late timer is not catch-up | Treat all positive lateness as catch-up | catchUp=false for 20 ms lateness. |
| paused routine's old timer does nothing | Drop the generation check | No claim or prepare after pause while the handler awaits. |
| claim loser creates no conversation | Prepare before claim | No prepare/start; discardUnstarted exactly once. |
| pending run across the next slot consumes it without a second run | Remove active-slot advance | One run/start, and the stored slot advances again. The J2 duplicate-claim case also asserts real SQLite active-slot advancement. |
| crash after claim records Interrupted and keeps the next slot | Skip boot interruption | Interrupted row, interruption callback, unchanged next slot. |
| lease lost while handler awaits: claim returns lease-lost, prepare never called | Drop the holder check in claimDueSlot | Port contract returns lease-lost and never prepares. The J2 second-handle case exercises the actual SQLite holder predicate. |
| heartbeat renew false stops claims and logs ROUTINES_LEASE_LOST | Ignore the heartbeat result | Passive state, named diagnostic, no subsequent claim. |

Also present: repeated wake, lost-CAS reload, clock rollback, timer/wake race, enable skipping overdue slots, passive retry timing, no passive interruption, quiesce/drain lease retention, and rejected interruption-hook diagnostics with subsequent arming.

### 2. P3-J2.J — SQLite store, migration, contracts, routes

**STOPPED / INCOMPLETE. Do not commit this draft as a completed sheet or publish it in the consumable artifact.**

This is a constraint stop, not an anchor mismatch. The draft `packages/daemon/src/http/routines.ts` is 516 lines against the owner's 500-line limit. The outer `createSqliteRoutineStore` binding function spans more than 80 lines against the revised function limit. Finishing the decomposition needs explicit allowance for a named binding/refusal helper or another implementation file; neither is listed by the sheet. I stopped instead of adding that abstraction. The partial implementation and first-written tests are retained for coordinator review.

Draft files changed:
- `packages/daemon/src/routines/routine-store.ts`
- `packages/daemon/src/http/routines.ts`
- `packages/daemon/src/http/index.ts`
- `packages/daemon/src/http/__tests__/routines.test.ts`
- `packages/daemon/package.json`
- `packages/core/package.json`
- `packages/core/src/contracts/server/api-error.ts`
- `packages/core/src/contracts/server/__tests__/api-error.test.ts`

Draft files created:
- `packages/daemon/src/routines/routine-store.sqlite.ts`
- `packages/daemon/src/routines/routine-store.sqlite-schema.ts`
- `packages/daemon/src/routines/migrations/0001_jini_routines_v1.ts`
- `packages/daemon/src/routines/migrations/index.ts`
- `packages/daemon/src/routines/migrations/checksums.ts`
- `packages/daemon/src/routines/__tests__/routine-store.sqlite.test.ts`
- `packages/daemon/src/routines/__tests__/routines-migration-pin.test.ts`
- `packages/core/src/contracts/site/routines.ts`
- `.changeset/sqlite-routine-store.md`

The draft contains a borrowed-handle scoped store, immediate transactions, composite keys/FK, slot and active-run indexes, revision checks, tombstones, lease checks, sticky terminal settlement, approval-reference CAS, pruning, cursor validation, the dedicated migration ledger and host-runner injection, seven host-bound route factories, trusted creator resolution, agent/model parsing, and 507 mapping. These are not verified or release-ready.

Remaining work before this sheet can be considered built:
1. Resolve the allowed decomposition and bring the factory and route file within the owner's limits. Do not solve this by compressing further or dropping behavior.
2. Move the daemon's unchanged RoutineSchedule/Weekday definitions to core and keep the compatible daemon type export. That move is intentionally still pending after this stop.
3. Review manual insertion for a routine deleted during its awaited handler: the draft currently returns the same false result as an active-run conflict. A missing live row should preserve the route's missing-routine refusal.
4. Replace `OPUS_GENERATE_NORMALIZED_SOURCE_SHA256` with the real pin. The pin test deliberately cannot pass with the placeholder.
5. Opus must verify migration replay, source normalization/DDL coverage, no VACUUM, rollback, retention, scope predicates, metadata, API baselines, and actual mutation kills before P7-J2 ships an artifact.

First-written cases: reopen/next slot; atomic claim rollback; duplicate claim; scope isolation; pause/resume; tombstone history links; pause-versus-claim; sticky interrupted completion; CRUD/scheduler visibility; immutable creator; stale approval answer; missing/mismatched/future ledger history; second-handle takeover and stale-holder scheduled/manual claims; scoped pruning with conversations retained; pin; HTTP trusted creator/missing creator; optional model/agentId; legacy creation; SQLite busy/full refusal; core 507.

Named mutations, NOT executed:
- Split claim from advancement: the rejecting-insert trigger must leave nextRunAt unchanged.
- Trust the body creator: POST with attacker ownerId must still persist the authenticated owner.
- Drop agentId: POST must persist both the explicit agentId and model.
- Drop SQLite claim's holder predicate: the expired first handle's scheduled claim must return lease-lost after takeover.
- Remove active-slot advancement: the active-run claim must still advance the stored slot without inserting another run.

### 3. P3-T2.J — durable chat recovery admission

Implementation written; execution evidence is pending. Independent of the stopped J2 implementation.

Files:
- `packages/chat/src/core/durable-runs/ledger-contracts.ts`
- `packages/chat/src/store/runtime/run-ledger.ts`
- `packages/chat/src/store/runtime/__tests__/run-ledger.cov-j2.test.ts`
- `packages/chat/src/store/runtime/__tests__/lazy-run-ledger.test.ts`
- `.changeset/routine-recovery-admission.md` (new)

The stored InterruptedChatTurn is constructed once. Admission precedes recovery outside the write transaction. Leave-owned neither increments the handled count nor enters recovery/fallback. Rejection emits only CHAT_RUN_RECOVERY_ADMISSION_FAILED and leaves the turn owned. The lazy implementation already forwards both objects and is unchanged; the new test pins argument identity. No run-finalizer change, head port, policy, or new subpath was added.

Tests were written first: leave-owned has count zero, no recovery, no transaction, unchanged row/chat; rejection is leave-owned without leaked exception text; ordinary recovery without admission; lazy forwarding of both objects.

Named mutation, NOT executed: move recovery before admission. The leave-owned test's recovery spy must then turn red.

## Test integrity and verification

These are source declaration counts, not executed test results; parameterized cases may expand at execution:

| File | HEAD declarations | Working-tree declarations |
| --- | ---: | ---: |
| scheduler.test.ts | 34 | 34 |
| scheduler.f1.test.ts | 12 | 12 |
| scheduler.durable.test.ts | 0 | 17 |
| routine-store.sqlite.test.ts | 0 | 14 |
| routines-migration-pin.test.ts | 0 | 1 |
| http/__tests__/routines.test.ts | 79 | 84 |
| core contracts/server/__tests__/api-error.test.ts | 4 | 5 |
| run-ledger.cov-j2.test.ts | 23 | 26 |
| lazy-run-ledger.test.ts | 2 | 3 |

No existing tests were deleted or weakened. No runtime, coverage, red/green, mutation, build, lint, or type-check evidence is claimed. The dispatch explicitly forbids those commands here. Fresh read-only evidence: HEAD/branch/status, scoped source reads, full modified-file diff review, new-file reads, line counts, and source declaration counts.

## Architecture and function review

Architecture audit: WARNING overall because J2 is stopped, not release-ready. J1/T2 use existing core contracts, synchronous persistence, injected timer/clock/ID ports, and host recovery admission. The SQLite draft has no driver or db runtime import; Kysely is already a declared daemon dependency. Only entry metadata changed; no new runtime dependency or React entry was added. All new implementation files are in the sheet's named areas.

| Assessment unit | Disposition | Findings / local action |
| --- | --- | --- |
| J1 slot classification, CAS, timer generations, retry | INCONCLUSIVE | Source reviewed; direct race/slot cases written; cloud execution required. |
| J1 ownership, interruption barrier, quiesce/drain | INCONCLUSIVE | Source reviewed; fake lease/timer cases written; actual takeover remains an Opus gate. |
| J1 claim/prepare/start/settlement | INCONCLUSIVE | Named claim strategy/fireSlot split; scheduled and manual claim fences retained; post-dispatch ID persistence failure does not reclassify a launched effect as a preparation failure. |
| J2 store binding / route factories | REQUIRED | High: owner size limits exceeded; stopped without adding an unauthorized abstraction. Missing-live-row manual refusal also remains open. |
| T2 admission / reconciliation / lazy forwarding | INCONCLUSIVE | Direct count, effect-order, fallback, rejection, and forwarding assertions written; not executed. |

Inline documentation: existing why-comments preserved, including the moved attempt comment and the inline-await/finally comments. No new explanatory code comments were added. Function metrics and compile checks were not run. No claim of a clean mechanical quality gate is made.

Resource bounds present in the implementation/draft: 300,000 ms maximum routine arm, 90,000 ms lease TTL with TTL/3 heartbeat, five short persistence retries then delayed reread, 2,000 ms default drain, 200 live routines, 100 retained runs by default, 50-row history pages. J2 read/query costs still need review with its decomposition.

## Scope, deletions, and remaining builders

Removed draft-only code during review: the backward dependency from J1's scheduler test to the later J2 SQLite implementation; unsupported active-run catches on factories that cannot start a run; duplicated run-attempt construction from start_ (moved to the named claim strategy). No pre-existing files or why-comments were deleted. The pending schedule move was restored locally so J1 can stand alone.

OPUS sheets left untouched:
- P3-T1a.T
- P3-T1b.T
- P3-T3.J
- P3-T3.T

Tovu SOL sheets P3-T2.T, P3-T4.T, and P3-T5.T are outside this Jini-only dispatch and were not built. There is no P3-T5.J.

Tovu must wait for completed J2 plus the verified P7-J2 artifact. Planned additions are core universal `./contracts/site/routines`, daemon node `./routines/sqlite` (store, schema, migration runner/history/pin), and the seven factories in existing daemon `./http`. Chat admission stays on the existing chat contract surface. Keep ROUTINES_RELEASE_ENABLED off; none of the combined release gates has been run.
