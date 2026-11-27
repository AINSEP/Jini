# w3b-ext-w2b — Jini working-tree handoff

No commits: coordinator owns `.git`. No tests, builds, installs, typechecks or linters run.
Initial Jini HEAD: `7ccdb01e97c9192b3bf076b76a5a054eb9ffa267` (`codex/r2-ext-w2bj`, round-1 w2 Jini work).
Tovu sources read from reviewed merge-23 `724ddc31a`: this matches the checked sheet anchors. The Tovu clone's checkout is the older `bdeb4ea69f` and was not used as extraction source. No Tovu files were changed.
Dispatch overrides generic skill requirements for test execution, priming confirmation, new comments, and delegation.

## Sheet disposition, in design order

| Jini sheet | Disposition | Evidence / prerequisite |
|---|---|---|
| 61 | STOP | Required w3b-ext-w2a J19 is absent. `packages/core/src/contracts/site/page-html-store.ts` has the old store but no `PageHtmlInverse` or `restore` extension. Do not duplicate its scoped HTML contract. |
| 62 | STOP | Depends on 61; additionally reviewed Tovu `post/post-trash.ts:204-246` still reads current/version/ledger before `repo.transaction`, with no required host post fence. The required p11rest cutover has not landed in this source. |
| 64 | LEFT dependent | Requires 61–62. Confirmed core already has `ToolContributor` and `AssistantSurfaceDeps`. |
| 66 | BUILT, unexecuted | Lazy scratch mirroring and serialization pin. |
| 68 | BUILT, unexecuted | References, internal attached-only grant view, owner scope, policy/catalog/tools. |
| 70 | BUILT, unexecuted | Durable SQL deny store, lock-before-read, health/list failure pins. |
| 72 | BUILT, unexecuted | Scoped recovery registrar; node runtime inherited from DB, required surfaces, injected refuseUnexpectedKeys. Includes surviving J24 pins. |
| 74 | STOP | Required post-T06 source is unavailable: reviewed `site-exporter.ts:16,20,22` still imports `./static-security-headers.js`, `./media-original-urls.js`, and `./export-html-policy.js`. Jini has J06 owners, but T06's required source cutover is not present. No pre-T06 orchestration copied. |
| 76 | BUILT, unexecuted | Inspection catalog and schemas only. |
| 78 | BUILT, unexecuted | Core credential contracts; integrations keeps its public type API on substantive project-scope implementation. |
| 79 | BUILT, unexecuted | Injected vault policy, typed DTO mappers, guarded repo opening and stale probe check. |
| 81 | STOP: missing contract | Sheet preserves read deps and adds `policy` only to write deps. But read-only `resolveDefaultForSourceControl` (`store.ts:582-597`) calls `normalizeStoredToken` (`:594`) and uses `CREDENTIAL_MESSAGES.storage` (`:591,596`); `vault` (`:57-58`) also needs that message. Both are host policy per the sheet. No read-side policy carrier is specified. Adding it, moving validation policy into devops, or deleting normalization would redesign/change behavior. Also source move `:30-597` alone exceeds the 500-line file limit before adding policy; no additional output file is named. |
| 83 | LEFT NEEDS-OPUS | Literal SecretCardEngineHost callback signatures are still missing; explicitly withheld by checked sheet. |
| 84 | LEFT dependent | Requires 81 and NEEDS-OPUS 83. |
| 86 | STOP | Required shipped `applyRunActor`, `requiredMutationActor`, and `MissingMutationActorError` do not exist at this HEAD. `cms/src/core/mutation-actor.ts` only owns `checkedMutationActor`; `publish/content/repo-handler.ts` ends at `createRepoPublishHandler`. Do not invent the upstream actor mechanism. |
| 88 | BUILT, unexecuted | Core outcome/mover contracts, authorized snapshots, member transaction effects and SQL adapters. |
| 92 | STOP | Same missing actor owners as 86. Reviewed widget source does call `applyRunActor`; moving it now would import a missing Jini symbol. |

No REJECT sheets belong to the Jini subset. All 16 Tovu sheets (63,65,67,69,71,73,75,77,80,82,85,87,89,90,91,93) are outside this dispatch. Their dependencies remain gated by the table above. No independent H2 migrations were added: those are arch sheets outside this set.

## Completed design commits (coordinator to commit, in sheet order)

1. **66 — lazy scratch search**
   - Create `packages/cms/src/posts/search-index.memory.ts`.
   - Test first: `packages/cms/src/posts/__tests__/search-index.memory.test.ts`.
   - Update `packages/cms/package.json`; add `.changeset/w3b-ext-w2b-66.md`.
   - Pin: two reseeds serialize projection clear → posts clear → insert/upsert → query on one lazy scratch.
   - Mutation: `POST-SCRATCH-QUERY-OUTSIDE-TXN`.

