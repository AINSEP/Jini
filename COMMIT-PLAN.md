# Round 3 w3c-w1a — Jini working-tree delivery

Dispatch: Jini only; no agents; `.git` read-only. HEAD `10517f584`. Tests were authored before the corresponding implementation. No tests, builds, installs, typechecks, linters, baseline tools or mutation runs were executed. Mutation names below are intended kill targets, not claimed results.

Source bodies were read from Tovu `origin/integ/merge-23-2026-11-25` into `/tmp/r3-w1aj-source` (outside the delivery). Named source line extents match the checked sheets. No Tovu files were edited. The literal FIX text and owner decisions govern these cuts.

## Completed Jini design commits, in check order

1. **W1-10 — Plugin widget partials**
   - Create `packages/plugins/src/runtime/widget-partials.ts` and `packages/plugins/src/runtime/__tests__/widget-partials.test.ts`.
   - Change `packages/plugins/package.json` (export triple and universal entry).
   - Create `.changeset/w3c-w1-plugin-widget-partials.md`.
   - Tests (3): inactive requested fragment cannot appear; validator before expansion; no markers preserves exact bytes with no lookup.
   - Mutations: `PLUGIN-PARTIAL-ASSUME-ENABLED`, `PLUGIN-PARTIAL-SKIP-VALIDATION`.
   - Tovu: bind marker name reads, fragment validator and theme expansion at the existing response/test roots; delete the source implementation. New `@jini-ai/plugins/runtime/widget-partials`.

2. **W1-02 — API connection vault records/attempts/archive**
   - Create `packages/integrations/src/api-connections/vault-stores.ts` and `packages/integrations/src/api-connections/__tests__/vault-stores.cutover.test.ts`.
   - Change `packages/integrations/package.json` (export triple and node entry).
   - Create `.changeset/w3c-w1-api-connection-vault.md`.
   - Tests (7): exactly one attempt consumer; wrong sealed record key refused; shared/staged/incomplete rows omitted with count-only notices; receiver pair preserves generation and replaces owner/key while dropping staged state; generation/derived-key/record-id mismatches omitted; sweep deletes with observed revision and catches only conflicts; create/replace CAS.
   - Mutations: `API-ATTEMPT-DELETE-WITHOUT-REVISION`, `API-ARCHIVE-CARRY-SOURCE-OWNER`, `API-ARCHIVE-CARRY-STAGED-STATE`, `API-RECORD-SKIP-KEY-BINDING`, `API-ARCHIVE-SKIP-GENERATION-CHECK`, `API-ARCHIVE-SKIP-DERIVED-KEY-CHECK`, `API-SWEEP-DELETE-WITHOUT-REVISION`, `API-RECORD-CAS-IGNORE-REVISION`.
   - Tovu: `vault-store-binding.ts` keeps real vault construction, scope-before-parser/crypto guard and unchanged format/hash/label/namespace policy. Repoint listed callers to that binder or direct Jini types. Keep format fixture. Add host-only `API-VAULT-SCOPE-CHECK-AFTER-PARSE` witness. New `@jini-ai/integrations/api-connections/vault-stores`.

3. **W1-03 — Custom credential DELETE review and write validation**
   - Create `packages/integrations/src/custom-credentials/delete-request-confirmation-ui.ts`, `write-files-validation.ts`, `__tests__/delete-request-confirmation-ui.test.ts`, `__tests__/write-files-validation.test.ts`.
   - Change `packages/integrations/package.json` (export triples, universal review/node validation entries, credentialed-http lanes).
   - Create `.changeset/w3c-w1-custom-credential-confirmation.md` (corrected Appendix B name).
   - Tests (5): exact reviewed DELETE target and danger metadata; normalized collision; aggregate UTF-8 byte limit; reserved `.git` and traversal; branch dotdot/empty segments.
   - Mutations: `CRED-DELETE-REVIEW-DROP-PATH`, `CRED-DELETE-REVIEW-DANGER-OFF`, `CRED-WRITE-DUP-CHECK-BEFORE-NORMALIZE`, `CRED-WRITE-OMIT-TOTAL-LIMIT`, `CRED-WRITE-ALLOW-GIT-DIR`, `CRED-WRITE-ALLOW-DOTDOT`, `CRED-BRANCH-ALLOW-DOTDOT-SEGMENT`.
   - Tovu: bind tool ID and exact irreversible description at existing registrar. Add `repository-target.ts` with real devops validator; rewrite all nine callers to `{ validateTarget }`. Keep held-open approval/cancel and validation-before-resolution tests. Delete original two implementations. New `@jini-ai/integrations/custom-credentials/{delete-request-confirmation-ui,write-files-validation}`.

4. **W1-08 — Atomic user purge sequence**
   - Create `packages/user-management/src/identity/user-purge.ts` and `packages/user-management/src/identity/__tests__/user-purge.transaction.test.ts`.
   - Change `packages/user-management/package.json` (export triple and universal entry).
   - Create `.changeset/w3c-w1-identity-purge.md`.
   - Tests (3): exact scoped eight-delete/event/append/commit order; audit failure propagates through transaction and rolls back fake state; exact counts and absent/manual/retention reason.
   - Mutations: `PURGE-OUTBOX-AFTER-COMMIT`, `PURGE-EVENT-BEFORE-DELETES`, `PURGE-REORDER-PRINCIPAL-FIRST`, `PURGE-SKIP-VAULT`, `PURGE-SCOPE-OMIT-WORKSPACE`.
   - Tovu: implement `bindSqlUserPurgePorts` in `user-purge-sql-binding.ts`, keep raw outbox insert and existing kernel joining, rewrite twelve constructor sites and parity loader, update producer-ledger anchor. Keep/add real SQL rollback, attribution, issuer-key and same-principal/other-workspace witnesses (`PURGE-DELETE-ISSUER-KEYS`, `PURGE-BINDER-DROP-WORKSPACE-PREDICATE`). Jini fake transaction does not establish SQL rollback. New `@jini-ai/user-management/identity/user-purge`.

