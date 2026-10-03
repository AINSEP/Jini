Spec ID: SPEC-JINI-CMS-BEHAVIOR
Version: 2.0.0
Last Edited: 2026-10-03T04:10:53Z
Hash: sha256:e8d91d4ea9a7627118e36a2c9674958e9688a7215688c4c63023691f33719e27
spec_mode: reverse_spec


# CMS behavior contract

## Command gateway and tool guards

`executeCommand` checks authorization wiring before all work. Providing exactly one of `deps.authorize` and `command.permission` throws an ordinary wiring error. Providing neither selects the legacy unguarded path. With both supplied, denial occurs before looking up an idempotency key, so a denied caller cannot learn an earlier change-set ID.

Execution order is authorization → workspace-scoped command-key lookup → inverse capture → mutation → capture resulting version → change-set insert. Reuse of a nonempty key rejects with `DuplicateCommandError`, rather than replaying a cached result. There is no TTL. On insertion failure the optional mutation rollback is awaited. A unique-constraint failure is translated into a duplicate only when re-querying that workspace/key finds a winning row. Without a rollback callback or shared host transaction, the domain write can survive an audit failure. Failures in version capture, clock or ID allocation after mutation also precede the insertion catch block.

When outbox wiring is present, the gateway passes `change-set.applied` through `ChangeSetRepoPort.insert`'s optional `event`; it does not call the outbox directly. The adapter must persist header, items and event atomically. This does not itself make `mutation.execute` part of the same transaction.

`assertEntityLive` accepts live rows and rejects trashed/tombstoned rows with stable codes. It does not fetch rows. Tool helpers reject malformed inputs, missing catalog entries and inconsistent handler/risk declarations. Schema decoration applies only when the supplied shape-error predicate matches. The human-confirmation handler runs prepare → askHuman → run only for an affirmative answer; a declined answer returns the host result. It passes the context principal ID as a user confirmer without checking principal kind itself. Host callbacks own confirmation transport, human identity checks and authorization.

## Navigation

- Create stores a live menu at version 1. Tree update checks expected version, rejects non-live rows and increments version. Slugs are unique within a workspace. Menu services do not authorize callers themselves; host tools/routes own permissions.
- Default tree limits are depth 5 and 500 items. Validation clones input; IDs must be globally unique within the tree. Reserved target kinds are rejected. URL targets must satisfy the exported href allowlist; use that predicate rather than inventing a second allowlist.
- Assigning a location moves the location from the previous menu to the new live menu and updates both documents and binding index. Reassignment is last-writer-wins. These writes and event enqueues are separate effects, with no service-level transaction.
- Delete first trashes a live menu. Purging a trashed menu is blocked while locations are bound, unless force is supplied; successful purge removes bindings and row. There is no exported unassign service even though contracts/catalog vocabulary describes unassignment.
- Resolution preserves sibling order and unavailable nodes. Current-path matching is exact string equality; ancestor active state derives from children. Non-URL targets use the injected resolver; the read-model default resolves them to unavailable. Missing labels become empty strings; target-title fallback is absent. There is no render-time href sanitization in the resolver.
- Rebuild derives bindings from stored menu locations. On duplicate location claims, the later menu in repository list order wins. Re-running preserves assignments but refreshes `boundAt`; no canonical menu-list ordering is imposed.

## Content types and entries

Content-type registration authorizes `admin.collections.manage` before validation. Guards run in order: key identifier grammar `^[a-z][a-z0-9_]{0,63}$` → reserved `post`/`page` keys → field names and uniqueness → closed field-kind vocabulary → storage-only/queryable restriction → at most 20 queryable fields. Registration refuses any existing key, including tombstones, and rechecks inside the host transaction. It creates an active version-1 type and revision; optional watermark stamping is awaited inside that transaction. Index provisioning happens after commit.

Field replacement loads the type, rejects tombstones, checks expected version before the empty-fields floor and field guards, then replaces the schema/optional label and increments version. Removed fields are allowed. Index transitions are computed by field-name union and run after the row/revision commit. A provisioning failure can therefore reject after durable data changed.

