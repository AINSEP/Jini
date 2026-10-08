# Comments admin port — C2 Part A (2026-10-07)

Programmer(Execution): persona loaded from `AI-Dev-Shop/agents/programmer/skills.md`; this is an assertion-preserving extraction of specified behavior.

## Authority, inputs and approved pattern

- Coordinator's 22:25 dispatch: Part A only, source only, no execution/build/install/commit and no shared manifest changes.
- C0 brief SHA256 `6c1b41d519cccf41fc687d9f3c744b208bdbde7200f697d551bdfdec025b0efe`.
- C2 brief SHA256 `ccfeb0caa10bab7daea1e670cee7b01ae34653059927ef89b1210855422f4607`.
- CMS-JINI-MODULAR-DESIGN Rev 3 decision 1, §4 C2/M2, SHA256 `efd7544a4ea3b23d59f847f00c36a2abb5c6ec9f82a2e1a6a3327f1f336ffd85`.
- Tovu source: `apps/admin/src/features/comments/{Comments.tsx,rules.ts,hooks/*,__tests__/*}` and actual `lib/api.ts` request implementations; GET/PUT settings routes were inspected at dispatch.
- Governing Tovu architecture sections 13 and 14, project memory, Jini START-HERE/extraction-plan and capabilities were consulted. Governance ADR indexes have no applicable scope row.
- Pattern priming uses the explicitly directed `admin/media` and `admin/agent-plugins` owners: `defineAdminModule`, `bindReact`, controller stores, effect-owned `useController`, HTTP/memory/conformance subpaths. No new pattern or architecture approval is requested.
- MCP graph tools were unavailable; existing Jini Graphify and understand-anything indexes returned no relevant matches. Current source was then read directly. No repository was indexed. The Claude-specific Sonnet sidekick is unavailable on this Codex host; no helper or process was launched.

## API ownership and additive change

The sole comments API remains `AdminCommentsPort` in `core/ports/comments.ts`. Its header explicitly includes site-wide settings and its existing `getCommentsSettings`/`putCommentsSettings` already satisfy the screen. No operation was added and there is no second settings token or parallel API interface.

The only core change is `AdminComment.workspaceId?: string`. Existing wire responses and copied typed fixtures carry this field; the optional metadata does not make the admin responsible for tenancy. The host transport still scopes every request. No core barrel change is needed.

`CommentsSessionPort` is a type alias to `Pick<AdminAuthPort, 'me'>`. The permission read is the existing auth owner, not an operation added to comments. The `commentsSession` token injects that read. `commentsApi` injects the core API. Optional `commentsEvents` carries only queue refreshes via `subscribe({ onRefresh })` and its unsubscribe callback; no settings subscription is introduced.

Module `comments`, page `queue` (`comments.queue`), route `/comments`, page permission `comments.read`, no tabs. Action grants remain `comments.moderate`, `comments.delete`, `comments.delete.force`; settings GET/PUT remain `comments.configure`. Controllers default grants to denied, including wildcard-aware checks. These are affordance guards; the server authorizes every read/write.

## Contract and state invariants

- Every page/section retains its original loading/empty/error states and rendered markup/classes/agent ids/ARIA/English copy. Queue and Settings remain two sections of the same page.
- Permission reads and queue page one reuse `@jini-ai/ui/fetch-query`; the shared cache owns fixed query identities and stale-key settlements. Headless controllers own visible state, cursor accumulation, row busy/errors, purge selection, settings baseline, notices and validation. `useController` owns creation/disposal after commit.
- Cursor reads and moderation use synchronous locks. Same-tick calls do not double-submit. A status switch or refreshed page one supersedes old cursor settlement, releases loading, drops accumulated pages, and retry clears the cursor error. Different rows remain independent.
- Successful moderation/purge invalidates `KEYS.queueRoot`, all cached statuses, and resets accumulated pages. Queue-only host refreshes invalidate the same prefix. Unmount unsubscribes even if another observer still watches the query.
- A settings read seeds the uncontrolled form baseline ONCE. Later background reads never move it. Its own successful save advances the baseline immediately; cache invalidation is not awaited. `buildSettingsPatch` sends only changed fields, blank closeAfterDays is `null`, malformed numeric fields are omitted, spam score is validated before I/O.
- Purge confirmation remains the shared `ConfirmDialog`, unconditionally mounted and driven by selection. It closes on success/failure; row errors remain localized to the affected row. Current Phase 17 shared native dialog source is reused untouched.
- Disposed controller stores cannot publish late settlements. Core API cancellation was not widened; host/query transport owns request deadlines and the controller suppresses late updates.
- `SOURCE-RATIONALE.md` retains every original block/line rationale for provenance. Active ownership references are mapped here; historical comments are labeled as historical.

## HTTP adapter / host swap

`createHttpCommentsApi({ transport, basePath }, {})` expects the existing host `{ request, url }` pair, e.g. `basePath = /workspaces/<id>/comments`. No global fetch, workspace, credentials or API prefix is imported.

