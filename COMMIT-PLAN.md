# WMZ round 2 — Jini only; coordinator commits

Base: `984a319b4adc3ea78ea148e6cb50e7ba5d875bd8` (`origin/codex/x4-allj`).
No tests, builds, installs, typechecks, linters, package intake, commits or pushes run.
No subagents. `.git` remains read-only. This scratch file must not be committed.

## Constraints / pattern / test seams

The supplied dispatch is the architecture and style authority. Preserve statement/effect order,
persisted bytes, deferred reads and existing why-comments. Required structural dependencies only;
no new runtime dependency edges, forwarding modules, theme edits, exposure or activation.
The existing Jini modules are the pattern seeds; no speculative abstraction is authorized.
The standalone Tovu architecture START-HERE path is absent; dispatch explicitly supplies the spec.
Read START-HERE and honest-testing from the original Jini checkout instead. The test-running,
delegation, documentation-expansion and pattern-approval defaults in the general programmer skills
are superseded by this dispatch's complete design, no-subagent, no-check and no-new-comment rules.

## Ordered logical units

### 1. WMZ03 — memory credential adapter

Tests first: repointed the existing `primitive upsert cannot enter between replacement snapshot
and publication` case in `packages/cms/src/media/site/__tests__/provider-credential-store.memory.test.ts`
to the existing real `TurnLock`, passed as a required structural collaborator. Test count unchanged.
Mutation `omit-provider-write-lock`: bypass `providerWrite` for primitive upsert; the paused batch
then admits the primitive write before publication and violates the existing event assertions.
UNEXECUTED. The sheet's `change-credential-aad` sealed-fixture witness remains unchanged in
`provider-credential-store.test.ts`.

Move the existing Tovu `providerWrite` acquire/try/finally/release body verbatim to the existing
Jini `InMemoryMediaProviderCredentialRepo`. Inject the lock instance rather than requiring a
procedural host `withWrite` callback. The host can construct vault, policy and `new TurnLock()`
directly at its existing composition point, deleting its class body. O(1) lock wrapper per write;
the injected lock retains its existing queue semantics and lifetime.

Files:
- `packages/cms/src/media/site/__tests__/provider-credential-store.memory.test.ts`
- `packages/cms/src/media/site/provider-credential-store.memory.ts`
- `.changeset/wmz-round2-memory-lock.md` (`@jini-ai/cms` minor)

API: existing `@jini-ai/cms/media/site/provider-credential-store.memory` entry, no new subpath.
Constructor takes `{ vault, policy, providerWrites }`, replacing `{ vault, policy, withWrite }`.
Scoped Jini caller review found one constructor caller, the repointed test above.

Final source disposition: Jini side ready for a pure host construction binding; Tovu unchanged here.
Deletions: removed the test-only promise-tail lock fixture and the superseded required `withWrite`
callback contract. No behavior or test case deleted.

### 2. WMZ10d — revision-thinning approval body

Tests first: retained the existing `unreadable inverse retains the revision under the append/thin
fence` pin and added the existing host characterization case `approval card raised before any
revision delete; decline deletes nothing` to `posts/sql/__tests__/revision-refs.test.ts` before
moving production code. Mutation `unreadable-inverse-is-unreferenced` stays pinned by the first
case. Mutation `thin-revisions-before-approval` must break the second case's no-apply assertions
and decline result. Both UNEXECUTED. Test count in that file: 1 -> 2.

The X4-04 `core/contracts/site/post-revision-lock` prerequisite exists on HEAD. Reuse existing
`bindRevisionThinning` and its injected lock key. Move `Prepared` and the existing
`revisionThinningApprovalHandler` body into the existing SQL owner, preserving prepare/catch,
error text, scope projection, preview token and apply order. Inject the existing
`approvalToolHandler` and `thinningCard`; card construction and transport remain host-owned.
No route, tool registration or STOP-6 activation added. No new helper, abstraction or subpath.

Files:
- `packages/cms/src/posts/sql/__tests__/revision-refs.test.ts`
- `packages/cms/src/posts/sql/revision-thinning.ts`
- `.changeset/wmz-round2-thinning-approval.md` (`@jini-ai/cms` minor)

Tovu needs: existing `@jini-ai/cms/posts/sql/revision-thinning` now exports
`revisionThinningApprovalHandler`; bind `{ binding, surfaces, workspaceId, approvalToolHandler,
thinningCard }`. Keep its existing card copy and concrete append/thin lock key. Delete its generic
prepare/catch/apply body. Tovu is unchanged here; no residual counted.

## Remaining per-file inventory

All paths below are relative to Tovu `apps/website/src/features/`. None was edited in this Jini-only
checkout. "Ready" identifies a Jini-side source contract, not a completed or tested Tovu cutover.
No Tovu file is counted DONE, no keep ledger entry was added, and no counter drop is claimed.