Field kinds are `text`, `integer`, `real`, `boolean`, `datetime`, `relation`, `json`. JSON is storage-only and cannot be queryable. Index helpers validate identifiers before generating names/casts; they do not execute DDL. Domain types expose structured `Result` values; dependency exceptions can still reject their promises.

Entry creation authorizes, requires an active owning type in the same workspace, validates fields and refuses a duplicate `(workspaceId,type,slug)`. It creates a draft at version 1. Update/publish/unpublish load the entry, reject a tombstoned owning type and check expected version; deprecated types permit those existing-entry operations. Their shared resolver currently tolerates a missing owning type. Field validation defaults to the `ext.site` namespace; an explicit owner may select another namespace. Visible-field selection exposes only currently declared fields.

Entry writes persist row, revision and optional watermark in the host transaction. `onWritten`, when supplied for create/update/import, is awaited inside that transaction. Outbox events are enqueued afterward, so an enqueue failure can follow a committed write. Lists forward to adapters; no default sort/pagination guarantee is added.

Import preserves supplied ID and transferred entry state. `expectedVersion:undefined` requires absence; a numeric version requires a matching existing row. Existing entry type cannot change. A deprecated owning type permits import; a missing or tombstoned type is rejected. These version checks depend on host concurrency controls; the package does not implement a database compare-and-swap statement.

## Lifecycle and irreversible cleanup

Content types move active → deprecated → active, or deprecated → tombstone. Tombstone is terminal until cleanup; a fresh register cannot reclaim the key. Tombstoning records time and tears down queryable indexes. Domain rows/revisions, index effects and event enqueue are not one package-wide transaction.

Cleanup planning authorizes read permission, then requires a tombstoned type, at least 30 days since tombstone, and a truthy export reference, in that order. It forwards a plan request to the injected gateway. The export reference is checked for presence but not verified or forwarded as plan evidence. Execution delegates token/actor/staleness checks to the gateway first; rejection performs no local removal. Success invokes transactional scoped removal. The cleanup repository is bound by the host to the correct tenant; removal input itself contains no workspace ID. The module provides no token issuer, TTL or confirmation implementation.

## Settings

Owner fences are `core.*`/`theme.*` with null workspace and `site.*` with a workspace. Scope masks range 1–7; site-owned definitions forbid the global bit. Secret definitions and null defaults are rejected. Definition validation does not validate the default against its schema; consumers should register compatible defaults. JSON schemas accept any typed JSON value and delegate internal shape constraints to the registering feature.

Effective values resolve user → workspace → global → definition default. Cleared rows fall through. Missing/tombstoned definitions yield null. Definitions are cached per repository instance and namespace epoch; values are read directly from the repo. Prior-version values use the current coercion tag; an unregistered tag falls back to identity. Coercers are supplied by the host and can throw.

Ordinary writes authorize by scope: global/workspace/self-user/other-user; an explicit permission override on `set` replaces the derived permission. A supplied auth workspace must match the targeted workspace. Writes to another user require an active principal in that workspace. Definition lifecycle writes require definitions-management permission. `clear` exposes skip-authorization/skip-transaction flags for an already guarded reset context; consumers must not forward untrusted flags into it.

Rows and revisions commit together through `SettingsRepoPort.transaction`. Reset performs all supplied keys within one transaction. Rename retains the logical setting ID and creates/retargets alias markers; retype appends a new definition version and leaves old value versions for coercion. Rename and retype cannot be combined in one request. Default reconciliation changes only differing core-owned defaults. Alias depth is prevented by the writer's rename rules, but raw resolution recursively follows aliases without a read-time depth/cycle guard.

Change-feed helpers filter revisions by viewer workspace/principal and return distinct affected namespaces. Purge transactionally removes scoped values and writes revision evidence; it does not purge definitions or implement account deletion itself. There is no layer-value cache to clear.

## Media and image import