| Operation | Request | Body / result |
|---|---|---|
| queue | GET `<basePath>/queue?status=...&cursor=...&limit=...` | Same URLSearchParams order/omission; `{ items, nextCursor }` |
| moderate | POST `<basePath>/<encodedId>/<action>` | `{ expectedVersion, note }`; resolves void |
| purge | POST `<basePath>/<encodedId>/purge` | `{ note }`; resolves void, no version |
| settings read | GET `<basePath>/settings` | Unwrap `{ data: settings }` |
| settings patch | PUT `<basePath>/settings` | Same partial patch; unwrap `{ data: settings }` |
| permissions | `createHttpCommentsSession({ transport, path: '/auth/me' }, {})` | Core auth me result |

The host still performs serialization/auth/retries/deadlines/error decoding. Already-decoded errors with status/body are adapted to existing `AdminApiError`, preserving message/code/body fields so empty-message fallbacks and 409 currentVersion remain unchanged. Generic network errors remain intact.

`comments({}, { t })` is the React module factory. Its page loader remains lazy. Its scoped translation provider adds no DOM. Default English uses the 47 exact source keys. For Part B, the host must bind a translator covering the existing comments + common dictionary, navigation labels (`People`, `Comments`, `Settings`) and shared server labels (`pending`, `approved`, `spam`, `trash`). The current comments dictionary alone does not contain the latter sets. Use the existing host translation owners; keep those dictionaries in Tovu. No locale or refresh singleton exists in production Jini code.

Locale/grant updates configure the existing controller rather than reconstructing it, preserving cursor/row state and the uncontrolled-form baseline. API changes still get a fresh instance.

Part B binding addition: `feature.react.Provider` accepts an optional `t` prop, defaulting to the factory's translator. A host can update that prop from its existing locale hook without recreating the factory/Provider/page identities or losing the settings form's draft and baseline. The Tovu host switch tests exercise this through the actual module. This additive React-only seam requires rebuilding/publishing admin; no core port, universal entry or dependency changes were made.

No host slots or headerActions are needed for this screen. Part A left Tovu wiring/deletion to the serial Part B job; that host switch is now implemented, with runtime/release acceptance left to the coordinator.

## Memory and conformance

`createMemoryCommentsApi({ items, settings }, { workspaceId, now })` delegates to the existing `InMemoryCommentRepo` from `@jini-ai/cms/comments`. It reuses CMS keyset positioning, repository version compare-and-set, and purge; queue query validation uses `optionalOneOf`/`readToolLimit` from `@jini-ai/core`, including limit default 20/cap 100. Restore maps to approved, matching the existing moderation HTTP contract.

The ephemeral settings store simulates the admin read-your-writes port and immutable snapshots, not the production layered ledger. It checks fixture field bounds before replacing a snapshot; it does not recreate settings registration, authorization, outbox events, ingress, or removal-index writes. Those remain server-owned. Errors carry decoded status/body for port conformance; production transport remains the real validator.

Both CMS and core are requested as OPTIONAL peers (and workspace dev dependencies) in the M2 handoff, so importing/installing another admin domain does not install this backend fixture's packages. No regular dependency or package manifest was edited.

`runCommentsApiConformance({ api }, {})` is a framework-free destructive checklist requiring an isolated fixture with at least two pending comments. It checks filtering/limit/cursor, partial settings writes/null/read-your-writes/atomic invalid patch, all four moderation actions and versions/void replies, immutable prior rows, stale-version status/currentVersion, cursor after its marker leaves the status, purge and missing writes. Never point it at production data. The one added test seeds two rows and runs these 21 checks through memory.

## Reuse-before-write decisions

- Reuse: API/permission contracts; searched admin core comments/auth, host lib/api and media adapter; used existing `AdminCommentsPort` and `Pick<AdminAuthPort, 'me'>`; owner C0/C2 and core port headers.
- Reuse: cache and controller lifecycle; inspected ui fetch-query/cache, core controller-store/use-controller, media and agent-plugins controllers; used those implementations, moving only comments-owned state invariants; owner C0 directed pattern.
- Reuse: memory queue behavior; searched CMS comments/repo.memory/write-service/keyset-cursor and core query validators; used `InMemoryCommentRepo`, `optionalOneOf`, `readToolLimit`; the memory adapter is an admin fixture, not a second backend write-service owner.
- Reuse: settings fixture; inspected host comment settings ledger and existing fake settings port; separate ephemeral ownership is justified by an isolated admin-port snapshot contract, no durable definitions/principals/outbox/ledger writes. Production retains the same routes owned by Phase 15/D.
- Reuse: rendered widgets, safety and agent handles; inspected shared DataTable/RowMenu/ConfirmDialog, ui panel-kit and agentic; used their implementations without editing shared files. Per-row computations live in hooks and original pure rules.
- Reuse: translation; inspected host comments/common/nav/server-label owners and ui interpolation; inject the existing host owners. Universal English identity/interpolation uses native String.replace because the installed ui interpolation barrel reaches React; no parallel generic formatter is exported.

