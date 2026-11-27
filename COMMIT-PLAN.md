# r62t-rev-p11 Jini working-tree handoff

Base: `010c8cd874f709ffa2c61de0de4e1dde4f808aad`, branch `codex/f-p11j`.

Status: PARTIAL, source implementations awaiting cloud verification and release evidence. No commits, branch changes, pushes, tests, builds, installs, typechecks, linters, or mutations were executed. Initial named tests were written before each implementation; caller/fixture assertions were subsequently extended during source review. No Tovu files or OPUS implementation sheets were changed.

## Ordered design commits written

### 1. ST-7b.J — Maintenance running record

- `packages/platform/src/fs/directory-running-lock.ts`
- `packages/platform/src/fs/directory-workspace.ts`
- `packages/platform/src/fs/__tests__/directory-running-lock.test.ts`
- `packages/platform/src/fs/__tests__/directory-workspace.test.ts`
- `.changeset/st-7b-maintenance-record.md`

Maintenance purpose is forwarded by workspace claims. Invalid purposes/nonzero maintenance ports are refused; maintenance update is refused; omitted purpose remains serve. Existing boot/PID/token and token-matched release paths remain in place. The existing fs barrel already exports this owner, including new `isServeRecord`.

Tests: contested maintenance claim/legacy serve semantics (lock and forwarding seam), nonzero maintenance port/malformed purpose, maintenance update. Mutation: drop purpose from the contested claim result or workspace forwarding; exact record equality/purpose and `isServeRecord` assertions must fail. Release: platform minor.

### 2. ST-8a.J — Chat cleanup contracts, store, routes

- `packages/core/src/contracts/storage/cleanup-preview.ts`
- `packages/core/src/contracts/storage.ts`
- `packages/platform/src/retention/preview-store.ts`
- `packages/platform/src/retention/index.ts`
- `packages/platform/src/retention/__tests__/preview-store.test.ts`
- `packages/chat/src/store/ports.ts`
- `packages/chat/src/store/sql/tables.ts`
- `packages/chat/src/store/sql/store.ts`
- `packages/chat/src/store/sql/bulk-deletion.ts`
- `packages/chat/src/store/sql/__tests__/bulk-deletion.test.ts`
- `packages/chat/src/store/sqlite/schema.ts`
- `packages/chat/src/store/sqlite/index.ts`
- `packages/chat/src/store/pglite/index.ts`
- `packages/chat/src/store/postgres/index.ts`
- `packages/chat/src/store/__tests__/pg-schema.sql`
- `packages/chat/src/store/__tests__/types.fixture.ts`
- `packages/chat/src/server/chat-cleanup-routes.ts`
- `packages/chat/src/server/__tests__/chat-cleanup-routes.test.ts`
- `packages/chat/package.json`
- `.changeset/st-8a-chat-cleanup.md`

One outstanding principal/kind token, 16-byte random-token request, atomic consume, scope binding, default 900000 ms monotonic expiry, and original deadline on partial continuation. Pin is mapped without adding fields to legacy unpinned DTOs; pin-only updates preserve activity ordering. Combined updates share an owner-scoped transaction. ChatHistoryStore's Pick is unchanged. Shared index name is `idx_ai_chats_owner_cleanup` in SQLite and the PG test schema. Bulk operations use sorted chat-slot locks, at most 500 IDs/request and 50/transaction, retain unknown liveness, and never select new IDs by date at apply. Pinned bulk deletion remains unavailable. Four route specs use injected paths and same-origin policy; host supplies authenticated principal/scope, patch parser and compatibility copy. Existing core persistence exports already expose the store contract.

Tests: pinned after preview kept; run started during cleanup kept; never crosses owners; newly eligible chat excluded from confirmed IDs; batches ≤ 500 and ≤ 50 slot locks/transaction; pinning preserves place and manual title provenance; token replay/other-admin/scope refusal, rotation deadline and replacement; active/open chat named and kept; delete-selected without confirm refused.

Mutations: remove pin recheck; reselect by date instead of the confirmed ID set. These must fail the pin reason/retention and newly eligible chat assertions. Release: chat/core/platform minor here; ST-8b raises the final chat release to major. OPUS review required.

### 3. ST-8b.J — Required conversation hooks and cleanup dialog