Uploads default to 10 MiB maximum and the source's image/video MIME allowlist (PNG, JPEG, GIF, WebP, AVIF, MP4, WebM). Empty or oversized bodies and disallowed declared MIME types reject. The direct uploader trusts `input.contentType`; callers handling untrusted bytes should sniff before upload. SHA-256 identifies immutable source bytes. A keyed in-process lock deduplicates blob storage and permits resurrection of tombstoned blobs. Bytes are stored before blob rows. Media metadata/rendition rows are additional awaited writes with no encompassing service transaction.

Upload derives a title and unique slug from filename. Explicit metadata slugs are normalized and cannot look like UUIDs; width/height require positive integers or null. HTML attribute metadata uses its exported allowlist parser. Metadata updates reject trashed assets. Repeated trash is a no-op success. Purge requires trash first and removes media/rendition rows before tombstoning an unreferenced source blob. It does not immediately unlink source bytes.

GC grace defaults to 30 days. Tombstone → journal and row removal → byte unlink are explicit caller-run phases. Delete and unlink recheck references/resurrection under hash locks. A recreated blob row prevents unlink. Only references from non-purged media rows are checked for real; live-content references and retained snapshots are stubs. Journal save and blob-row remove are separately awaited calls, not an atomic transaction. No monthly orphan sweep runs; its public stub returns `{implemented:false}`.

Transforms are append-only per workspace/name, with sequential versions starting at 1. Same-name registrations serialize in-process. Dimensions cap at 8000 pixels. Lazy rendition resolution returns ok/not-found/gone outcomes; existing historical renditions can be served, but new generation is permitted only for the latest registry version because the published-reference check is stubbed false. Rendition single-flight is local to one process; bytes precede the rendition row. The in-memory transformer prefixes source bytes with a deterministic parameter tag without decoding/resizing pixels; the Sharp adapter requires optional `sharp` at runtime.

Image import requires absolute HTTPS URLs without embedded credentials, explicit positive-safe-integer byte policy, a MIME allowlist, a sniffer and an outbound execution guard. It sends GET with a default 20,000 ms timeout and byte ceiling; enforcement across DNS, redirects and pinned peers belongs to the guard. Non-2xx, absent raw bytes, empty/oversized/truncated bytes and disallowed sniffed types reject. Headers/extensions do not choose MIME. A byte-specific truncation verdict takes precedence over text truncation. Filename generation derives a sanitized 60-character stem and MIME extension. No import function persists media or retries HTTP automatically.

## Taxonomy

Writers authorize before loading targets, then await domain writes, revision when applicable, watermark and event enqueue. Create/import/rename/assignment operations do not open a transaction themselves; their comments about same-transaction effects require host composition. Default assignable kinds are post/page; other kinds require the injected content-type taxonomy policy. Content joins validate resolved kind/workspace. Term repositories are workspace-bound by the host; the narrow term records have no workspace field to verify independently.

Create term validates hierarchy/parent ownership. Imports preserve source IDs, check absence or expected version, increment version on update and forbid moving a term across taxonomies. Parent changes load an ancestor chain to reject cycles. Name/address uniqueness is not enforced by the import service. Assign upserts requested links; unassign removes them idempotently; both still stamp/enqueue and neither writes taxonomy revision history.

Term deletion refuses assigned content or child terms. Taxonomy deletion checks member assignments before removing rows, through the supplied transaction closure; the host must bind all affected repositories to that same transaction. Content-deletion cleanup forwards deletion directly and propagates repository rejection, despite its best-effort comment. No automatic reconciliation sweep is supplied.

Merge planning rejects identical source/destination before overlap computation, computes overlap disclosure and delegates a plan. Returned gateway details, when present, replace local computed details; the host must preserve accurate disclosure. Confirm/execute only delegate. Principal identity/kind fields are not automatically forwarded into those closures; the host must bind actor context, token lifetime, authorization and stale-plan checks itself.

## Workspace, presentation and package boundaries

Workspace names are trimmed; slugs are trimmed/lowercased and limited by grammar, with no explicit size cap. Create refuses duplicates and persists before enqueueing its event. Update does not authorize itself. Delete rejects unknown IDs and the last workspace; its count check and delete are separate awaits, so concurrent correctness requires a host transaction/serialization mechanism.