2. **68 — project key references, lifecycle and tools**
   - Create `packages/user-management/src/project-keys/{site-references,service,tools}.ts`.
   - Extend `packages/core/src/contracts/site/project-key-attachments.ts` with the two reference interfaces.
   - Tests first: `packages/user-management/src/project-keys/__tests__/{site-references,service,tools}.test.ts`.
   - Update `packages/user-management/package.json`; add `.changeset/w3b-ext-w2b-68.md` (core + user-management).
   - Pins/mutations: reference removal uses revision 7 (`PK-REFERENCE-REMOVE-WITHOUT-CAS`); site-only save does not attach its owner sibling (`PK-ATTACH-SITE-SAVE`); ungranted rows cannot be revoked/disclosed (`PK-REVOKE-WITHOUT-GRANTED-LOOKUP`); use:true fails before authorize (`PK-TOOL-ALLOWS-GRANT`); per-kind permission follows granted lookup (`PK-REVOKE-SKIP-KIND-PERMISSION`); listGranted never lists owner vault (`PK-LISTGRANTED-USES-OWNER-VAULT`).
   - Tovu must inject `owner`, `attachedPolicy`, `permissionForRow`, reference identity/hash callbacks, format, and copy. No `grantedVault` parameter exists.

3. **70 — durable deny store**
   - Create `packages/cms/src/publish/trust/revocations.sql.ts`.
   - Test first: `packages/cms/src/publish/trust/__tests__/revocations.sql.test.ts`.
   - Update `packages/cms/package.json`; add `.changeset/w3b-ext-w2b-70.md`.
   - Pins/mutations: concurrent revokes at cap, plus restore lock order (`REVOCATIONS-READ-BEFORE-LOCK`); unreadable health aborts boot (`REVOCATIONS-BOOT-FAIL-OPEN`); unreadable list returns ok:false (`REVOCATIONS-LIST-FAIL-OPEN`).
   - The SQL test uses a real SQLite query handle with a transaction-local shared-lock seam, so lock order is observed independently of SQLite's own transaction serialization.

4. **72 — recovery registrar**
   - Create `packages/db/src/recovery/tool-registrations.ts`.
   - Test first: `packages/db/src/recovery/__tests__/tool-registrations.test.ts`.
   - Add `.changeset/w3b-ext-w2b-72.md`. Existing DB `./recovery/*` export and node runtime cover this leaf; no redundant manifest entry retained.
   - Pins/mutations: agent plan, human confirm, shared-lock agent execute (`RECOVERY-CONFIRM-AS-AGENT`, `confirm-as-agent`, `execute-outside-shared-lock`, `RECOVERY-DROP-DELEGATED-BY`); exact point/pair/token/signal (`confirm-different-plan`, `lose-confirm-abort-signal`); no private/default surface (`RECOVERY-PRIVATE-SURFACE-FALLBACK`, `bind-private-recovery-surface`); denial precedes capabilities (`capabilities-before-authorize`); malformed token refuses execute (`RECOVERY-UNCHECKED-TOKEN-CAST`); no duplicate creation (`wire-duplicate-create`). The real host shared-lock held-lock pin remains Tovu 73's responsibility.
   - Core's existing branded `humanConfirmedHandler` is used in the test surface adapter, preserving the catalog build gate. The execution spy observes the orchestrator's exact delegated identity; the host execute callback is invoked under the real orchestrator's lock.

5. **76 — inspection catalog/schemas**
   - Create `packages/cms/src/site-inspection/agent-tools.ts`.
   - Test first: `packages/cms/src/site-inspection/__tests__/agent-tools.test.ts`.
   - Update `packages/cms/package.json`; add `.changeset/w3b-ext-w2b-76.md`.
   - Pin/mutation: only live schema has origin; capabilities alone uses visibility floor (`INSPECTION-ORIGIN-ON-LOCAL-SCHEMA`).

6. **78 — credential contracts**
   - Create `packages/core/src/contracts/site/{source-control-credentials,vendor-credentials,credential-project-half}.ts`.
   - Test first: `packages/core/src/contracts/site/__tests__/credential-sets.typecheck.ts`.
   - Update `packages/integrations/src/vendor-credentials/project-scope.ts` to import/re-export core declarations on its substantive surface.
   - Update `packages/core/package.json`; add `.changeset/w3b-ext-w2b-78.md` (core + integrations).
   - Type pins: summary has no sealed key, project read half needs no replacement/create writer (`CREDENTIAL-SUMMARY-EXTENDS-SEALED-RECORD`). Type pin is a conditional assignment, with no suppression directive.