- `packages/chat/src/react/components/ConversationList.tsx`
- `packages/chat/src/react/components/ConversationList.hooks.ts`
- `packages/chat/src/react/components/ChatCleanupDialog.tsx`
- `packages/chat/src/react/components/__tests__/ConversationList.cleanup.test.tsx`
- `packages/chat/src/react/components/__tests__/ChatCleanupDialog.test.tsx`
- `packages/chat/src/react/components/__tests__/ConversationList.test.tsx`
- `packages/chat/src/react/components/__tests__/ConversationList.gaps.test.tsx`
- `packages/chat/src/react/components/__tests__/ConversationList.trigger.test.tsx`
- `packages/chat/src/react/features/conversation-chat-pane/components/ConversationChatPaneHeader.tsx`
- `packages/chat/src/react/features/conversation-chat-pane/components/ConversationChatPane.tsx`
- `packages/chat/src/react/features/conversation-chat-pane/types.ts`
- `packages/chat/src/react/features/conversation-chat-pane/__tests__/ConversationChatPane.test.tsx`
- `packages/chat/src/react/index.ts`
- `.changeset/st-8b-chat-cleanup-react.md`

ConversationList hooks are required with no render fallback; defaultConversationListHooks remains exported through react. ConversationChatPane requires conversationListHooks and forwards it through its injected header. Pinned-first stable order, controlled selection with displayed-order Shift range, focusable Space-operated controls, and host pin callbacks are present. ChatCleanupDialog renders preview/confirm/partial/expired hook states and passes a token with explicit confirmation; no view fetches. Transport and locale formatting remain inside the host-injected hook/copy.

Tests: pin toggles through props and controls order; selection emits IDs/range; keyboard selection; injected hooks; server count before delete and token passed to apply; kept items named. Existing callers/tests in the named chat React area now pass real hooks; the pane assertion checks the forwarded reference.

Mutations: ignore pinned state/order; apply without previewToken. Release: chat MAJOR. Tovu ST-10 must consume the actual published major and supply required hooks.

### 4. ST-12a.J — Share-create expiry input seam

- `packages/cms/src/admin-http/routes/system/site-shares.ts`
- `packages/cms/src/admin-http/routes/system/__tests__/site-shares.test.ts`
- `.changeset/st-12a-share-expiry-input.md`

Initial create/static input admits the host-parsed expiry choice. A parsed string jobId reduces poll input to jobId only, after the existing gates/parser. No expiry default is introduced. Backend list rows are passed unchanged.

Tests: no expiry by default (regular/static), null-URL/no-storage row unchanged, poll cannot revise the initial choice (regular/static initial forwarding included). Mutation: inject 14 days on omitted input. Release: CMS minor, existing system/site-shares subpath.

### 5. ST-12b.J — Share expiry controls

- `packages/devops/src/react/site-share-expiry/ShareExpiryControls.tsx`
- `packages/devops/src/react/site-share-expiry/index.ts`
- `packages/devops/src/react/site-share-expiry/__tests__/ShareExpiryControls.test.tsx`
- `packages/devops/package.json`
- `packages/devops/tsconfig.json`
- `pnpm-lock.yaml` (devops jsdom importer only, existing resolved 26.1.0)
- `.changeset/st-12b-share-expiry-controls.md`

Required hook/kit/copy, Never default, host-supplied eligible 7/30/90 choices, showExpired default true, and supplied expired status survive acknowledgement. Browser entry, types/import/default export, typesVersions and optional-React message are present. DOM library types are needed for the new select/checkbox events and jsdom test; jsdom is the explicitly requested test environment. Tests use already-declared React/ReactDOM, without adding a testing framework dependency.

Accepted ALGO-P11 deviation: generic controls live in Jini; eligibility and product copy remain in Tovu.

Tests: active link without expiry untouched; acknowledge after expiry keeps it expired. Mutation: treat missing date as expiry. Release: devops minor.

### 6. ST-13.J — Revision thinning engine/specs (unmounted)

- `packages/cms/src/posts/revision-thinning.ts`
- `packages/cms/src/posts/__tests__/revision-thinning.test.ts`
- `packages/cms/src/admin-http/routes/posts/revision-thinning.ts`
- `packages/cms/package.json` (two direct universal leaves)
- `.changeset/st-13-revision-thinning.md`

Explicit scope and confirmation; principal/scope-bound one-use preview; host post lock; only the confirmed contiguous oldest run; newest, published, restore, restored-from and undo protections; a throwing protection stops the run. No previous_id writes. Host owns input/date policy, repository adapters, authorization and activation. The engine expects listOldest's oldest-first scoped prefix contract and the shared reference-writer fence.