| WMZ | Previously LEFT file | Jini side / exact disposition |
| --- | --- | --- |
| 03 | `media/provider-credential-store.memory.ts` | **Ready, changed.** Existing class now owns the original `providerWrite` body; required injected `providerWrites` lock removes the procedural host callback. Bind the original per-instance `TurnLock`, vault and owner policy, then delete the host class. |
| 03 | `media/publish-content.ts` | **Ready on HEAD, skipped.** Existing contributor and its entry already require `media.createBlobWriteBindings` and `media.uploadCaps`. Remaining blocker is the expressly forbidden theme fixture at `theme/__tests__/publish-content.apply.test.ts:130` and its publish bags. No package contract workaround or fixture default added. |
| 05 | `media-import/tool-registrations.ts` | **Ready on HEAD, skipped.** Import registrar, `cms/asset-transfer/{asset-destinations,copy-tool}` and `cms/media/site-transform/tool` exist with public entries. The remaining WAL DELETE cutovers are Tovu work. Existing permission-before-source and mutually-exclusive replacement pins were inspected; no duplicate registrar created. |
| 10d | `post/revision-thinning.ts` | **Ready, changed.** Core lock contract already exists and is exported. SQL binding and reference probes already exist; added the original generic approval handler to that owner. Host keeps card copy, transport, owner binding and identical lock bytes; STOP 6 remains disabled. |
| 10a | `post/repo.memory.ts` | **Still blocked.** Target `cms/posts/repo.memory.ts` absent. Revision-2 requires H2 migration tests before 10a; this dispatch forbids executing them. No repository extraction started; actor reconstruction cannot be claimed covered. |
| 10a | `post/repo.rows.ts` | **Still blocked.** Target `cms/posts/sql/repo.rows.ts` absent, with no actor-column codec extraction. Same unmet H2-before-10a prerequisite; no redesign or fake actor witness added. |
| 10a | `post/repo.ts` | **Still blocked.** Target `cms/posts/sql/repo.ts` absent. Same prerequisite; generated host schema was not copied to Jini. |
| 16 | `recovery/tool-registrations.ts` | **Still blocked.** `db/recovery/tool-registrations` is already public through existing `./recovery/*` export and `jini.entries` wildcard. Original `createRecoveryRestoreRun` constructs one `hooks` object before confirm and reuses it at execute. Existing `RecoveryToolHost.confirm`/`.execute` requests carry no shared hooks. The sheet does not name the replacement shared-lifetime adapter/contract; no stateful adapter invented. Existing restore-confirmation, deep-link authorization and unwired-collision pins inspected. |
| 19a | `webhooks/seal-aad-invariant.ts` | **Still blocked for G3.** Scanner walk already exists in `integrations/webhooks/site/seal-aad-invariant.node`. Original sheet explicitly keeps host CLI roots, allowlist, formatting and exit handling. Those procedural host steps fail G3 and no CLI runner is named. No added runner or claim of a pure residual. |
| 19a | `webhooks/secret-scan-guard.ts` | **Still blocked for G3.** Git readers already exist in `diagnostics/redaction/repo-secret-scan.node`. Same explicit host CLI retention vs G3 conflict; no named portable CLI runner. No scan of real secrets run. |
| 19c | `webhooks/site-key-ensure.ts` | **Still HOLD / NEEDS-OPUS.** Root-key `files`, `material`, `decide`, `reconcile` exist and are exported; there is no approved `platform/secrets/root-key/ensure` orchestration contract. Installation primitives alone do not authorize a new reconciliation state machine. |
| 19c | `webhooks/site-key-sources.ts` | **Still HOLD / NEEDS-OPUS.** Existing `material` operations cover raw/meta reads. Host source ordering, local/production path selection and ID refusal retain procedural bodies, outside G3. No named source-policy projection factory supplied; policy branches not removed. |
| 19b | `webhooks/keyring.env.ts` | **Still NEEDS-OPUS.** Platform `EnvOrFileKeyring.resolveRootKey` uses `cachedRootKey` and env-first/file fallback. Tovu resolves its ordered sources on every derive, refusing the first present invalid source and reporting `hexDigits`. Inspection helpers do not provide this live derivation/error seam. Existing invalid-first-present material pin inspected; no cache change or new keyring mode invented. |
| 20 | `site-export/site-exporter.ts` | **Still stopped as written; reusable exporter already exists.** `exportHostSite` and the public node entry are on HEAD; original named `devops/src/deploy/site/export-run.ts#runExport` anchor is absent (that file has injected `runExportSite`). Actual engine invocation in the existing exporter is `static-export/entry.exportSite`, imported as `runExport`. No new forwarding alias created. Host `declaredThemeAssets` remains a two-statement projection; no named extra projection home supplied. Existing destination/base-path and stale-feed pins inspected. |
| 21 | `site-backup/backup-service.ts` | **Still dependent.** Existing service, private credential/plan/push modules and `planVersion` support are on HEAD. Final host service binding still depends on held WMZ19b/19c and stopped WMZ20. Preserve the host's existing `tovuVersion` through `planVersion`; no default version, key policy or export shim added. |
| 21 | `site-backup/tool-registrations.ts` | **Still dependent.** Registrar and public entry already exist; requires the same unfinished host backup/key/export bindings. No new package implementation needed independently. |
| 23 | `taxonomy/agent-tools.ts` | **Still NEEDS-OPUS.** Existing taxonomy catalog is an exported static array. Host overlay derives assignment schema and adds `taxonomy_get_term`/`taxonomy_get_assigned_terms`; no additive factory name or signature is specified. Turning the static export into a function breaks existing consumers; adding an unnamed factory violates the no-new-helper rule. No catalog behavior changed. |
| 24 | `trash/adapters/user.ts` | **Still blocked.** Existing `user-management/identity/sql/user-trash-adapter` is the transition owner and accepts `store`/`policy`; it has no `db`/`tables`/`eventValues` SQL binding. The removed CMS duplicate is not restored. No named new SQL home/contract supplied by the revised inventory. Existing protected-purge and lock/effect-order pins inspected. |
| 24 | `trash/trash-item-tool.ts` | **Still blocked for G3.** Existing Jini dispatcher/catalog consume `delegates` and `readLiveVersion`; host per-kind post/comment/live-version projections still contain multi-statement logic. No approved generic delegate projection helper named. No invented dispatcher or permission changes. |

