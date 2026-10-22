Spec ID: SPEC-JINI-INTEGRATIONS-STATE
Version: 2.0.0
Last Edited: 2026-10-03T04:10:53Z
Hash: sha256:6710f1cac7f703e23ba11a7b6e97ecfbe9e8dcb4dce11c509a4b3f36209351a4
spec_mode: reverse_spec


# State Contract: Integrations

## Webhook persistence

The consumer repositories persist workspace-scoped subscriptions and delivery rows. A subscription records id/workspace/owner/creator identities, label/URL/topics, signing versions, active/paused/disabled status and timestamps. Create starts active; pause/resume toggles active/paused; deletion makes it disabled with disabledAt. A disabled subscription cannot pause/resume. Repeated deletion writes a new timestamp rather than preserving the first disable time.

A delivery records subscription/event/topic identities, status, attempts, nextAttemptAt, lastResponseStatus/lastError, signedWithVersion, creation/delivery/dead timestamps. Enqueue starts pending with zero attempts and null outcome fields. Atomic repo claim must select due pending/failed rows, mark delivering and increment attempts. Success becomes delivered; unsuccessful claims become failed with a retry time or dead at the attempt cap. Canceled is an exported status without a package transition; paused/disabled/missing subscription and hook veto are unsuccessful attempts.

Row enqueue precedes separate envelope save; interruption between those effects can leave a delivery without an envelope. Atomic uniqueness of subscription/event/workspace belongs to the repo. Delivery ids key envelope lookup; adapters must enforce tenant isolation even where the envelope port carries no workspace field. Claims across workers, stale delivering-row recovery, retention and durable storage are host-owned. At-least-once retries can resend a request after a response/commit crash; no exactly-once promise exists.

Integration-secret records and sealing/keyring ports describe storage but have no supplied lifecycle implementation. Signature timestamp tolerance does not persist a replay history. Previous signing versions are not automatically selected or rotated by the signing helpers.

## Registries, logs and attachment files

Capability registries are per-instance maps; normalized ids overwrite earlier entries and objects are retained by reference. `all()` returns a fresh array but not detached capability objects. Vendor registries reject duplicate provider/route pairs, retain adapters, and preserve insertion order in `list()`. Importing the main media entry registers built-in adapters into the shared `mediaVendorRegistry`. An independently created registry is not automatically consulted by the default engine.

The in-memory credential audit log appends entries to a public mutable array; it has no cap or automatic flush/retention. The console audit adapter calls the supplied logger and owns no persistence.

Attachment staging creates random-prefixed external-file copies under cwd. In-root files are returned as-is. On each nonempty stage call, regular staged files with mtime older than maxAgeMs (default 24 hours) are best-effort removed. There is no timer or close operation; the host owns eventual cleanup. Repeated external staging creates new copies and is not idempotent.

## Media task lifecycle

```text
queued -> running | done | failed | interrupted
running -> done | failed | interrupted
done, failed, interrupted -> same status only
```

Same-status updates are legal for every state. Creation can explicitly select any valid status. Default creation is queued, progress empty, file/error null, endedAt null, and startedAt/create/update timestamps from wall-clock time. Tasks are keyed by unique id with immutable ownerRef/id/createdAt/startedAt; patches can update status, surface/model, progress, result-file/error and endedAt. Reaching a terminal state does not automatically stamp endedAt; callers supply it.

Get/update of an absent task returns null; deleting one is a no-op. Returned in-memory task data is detached, including file data via structuredClone. Owner listing defaults to in-flight tasks and sorts by startedAt descending. Equal-time ordering is not specified across adapters.

`reconcileOnBoot({ terminalTtlMs, now? })` requires a finite nonnegative TTL. It marks every queued/running task interrupted with `DAEMON_RESTART`, fills an absent endedAt, then skips those newly interrupted rows for that pass. Already-terminal rows are deleted only if endedAt-or-updatedAt is strictly older than the cutoff. It returns interrupted/deleted counts. This tracker cannot resume vendor work by itself.

The in-memory store disappears on exit. SQLite uses WAL, idempotent table/index creation and transactional mutations; reopening the same path sees committed rows. `:memory:` is non-durable. `better-sqlite3` is dynamically loaded only when opening a store; callers must close it. SQL JSON serialization restricts stored file/result data more than arbitrary in-memory structured-clone values.

## Async-operation lifecycle and persistence

```text
submitted -> polling | succeeded | failed | unknown
polling -> succeeded | failed | unknown
succeeded, failed, unknown -> same status only
```

Same-status updates are legal. `unknown` is terminal for claims, meaning the vendor effect is undetermined; it is not a retry instruction. Record fields are schemaVersion, id/providerId/routeKey/ownerRef/status, attempts/maxAttempts, deadlineAt/nextPollAt, leaseOwner/leaseExpiresAt, state/result/error, createdAt/updatedAt. New rows default submitted, attempts zero, nextPollAt now, lease/result/error null. Required bounds are finite maxAttempts at least one (fractional values are currently accepted) and finite deadlineAt. Result bytes persist base64; render context and credentials are not persisted by the runtime.

`ASYNC_OPERATION_SCHEMA_VERSION = 1`. Hydration stamps absent/older discriminator to current shape in the returned object and refuses newer versions; it does not rewrite storage or fully validate every row field. State writes validate a recursive key allowlist containing only `jobId`, with maximum object nesting depth twelve. Null state is allowed. This is a key-shape guard, not an oracle proving a jobId value contains no secret.

Claiming due nonterminal rows sorts by nextPollAt ascending, defaults to ten rows, and assigns lease identity/expiry. Live leases block claims; expired ones can be reclaimed. Equal-time claim order is not a cross-adapter promise. `update` can optionally fence by leaseOwner; stale owners receive the current unchanged row. `releaseLease` is fenced. Deadline/attempt checks occur in the poll runtime; the store claim itself can claim a row past its deadline.

The runtime persists submitted before fetch, then writes polling handle or succeeded result. Post-submit writes retry after 50/150/400 ms; exhaustion retains the crash-gap row. Inline completion can still be returned even when its final persistence failed. Returning done=false means the caller must inspect the store; it includes pending work and recorded submission failure.

Boot reconciliation expires overdue nonterminal rows as unknown with `DEADLINE_EXPIRED`, releases expired/missing-expiry leases, and leaves other status/handles pollable. Recovery additionally scans submitted crash gaps: adapters explicitly declaring idempotent submit yield resubmittable ids; other gaps become unknown with `CRASH_GAP_NOT_IDEMPOTENT`. The host reissues safe submits; recovery does not submit them automatically. Recovery's collection uses claimDue with an extreme timestamp and zero-duration lease, so it must be coordinated with live workers rather than treated as a claim-free read.

The in-memory operation store is transient; SQLite is durable WAL-backed with transactional claim/write semantics and a close operation. Neither provides TTL deletion or an autonomous poll loop. Owner refs are lookup scopes, not authorization; the host enforces access and restores RenderContext for each poll.

Evidence: current webhook ports/orchestrators, media registries/staging/task stores, and `dispatch/{async-operation-store,sqlite-async-operation-store,operation-runtime}.ts`; inspected store, boot-recovery, lease-fencing, and durable-reopen tests.