5. **Appendix A1 / W1b-09c — Root-key reconciler**
   - Create `packages/platform/src/secrets/root-key/reconcile.ts` and `packages/platform/src/secrets/root-key/__tests__/reconcile.test.ts`.
   - Change `packages/platform/package.json` (export triple and node entry).
   - Create `.changeset/w3c-w1b-root-key-reconcile.md`.
   - Tests (9), exactly Appendix A1: mismatch adoption/no writes; exact raw move-aside before stamped adoption/no restamp; dependent-data mismatch/no restamp; create-race winner fingerprint; scan memo; absent-with-data refusal; lazy stamped-source short circuit; no-meta action; unstamped-meta one write.
   - Mutations: `ROOT-KEY-ADOPT-BEFORE-STAMP-CHECK`, `ROOT-KEY-DELETE-INSTEAD-OF-MOVE-ASIDE`, `ROOT-KEY-RESTAMP-WITH-DEPENDENT-DATA`, `ROOTKEY-RETURN-CANDIDATE`, `ROOT-KEY-UNMEMOIZED-SCAN`, `ROOT-KEY-MINT-OVER-DATA`, `ROOT-KEY-READ-ALL-SOURCES`.
   - Tovu: keep production early return, filesystem/source/meta owners and real-file tests; bind exact Appendix A1 ports and attach `perSiteFilePath`; delete moved decision/effect helpers and duplicate pure table. No race/fsync change. New `@jini-ai/platform/secrets/root-key/reconcile`.

## Stopped sheets — no implementation or tests added

- **W1-06 / W1-07:** required `applyRunActor` export is absent from this HEAD's `packages/cms/src/publish/content/repo-handler.ts`. The checked sheet expects it near lines 440–458, with `MissingMutationActorError`. This file ends at line 437; its gateway still uses `deps.mutationActor ?? { id: input.principalId, kind: "user" }` at line 372. `packages/cms/src/core/mutation-actor.ts` contains only `ConflictingMutationActorError` and `checkedMutationActor`. Cannot copy the mandated actor call or test the required refusal without changing the prerequisite, outside these sheets.
- **W1-01:** upload source lines 207 and 312 call Tovu's context-bound `installAgentPlugin` (host `lifecycle.ts` wrapper). Jini `lifecycle/index.ts` exposes this only as a method of `createAgentPluginLifecycle`; it exports the install error/types, not a standalone bound installer. The specified upload ports list has `createArchiveReader`, hashing, containment, listing, activation, stage/restore/cleanup and `update`, but no bound installer or lifecycle construction context. A faithful move needs that missing named seam; adding it would violate the hard no-invented-ports rule. The source also predates the Tovu R03 identityRead edits at lines 137/234 (Jini R03 parser types exist). No partial export/upload cut was left behind.
- **W1-04A:** source `deploy-ops/agent-tools.ts:26` selects secret-capable platforms by `registry.list().filter(p => typeof p.module.listSecrets === "function")`; its no-registry path uses all bundled descriptors and different copy. The prescribed signature accepts descriptors, copy and maxWaitSeconds only. Descriptors do not carry this executable-module capability. Preserving the existing schema enums and description requires an unspecified capability input. Stopped rather than invent a flag/port or remove the filtering.

## Dependent / rejected / out of scope

- **W1-04B/C/D:** dependent on stopped A; not started.
- **W1-11:** dependent on missing actor prerequisite (round-2 33/34); not started. No second removal contract was created.
- **Appendix A2 / W1-01B:** explicitly ordered after stopped W1-01; not started.
- **W1-05:** REJECT; email-template binding stays in Tovu.
- **W1-09:** REJECT duplicate; round-1 J08/T08 owns mapper.
- **All w3c-w2:** REJECT.
- Ordinary w1b sheets are outside this dispatch's w1a scope. Appendix A1 is included explicitly above.

## Baselines and review

Opus must regenerate `api-baseline/jini-ai__{plugins,integrations,user-management,platform}.json` after building, as the sheet's verification handoff directs. No fabricated signature hashes and no baseline tooling run here. Existing baselines are untouched. Minor changesets and package metadata are written in the working tree; versions/ranges/lock are unchanged.

Architecture review by reading: changed production modules use core contracts or same-package owners; no cms dependency was added to plugins/integrations/user-management, no devops edge was added to integrations, and no nominal host SQL class crosses the purge/vault seam. Existing why-comments accompany moved behavior. No re-export shell, migration, new process store, extra guard/fallback, coverage exclusion or suppression was introduced.

Verification status: **UNRUN**, per dispatch. Added test count: **27**, removed: **0**. Mutation verification and package/build/API checks remain Opus work. Runtime and real SQL/filesystem behavior require the Tovu witnesses named above.

## Diff cleanup deletions

- Removed incidental JSON Unicode escaping introduced during metadata serialization; only required package entries remain.
- Removed an unnamed standalone `ApiConnectionVaultPort` interface; the specified structural vault slice is inline in the required arguments.
- No tracked source or existing test was deleted. No unrelated production cleanup was retained.