Accepted ALGO-P11 §20 deviation: generic engine/specs live in Jini CMS. No host registration or activation was added; STOP 6 remains closed.

Tests: published/restore/restored-from/undo targets kept; newest kept; explicit scope required; undo added after preview kept; retained history snapshot bytes unchanged. Mutation: drop undo protection. Release: CMS minor; OPUS review required.

### 7. ST-15a.J — Storage report/cleanup specs

- `packages/platform/src/retention/routes.ts`
- `packages/platform/src/retention/__tests__/routes.test.ts`
- `packages/platform/package.json`
- `.changeset/st-15a-storage-routes.md`

Injected paths, separate measure/runOnce dependencies, storage.manage authorization on both specs via the route host's authorize seam, same-origin cleanup, dry run unless explicitly false, and injected plain refusal copy for nonautomatic classes. No HTTP server or domain implementation imported.

Tests: default dryRun; content class refused in both modes; owner authorizer gates both effects; dry arrival during live pass receives measurement from the real retention runner. Mutation: default dryRun to false. Release: platform minor.

### 8. ST-17.J — Shared admin Storage panel

- `packages/admin/src/screens/storage/StoragePanel.tsx`
- `packages/admin/src/screens/storage/__tests__/StoragePanel.test.tsx`
- `packages/admin/package.json`
- `.changeset/st-17-storage-panel.md`

Required hook/kit/copy/links; three supplied class headings; load/dry-run/outcomes/owner-confirm/live/result presentation; last automatic pass, domain links and notices from host. No domain dependency or platform JSX/React peer added.

Accepted ALGO-P11 §23 deviation: shared markup in Jini admin, composition in Tovu.

Tests: three class labels; dry-run list first, then separate owner confirmation before live. Mutation: skip dry run/call cleanup at the preview action. Release: admin minor, direct browser leaf.

## Sheets stopped without edits

- ST-17s.J: `createCaptureRetention({ root, listOwned, removeOwned, previewStore, clock }, ...)` specifies no lock/fs effect or atomic removal contract, while apply must hold the writer's root-keyed lock across lstat, identity/cutoff recheck and remove. There is no existing retention/fence binding in capture-files.ts to reuse. Coordinator must specify whether listOwned/removeOwned own those atomic guarantees or add the named effects before this exact API can be implemented without redesign. The writer API was not changed independently.
- ST-6c.J: FileLockPort (`packages/core/src/contracts/runtime/file-lock.ts`) exposes withFileLock; HeldFileLock exposes lockPath/assertHeld. Neither probes the death of a provenance-recorded owner after its lock was released. Acquiring an absent lock alone cannot prove that a surviving root's writer is dead. The named args have no separate liveness effect/protocol. Specify that effect and the dead-owner/no-root stale-break binding before implementation. No independent DB transfer API change was made.
- ST-1.J: missing prerequisite ST-2a.J partitions leaf/interlock; `packages/desktop-host/src/electron/partitions/` is absent at dispatched HEAD.
- ST-3.J: same missing ST-2a.J prerequisite; no acquireSiteSession/openMaintenance seam exists for the required held-partition tests.
- ST-2b.J: same missing ST-2a.J owner subpath; no replacement leaf or temporary ledger API invented. Resume after OPUS establishes the partitions package.

No source-anchor drift was found for the eight implementations written. The five stops above are prerequisite/contract gaps, not line-number-only changes.

## Release evidence still required

No generated declarations or API baseline hashes were fabricated. scripts/check-api-surface.ts requires built dist and TypeScript's declaration checker. This executor was explicitly forbidden to build or typecheck. Cloud coordinator must generate declarations and refresh:

- `api-baseline/jini-ai__platform.json` (fs, retention, retention/routes)
- `api-baseline/jini-ai__core.json` (contracts/storage)
- `api-baseline/jini-ai__chat.json` (core/store, SQL leaves, react, conversation pane and cleanup routes)
- `api-baseline/jini-ai__cms.json` (existing share deps and two new thinning leaves)
- `api-baseline/jini-ai__devops.json` (expiry browser leaf)
- `api-baseline/jini-ai__admin.json` (StoragePanel)