## Tests and static evidence (NOT runtime validation)

Copied seven suites unchanged apart from imports, render harness and the pure-rules DOM environment pragma:

- `__tests__/rules.unit.test.ts`
- `react/__tests__/Comments.unit.test.tsx`
- `react/__tests__/QueueSection.unit.test.tsx`
- `react/__tests__/SettingsSection.unit.test.tsx`
- `react/__tests__/use-comments.unit.test.tsx`
- `react/__tests__/use-comment-queue.unit.test.tsx`
- `react/__tests__/use-comment-settings.unit.test.tsx`

Only new test: `__tests__/comments-api.conformance.test.ts`.

The host runner is Vitest 4 and this workspace runner is Vitest 2. The rules suite retains its exact-once assertions through a test-only runner that composes Vitest 2's existing `toHaveBeenCalledTimes(1)` and `toHaveBeenCalledWith` matchers. No shared runner/config was changed. `@testing-library/user-event` is absent from the admin dev manifest and is requested in M2 as a dev dependency, alongside the CMS/core workspace fixture dependencies.

Test-only support adapts old fixture call shapes to the production two-object core API; it calls the actual hooks/rules/views. The full page request assertions still run through the real HTTP adapter and shared core transport. Hook fixtures use memory plus controlled responses where the original tests require repeated pages/errors. These are test harnesses, not shipped API ports or alternative controllers.

All 188 expectation expressions in the seven copied suites were AST-compared to Tovu and are byte-identical (22/8/8/49/69/21/11 respectively). A source parser read 34 TS/TSX files with zero syntax diagnostics; it created no compiler program and ran no typecheck. A source AST import walk resolved all runtime imports from the universal entry (13 modules), HTTP adapter (2), memory adapter (47), and conformance (1); no React, node:* or host imports were reachable. These structural inspections do not establish type correctness, behavior or packaging readiness.

Stays in Tovu: comments-i18n.unit.test.ts (host dictionaries); panels-render/nav-wiring/sidebar-labels suites; integrations/jini-admin/modules.hooks.unit.test.tsx. Every Tovu test/source file is untouched for Part A.

No tests/builds/typechecks/installs/servers/commits/staging/git worktree operations or reindexing ran. No process remains from this job. The coordinator must apply M2, install dev peer links, build, run the Part A suites/guard/packaging, accept the behavior diff, publish the package, then authorize the serial Part B switch and browser check.

## Function quality and documentation handoff

| Assessment unit | Disposition | Findings / limit | Local action |
|---|---|---|---|
| Pure rules and translation | INCONCLUSIVE | Preserved assertions; tests deliberately unrun | Corrected permission-scan complexity note; retained why comments |
| Core/HTTP boundary | INCONCLUSIVE | Request/type/transport tests unrun | Reused existing error owner and core contracts |
| Queue state/effects | INCONCLUSIVE | Race and double-submit suites copied, unrun | Stable no-grant default; cursor/row locks and disposal guards retained |
| Settings state/effects | INCONCLUSIVE | Lost-update suite copied, unrun | One-shot baseline and immediate save response retained |
| Memory/conformance | INCONCLUSIVE | Checklist added, unrun | Repository/query validator reuse; immutable fixture snapshots |
| React presentation/module | INCONCLUSIVE | Render suites and real-browser check unrun | Lazy loader, scoped translation, exact markup split |

No known Critical/High defect is claimed from source inspection, but runtime/coverage/function metrics were unavailable by explicit dispatch rule; this is not a PASS. Adversarial cases are already preserved in the copied suites: conflicting same-row actions, same-tick cursor reads, filter switch in flight, stale accumulated pages, background settings lost update, mixed permissions, conflict bodies. The conformance checklist adds cross-row keyset and atomic invalid settings cases inside the single authorized new test.

Public factories/contracts and non-obvious effect/race ownership are documented in source and here. Obvious presentation hooks/getters and type/data barrels are intentionally not restated in lengthy per-function comments. React props/event callbacks and translator function follow their required framework/brief signatures; new public logic/factories otherwise take required and optional objects. Legacy positional signatures exist only in assertion-preserving test harnesses.

## Outputs and next owner

All production/test/documentation source is in `packages/admin/src/comments/**`; the sole shared source change is the additive `core/ports/comments.ts` field. M2 edits are described in `Tovu/ADS-memory/.local-artifacts/cleanup-program/CMS-BRIEFS/out/c2-exports.json`. Behavior diff is `Tovu/ADS-memory/.local-artifacts/cleanup-program/comments-admin-BEHAVIOUR-DIFF.md`.

Suggested next assignee: Coordinator/M2 for integration and fresh validation; Part B is gated and remains untouched.
