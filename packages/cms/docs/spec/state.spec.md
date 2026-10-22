Spec ID: SPEC-JINI-CMS-STATE
Version: 2.0.0
Last Edited: 2026-10-03T04:10:53Z
Hash: sha256:afb9accb18593ffc61578b7ef460ff73b1c76c76c9f05ee3ca0dd5d7b324c47f
spec_mode: reverse_spec


# CMS state and persistence contract

## Host persistence boundary

The package exports repository ports and reference in-memory implementations. General database persistence, migrations and transaction isolation belong to the host. In-memory rows survive only for the lifetime of their object. Seed arrays and returned records are not a promise of deep immutable snapshots; consumers must avoid mutating returned data outside the write services.

`InMemorySettingsRepo` implements snapshot/restore transactions for its own tracked state; rollback does not cover unrelated adapters, external event enqueue or arbitrary host callbacks. Settings explicitly refuses overlapping/nested transactions. Entry, content-type and taxonomy in-memory transaction methods simply call the callback, without rollback or isolation. Durable hosts must supply real shared transactions for revisions/watermarks/side effects.

## Audited commands and delivery records

`ChangeSetStatus` vocabulary is proposed/applied/reverted/discarded. The exported command executor creates applied records with one item at position 0; it does not implement proposing, approval, reversion or disposal. Items retain inverse payload/version information when supplied. A nonempty command key is workspace-scoped; its durability and uniqueness depend on the change-set store. No expiry or automatic key cleanup exists.

Core outbox vocabulary is pending/processing/delivered/failed. The host claims batches and marks outcomes. `markFailed` persists the caller's `nextStatus` and `nextAttemptAt`; pending reenters delivery, failed is terminal for `claimPending`. Retry cap, backoff, lease recovery and dispatch schedule are host policy. The package exports no bus/outbox implementation or supervisor lifecycle.

## Navigation documents and derived bindings

Menu rows hold tree, locations, status and version. Live → trashed is soft deletion; a later unbound/forced delete physically purges. Update requires matching expected version and rejects non-live rows. Location bindings are a derived index of menu locations; assignment updates both representations via separate effects. Rebuild can repair drift from menu documents, replaces workspace bindings and refreshes timestamps. No cache or automatic reconciliation loop is started.

The read model is a closure over repositories/resolver with no disposal or persisted state of its own. Its non-URL target default is unavailable until the host binds resolution.

## Content types, entries and revisions

Content-type records start active/version 1. Schema replacement increments version and appends revision. Lifecycle transitions are active ↔ deprecated → tombstone; tombstone timestamp starts the cleanup retention window. Tombstone cannot be revived or registered over. After eligible planning and gateway-confirmed execution, cleanup physically removes the type and scoped rows through a host-bound repository.

Entries start draft/version 1 with `publishedAt:null`. Publish/unpublish/update increment version and append corresponding revisions; import preserves source ID and transferred publication state, with absence-versus-numeric-version checks. Type is immutable on import-as-update. Old fields remain in stored JSON until explicitly rewritten, but visible-field selection filters against current definitions. These subpaths supply no entry deletion service or retention sweeper.

Index DDL runs after schema persistence; outbox enqueue runs after entry persistence. Hosts must recover those partial completions rather than assuming promise rejection means no state changed.

## Settings stores and caches

Definitions have active/deprecated/alias/tombstone statuses and logical setting IDs independent of names. Rename retains the logical ID, writes a marker for the old name and retargets prior aliases; retype versions the definition without rewriting all existing values. Tombstones resolve as absent on normal reads; raw reads retain tombstone status for write diagnostics.

Global/workspace/user value rows have set/cleared state. Clearing writes a cleared marker plus revision; it falls through to lower layers. Revisions carry monotonically allocated sequence numbers; the in-memory adapter resumes above the largest seeded sequence. Reset processes the caller's supplied keys in one transaction. Purge removes workspace/user values, retains the definition ledger and records deletion evidence.

Definition cache state is `WeakMap<SettingsRepoPort, {definitions:Map,epoch:Map}>`, keyed by workspace/platform, namespace, key and epoch. Namespace invalidation increments an epoch across tenants; old entries remain allocated but are never selected again. There is no TTL, size limit or cross-process invalidation. Cache misses, including null results, are cached. Hosts writing definitions from another repository instance/process must arrange invalidation or avoid sharing stale cached resolvers.