Run the named tests and mutations in cloud before release. Existing PG fixtures were updated, but no SQLite/PG runtime result is claimed. ST-9.T still owns host pinned migrations/fresh-bootstrap parity. Migration pins/checksums/source-digests were untouched. No release/version number is claimed; Tovu must use the actual coordinator-published versions.

## Tovu consumption handoff

- Existing `@jini-ai/platform/fs`: DirectoryRunningRecord.purpose, workspace claim purpose and isServeRecord.
- Existing `@jini-ai/core/contracts/storage`: CleanupPreviewStore contract.
- Existing `@jini-ai/platform/retention`: createCleanupPreviewStore; bind a cryptographic randomToken({bytes:16}) and monotonic mono.
- Existing `@jini-ai/chat/store`/core contract and SQL leaves: pin/update methods and createChatBulkDeletion. Migrate pinned_at before using the changed store; use the shared cleanup index name.
- New `@jini-ai/chat/server/chat-cleanup-routes`: host mounts four specs, supplies authenticated identity/scope and legacy patch parsing/error copy. Existing single-delete cancellation stays host-owned.
- Chat major: existing `@jini-ai/chat/react` exposes defaultConversationListHooks and ChatCleanupDialog. ConversationList.hooks and ConversationChatPane.conversationListHooks are required. Bind transport/locale inside the required host hook/copy; no browser token persistence.
- Existing CMS `admin-http/routes/system/site-shares`: typed initial expiry input/poll behavior.
- New `@jini-ai/devops/react/site-share-expiry`: ShareExpiryControls, host eligibility/copy/hook/showExpired binding.
- New `@jini-ai/cms/posts/revision-thinning` and `@jini-ai/cms/admin-http/routes/posts/revision-thinning`: host adapters/authorization/fence proof required; remain disabled under STOP 6.
- New `@jini-ai/platform/retention/routes`: createStorageRoutes; mount with owner-only admin ports and storage.manage.
- New `@jini-ai/admin/screens/storage/StoragePanel`: required storage hook/kit/copy/links; host preserves dry-run/confirmation sequence.
- Screenshot, owned-temp-root/DB transfer and desktop partitions APIs are NOT available from this change.

## OPUS sheets left

Jini: ST-7a.J, ST-8c.J, ST-11a.J, ST-2a.J, ST-2c.J.

Tovu (outside this clone): ST-1a.T, ST-2a.T, ST-2b.T, ST-1.T, ST-3.T, ST-2c.T, ST-16r.T, ST-16.T, ST-7b.T, ST-7c.T, ST-12a.T, ST-12b.T, ST-18a.T, ST-18b.T.

## Source review and deletions

- Re-read the final scoped diff and newly created implementation/test files. No existing assertions/test blocks were deleted or weakened; no coverage configuration was changed. 35 new it blocks (not an executed pass count), plus caller/fixture updates.
- Removed incidental JSON Unicode escaping/indent changes from package manifests.
- Removed an unnecessary quadratic selection-output reconstruction; Set insertion order suffices and retains hidden selected IDs.
- Removed the draft toggleSelection helper; selection's required behavior is inline in its event handler, with its anchor held by the existing hook.
- Removed undeclared Testing Library imports from the devops test; use its existing ReactDOM dependency instead.
- No mutation, temporary bypass, placeholder checksum, new re-export shell, runtime config flag, speculative helper or product URL was retained.

Architecture review: source-only WARNING. Identity and framework boundaries were checked in the changed files; host activation remains gated. Baseline/declaration evidence and runtime/mutation results are outstanding. Existing large SQL-store factory and ConversationList render/hook were not split: the sheets require in-place additions and forbid unlisted helpers or unrelated formatting. No waiver of inherited size limits is claimed; coordinator review must resolve that before release readiness.

Function review: new factories/methods are scoped to the named operations, and test seams cover their requested behavior. Source review alone does not certify complexity, runtime coverage or concurrency. Token retention is one entry per principal/kind until expiry/replacement, with expired entries pruned at put. Chat preview is bounded by previewLimit; its bytes sum transcript content/events/attachments, not physical SQLite pages. Apply is bounded by 500 IDs and 50 per transaction; its liveness query aggregates to one row rather than retaining an unbounded message list. Revision reads/deletes are bounded by limit (500 by default). No timers/background policies were added.

Self-validation: NOT RUN, explicitly prohibited by dispatch. No runtime, test, build, typecheck or lint success is claimed. COMMIT-PLAN.md itself is coordinator handoff metadata, not a design implementation commit.