## Existing entries reused; no package intake

- `@jini-ai/cms/media/site/provider-credential-store.memory`: universal; existing exact export/entry.
- `@jini-ai/cms/posts/sql/revision-thinning`: node; existing exact export/entry.
- Existing `@jini-ai/core/contracts/site/post-revision-lock` supplies the X4-04 prerequisite.
- Existing wildcard entries were considered before declaring an entry missing. In particular,
  `@jini-ai/db/recovery/tool-registrations` needs no redundant manifest entry or changeset.
- Package manifests, dependencies, lockfiles, themes, desktop, routes and registrations unchanged.

## Source review / handoff evidence

Re-read the complete four-file code/test diff against the original Tovu bodies. The only new
production logic is moved logic: the lock lifecycle and approval prepare/catch/apply body. The
approval call loses only its erased `<Prepared>` type argument because the injected callback is
specialized structurally; its statements, order, error wording and options are unchanged.
Existing why-comments moved with their bodies. No extra comment, fallback, guard, default,
configuration, runtime edge, helper file or test suppression added.

Final deletion review: only the superseded promise-tail test fixture and `withWrite` contract were
removed. No test cases, assertions, existing guards, feature capability or coverage scope removed.
The unreadable-inverse test is unchanged. Memory test count 1 -> 1; revision-ref test count 1 -> 2.

Architecture audit: source review PASS for the changed modules against the supplied boundaries:
CMS runtime imports only its existing core dependency and its own owners. `TurnLock` is imported
only by the test (db is already a dev dependency); production receives a structural lock. Existing
universal/node entry classifications remain valid. No new host policy enters the engine.

Function review (manual, no metric runner):

| Unit | Disposition | Findings / evidence | Local fix |
| --- | --- | --- | --- |
| memory constructor / `providerWrite` / two overrides | INCONCLUSIVE behavioral evidence | Required lock/vault/policy are explicit; original acquire/finally/release retained. O(1) wrapper state/time apart from original queued lock and vault work. Concurrency pin repointed, unexecuted. | Move original lifecycle; remove host callback requirement. |
| `revisionThinningApprovalHandler` / prepare / catch / run | INCONCLUSIVE behavioral evidence | Preview/card/apply separation and same token retained; no activation. O(1) wrapper work; existing SQL engine limit unchanged. Original error fallback retained. Approval-order and reference pins unexecuted. | Move existing body; inject original card and approval function. |

All changed functions are below the dispatch's 80-line bound and add no collection traversal;
no complexity metric, coverage number or passing run is claimed. Variable-name/source-order
review found no renamed or inverted values. Fresh execution evidence is intentionally unavailable
because the dispatch forbids tests/builds/typechecks/linters and delegates those to Opus.

Self-validation: NOT RUN by explicit dispatch. Coordinator must run the unchanged sealed-AAD,
memory concurrency, unreadable-inverse, approval-order and named mutation witnesses after package
build/intake. H2 remains a prerequisite before any 10a extraction. No full Tovu completion claim.

Fresh final evidence: `git diff --check` exited 0. `git diff --stat` reports four tracked source/test
files changed (78 insertions, 10 deletions); two new minor changesets plus this uncommitted scratch
ledger appear in `git status --short`. Source reads confirmed both changed public subpaths already
have matching exports/entries and the WAL image-transform entry is present. Source declaration
counts confirm memory 1 test and revision refs 2 tests; these are counts, not execution results.
Changed production files are 26 and 173 lines. No `.git`, manifest, lockfile or Tovu writes made.