There is no layer-value cache. `invalidateWorkspaceSettingsCache` is intentionally a no-op seam. Coercers form a module-global map; `identity` is predefined and registration replaces the value at the supplied tag. No unregister/reset method exists.

## Media blobs, renditions and GC

Media is active or trashed; purge removes its row and rendition rows. Source hash is immutable. Blob rows are active or tombstoned; deduplicated re-upload can resurrect a tombstone. Transform definitions are append-only versions. Renditions are keyed by workspace/source hash/transform name/version and may be generated lazily.

Hash, transform-registry and rendition locks are independent module-local keyed mutex maps. Same-key sections run FIFO; different keys run concurrently; a rejection does not poison later sections. Settled tails are removed after the last queued operation. There are no timeout, abort or cross-process lease semantics.

Blob-GC lifecycle is active → tombstoned → eligible after 30 days → journaled and blob row removed → bytes unlinked and journal drained. Unlink preserves bytes if a blob row has been recreated. Separate journal-save/row-remove calls require host atomicity for crash guarantees. Source-row reference checks are built; content/snapshot references and orphan sweep are stubs. No automatic worker is started.

`InMemoryBlobStore` keeps bytes in memory. `LocalFsBlobStore({rootDir})` persists files under the supplied root, uses workspace/hash-derived storage keys and supports idempotent absent-file removal and exclusive create-only `putIfAbsent`. Plain `put` overwrites directly; there is no temporary-file/rename publication or fsync contract. There is no close/flush lifecycle. The host owns trusted root/key policy and disk retention. Sharp is loaded on first actual transform; missing module failures remain dependency errors, not a store lifecycle.

## Workspace and presentation

Workspace create allocates ID/time; update preserves identity; hard delete refuses the final row based on a separate list check. The package does not cascade tenant cleanup. Presentation stores one active-theme identity per workspace and no compiled UI/theme assets.

Evidence: `src/core/ports.ts`, `src/core/commands/*`, domain repositories, settings resolver, media locks/store/GC and service implementations.

## Trash and sweeping


Trash state is split between host entity visibility/version and indexed TrashItem snapshots. The transaction port must cover both adapter mutation and index write/delete. The service does not supply a database transaction implementation. Restore/purge use captured entity version and preserve rows when that version changed; index-only forget does not touch the entity.

InMemoryTrashRepo keeps rows and leases in separate Maps; it starts empty and is not durable. Entity identity is workspace/entityType/entityId; a repeated identity insert is ignored. Find/list return shallow row copies, while all returns an array of retained row references. Listing uses ISO string ordering and excludes expired items. Cursor is base64url of trashedAt + NUL + ID; malformed cursor is treated as absent, not rejected/authenticated.

Due claims are ordered by purgeAfter, available only when no unexpired lease exists, and record owner/expiry. Deleting a row removes its lease. Failed/forbidden/unavailable/stale-version sweeps retain lease until expiry; explicit releaseLease is exposed but the sweep does not call it. Claims cross workspace boundaries and re-read the row within each purge transaction, so restored/removed index rows stand down.

The sweeper owns only scheduler handle, stopped flag, and in-flight Promise. It schedules immediately, continues after failures via optional error reporting, avoids ordinary tick overlap, and stop waits current work. It cannot interrupt a hung supplied dependency. Durable repo implementations must make claimDue atomic across workers; the memory repo's synchronously performed Map transition works only within its instance.


## Settings revision stream

`registerSettingsRoutes` retains an active-stream set and disposed flag. `dispose()` is idempotent, closes current feeds and makes future requests return 503; it does not remove Express routes or destroy the CMS service/repository.

Each authorized connection owns cursor, last-emitted id, closed flag, poll/authorization in-flight flags and three scheduler cancellation callbacks. Initial head/read or schedule failure removes close listeners and cancels schedules. Request/response close or permission denial cancels schedules and ends the response. Scheduler cancellation callbacks must be idempotent and nonthrowing.

Absent/invalid Last-Event-ID starts at current head; accepted nonnegative finite ids clamp to head. Internal cursor progresses over invisible rows; visible event ids use batch.cursor. Poll errors leave cursor unchanged for retry; authorization errors retain the stream rather than fail closed. Poll and authorization checks do not overlap with their own previous check. Feed data contains namespaces only, not setting values. Persistent definitions, values and revision ledger belong to the injected CMS ports.