Presentation reads an existing settings row and stores only a validated theme identity plus updated time. If no discovered theme set is supplied, available IDs default to `paper`, `atlas`, `glassmorphic`. There is no theme discovery/rendering, stylesheet contract or authorization in these functions.

Settings routes are supplied through `./http/settings`; trash through `./trash`. Identity wiring is owned by user-management. The package provides no UI components or durable implementations for general repositories, global scheduler, distributed locking, universal retry policy or total-operation deadline. Hosts own those contracts.

Evidence: current domain services and ports under `src/`; menu, GC, lifecycle, entry import, settings rename/cache and forms-related characterization evidence was read without executing tests.

Decision rationale: [Schema indexes use closed fragments and unambiguous identities](../decisions/DR-001-safe-schema-and-index-transitions.md), [Content lifecycle separates new authoring from existing-entry writes](../decisions/DR-002-content-lifecycle-and-cleanup.md), [Settings preserve total defaults, scope fences and revision evidence](../decisions/DR-003-settings-ledger-invariants.md), [Blob collection rechecks references before journaled unlink](../decisions/DR-004-journaled-blob-gc.md), [Taxonomy validation preserves first-failure order and full cycle checks](../decisions/DR-005-ordered-taxonomy-validation.md), [Mutation, audit record and outbox intent share a commit boundary](../decisions/DR-006-mutation-audit-atomicity.md), [Workspace administration preserves tenancy and ownership floors](../decisions/DR-007-workspace-and-owner-floors.md), [Navigation mutations enqueue one event only on success](../decisions/DR-008-navigation-event-intent.md).

## Trash service and sweeping

Trash requires explicit entity policy/adapter/retention/ID/transaction ports. Hide and index insertion share the supplied transaction; success records display/version/prior marker without parsing entity content. Restore unhides using stored version/prior marker and deletes index only on success. Selected purge visits supplied IDs in order, authorizes stored rows before resolving adapters, preserves stale-version rows, and removes index for purged/already-gone results. Notifications are awaited inside transactions but their own errors and reporting errors are swallowed. The host transaction owns atomicity; callbacks are not a durable post-commit notification mechanism.

Trash listing hides rows at/past purgeAfter and orders descending trashedAt/id. Repeated identity insertion in memory is ignored. Sweep claims due rows, checks policy/adapters, re-reads index in the transaction before purging, and retains unsuccessful claims until lease expiry. Record-store adapter increments version only when changing visibility, returns noop at desired state, and considers hard delete successful only when re-read finds no record. No hard-delete callback is a fail-closed retained-record outcome.

Sweeper schedules an immediate first tick, processes one batch at a time, schedules another immediately after a full batch or after one hour by default otherwise, and uses five-minute leases with batch size 50. Stop cancels the next timer and waits in-flight work. It has no internal cancellation/deadline for a stuck adapter. Follow-ups run after non-noop hide/unhide, before purge, and after an actual purge; their failures propagate to the host transaction.

## HTTP settings access and feed rules

| Settings stream | Poll 1,000 ms; keepalive 25,000 ms; reauthorize 30,000 ms; revision page 200 |
- Settings requests shall reject a mismatching route workspace before readiness/authentication; await readiness; resolve principal; enforce operation permissions before service access. Conflicting body workspace shall fail even for global scope. Reading another principal's layer requires the separate host grant.
- Definition listings shall project selected metadata and sort namespace then key. CMS writes inherit their service authorization/transactions. Non-register definition operations execute in input order; registrations accumulate and execute afterward. The whole batch is not atomic; later unknown operations do not roll back earlier writes.
- Settings feed cursors shall advance over invisible rows internally; emitted ids shall use the visible batch cursor, not the global head. Resume ids clamp to current head. Poll ticks and authorization ticks each avoid overlap. Read/reauthorization exceptions are reported and retried on later schedules; authorization denial closes. Response.write backpressure is not bounded in this feed.
