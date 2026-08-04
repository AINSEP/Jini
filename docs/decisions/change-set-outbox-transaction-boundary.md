# Change-set + outbox co-persistence: why it's a third argument, not a shared transaction handle

## The mechanism

`ChangeSetRepoPort.insert()` accepts an optional third argument, `event?: DomainEvent`. A durable
adapter co-persists that event as a durable outbox row inside the same transaction it already uses
for the change-set header + items; an in-memory adapter simply forwards it to the injected event
bus unchanged. `executeCommand()` (`core/commands/command.ts`) passes its `change-set.applied`
event through this argument instead of making a separate `outbox.enqueue()` call afterward — so a
durable adapter can never persist the change-set record without also persisting the delivery
record for its own completion event, or vice versa.

## Why a third argument, not a threaded transaction handle

The obvious-looking alternatives — thread an explicit transaction handle through `OutboxPort`, or
have a coordinator enclose the whole domain write in one transaction — are both unbuildable given a
verified, driver-specific fact: a synchronous SQLite transaction API (`transaction<T>(fn: (tx) =>
T): T`) cannot host an async callback, and both `OutboxPort.enqueue()` and
`ChangeSetRepoPort.insert()` are `Promise`-returning. Threading an async handle through every port
that might participate would require either an unsafe held-open transaction or a new abstraction
with zero other consumers. Adding the event as an optional argument on the one call site that
already owns a synchronous transaction boundary needed no such abstraction.

## What this resolves, and what it deliberately doesn't

- **Resolves:** exactly one producer — `executeCommand()`'s own `change-set.applied` event. Nothing
  else in this codebase's other direct `OutboxPort.enqueue()` call sites is touched by this
  decision; each is its own future slice, to get the same co-persistence pattern applied locally
  only once its own durability is actually prioritized. This is not a mandate to convert every
  producer now.
- **Does NOT resolve:** the domain mutation write itself (`mutation.execute()`) is still outside any
  shared transaction. `executeCommand()`'s existing compensating-rollback path — on a change-set
  persistence failure after a successful `execute()`, calling `mutation.rollback()` to restore the
  entity to its pre-`execute` state — remains the mechanism that keeps "mutation without a record"
  from surviving, pending a later migration phase that gives domain writes a shared
  transaction-participating boundary. Until that phase lands, `rollback()` is not dead code and
  must not be treated as a temporary shim to delete.

## Source

This engine's originating host product resolved this as a dedicated design decision (its own
production-readiness architecture record, BR-04 resolution) after a prior fold-in flagged the
outbox-transaction question as needing its own resolved design rather than routine coding. The
citation to that record has been dropped from the code — this document is where the rationale now
lives, per this repository's decision-record convention (see `README.md` in this directory).