7. **79 — vault credential adapters**
   - Create `packages/integrations/src/vendor-credentials/vault-adapter.ts`.
   - Tests first: `packages/integrations/src/vendor-credentials/__tests__/vault-adapter.test.ts`.
   - Update `packages/integrations/package.json`; add `.changeset/w3b-ext-w2b-79.md`.
   - Pins/mutations: actual abort-wrapped put port (`VAULT-OPEN-CAPTURED-UNGUARDED-REPO`); stale sealed probe cannot patch (`VAULT-PROBE-IGNORE-SEALED-BASIS`); foreign owner/unlisted kind/non-null principal refused (`VAULT-AUTHORIZE-ACCEPT-ANY-OWNER`). Test-only platform service injection exercises the actual open/put lifecycle; runtime imports only core.
   - Tovu supplies `acceptedKinds`, owner, parsers, openService and explicit source-control mapper. Vendor ctor fixes kind/mapper itself.

8. **88 — Trash movers/adapters**
   - Extend `packages/core/src/contracts/site/cms-trash.ts`.
   - Create `packages/cms/src/trash/site/{move-to-trash,adapters/media,adapters/member,adapters/post}.ts`.
   - Tests first: `packages/cms/src/trash/site/__tests__/{move-to-trash,marker-adapters}.test.ts`.
   - Update `packages/cms/package.json`; add `.changeset/w3b-ext-w2b-88.md` (core + cms).
   - Pins/mutations: denial never reads (`TRASH-READ-BEFORE-AUTH`); confirmed stale version refuses before Trash (`TRASH-MOVE-IGNORE-EXPECTED-VERSION`); restore advances credential fence (`TRASH-RESTORE-SKIP-CREDENTIAL-FENCE`); hide marker → fence → sessions → links in one transaction (`TRASH-HIDE-SKIP-SESSION-REVOKE`); both no-ops skip credential effects; stale post/media purge preserves row/revisions/blobs (`TRASH-PURGE-SKIP-VERSION`).
   - Tovu must inject snapshots, reentrant transaction, credential SQL effects, media classifier and tableExists. No retention changes or migrations.

## Exports / Tovu intake

New explicit exports + runtime entries:
- core universal: `contracts/site/{source-control-credentials,vendor-credentials,credential-project-half}`.
- Existing core universal exports extended: `contracts/site/{project-key-attachments,cms-trash}`.
- cms universal: `posts/search-index.memory`, `site-inspection/agent-tools`, `trash/site/{move-to-trash,adapters/member}`.
- cms node: `publish/trust/revocations.sql`, `trash/site/adapters/{media,post}`.
- user-management universal: `project-keys/{site-references,service,tools}`.
- integrations universal: `vendor-credentials/vault-adapter`; existing `vendor-credentials/project-scope` keeps type names with core provenance.
- db node: `recovery/tool-registrations` via existing wildcard.

No release version/lockfile pin invented. Coordinator must intake the resulting candidate and regenerate/review API baselines for core, cms, user-management, integrations, db. Do not merge baseline JSON by hand.

## Final diff review / deletions

- Removed incidental JSON formatting/Unicode changes introduced while updating manifests; preserved pre-existing duplicate core keys and all unrelated bytes.
- Removed redundant DB explicit export and partial entries map: existing recovery wildcard and node runtime already cover the new leaf, per build contract.
- Moved (deleted from old declaration location) only `CredentialScope` / `CredentialProjectHalf` plus their why-comments in integrations project-scope; type API retained as explicitly required on that substantive implementation.
- No existing tests, functions, guards, coverage settings, thresholds or capabilities deleted. No suppressions, skipped tests, eslint-disable, @ts-ignore or as any added.
- No whole source files deleted in Jini. No extra production helpers introduced beyond named sheet helpers and existing source helpers.

## Verification / audit

- 26 new runtime test cases, plus two compile-time contract assertions; none executed. Named mutations recorded, not applied or executed here.
- Reviewed every new source, local import target and manifest diff; all new relative import targets exist. `git diff --check` is clean. These are read-only source/diff checks, not typecheck/lint/build/test evidence.
- Architecture audit: WARNING / PARTIAL. Implemented leaves keep specified owners: core contracts only; CMS SQL behind StorageKernel; portable search behind scratch port; recovery uses DB/core and injected host gateway/surfaces/lock; vault implementation imports only core. Actor/policy prerequisites for stopped sheets remain unresolved. Runtime and declaration compatibility remain unverified until Opus runs checks.
- Function-quality review: source helpers retained; named media `currentVersion`/`flipAndReport` top-level; recovery list/capability/restore helpers split as required; files all below 500 lines. Original why-comments preserved. No additional complexity comments or architecture layers introduced.
- Cost: scratch reseeds O(n) workspace rows per search, one retained lazy scratch per index. Grant inventory stays bounded by existing attached-vault policy. No new polling, timers, cache or background queue.
- Self-validation not run: explicit dispatch prohibition. Suggested next routing: Opus tests, mutation review, API baseline regeneration; resolve stopped prerequisites/contracts before dependent Tovu cutovers.
