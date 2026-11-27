# ext-w2 Jini commit plan

Working tree only; `.git` is read-only. HEAD verified: fd06f45b12ae0516b0fc196f58d785eba4d3831e.
Source bodies read from Tovu bf1519bba7329e0637eee4a6600dbdaba48f83db (all 16 source line counts match); the live Tovu checkout has a different HEAD and was not modified.
Owner-approved sheets override generic skill requirements for seed approval, extra scaffolding/comments, and running checks. No tests, builds, installs, typechecks, linters, mutations, or API generators run here.

## 1. J01 — project vault contracts and grant fences

Files: `packages/core/src/contracts/site/project-key-attachments.ts`; `packages/user-management/src/project-keys/{attached-vault,create-vault,site-sealer}.ts`; corresponding three `__tests__/*.test.ts`; `packages/user-management/package.json`; `.changeset/j01-project-vault.md`.
Tests written before production: ungranted label never reads owner vault; replacement checks grant inside transaction; revocation during open withholds plaintext; wrong scope/null tails; active handle forwarding/no derivation.
Mutations: `PK-LABEL-BYPASS` removes the grant check before vault.find; `PK-CHECK-OUTSIDE-TXN` moves view.find before transaction; `PK-SKIP-POST-OPEN` removes the second allowed check. Each must fail its named witness in Opus verification.
API regeneration pending for core `./contracts/site/project-key-attachments` and user-management `./project-keys/{attached-vault,create-vault,site-sealer}`. Do not hand-edit generated hashes.

## 2. J02 — member login admission and readiness

Files: `packages/user-management/src/member-login/{providers,credentials,ready-providers}.ts`, `__tests__/{provider-admission,credential-readiness}.test.ts`, `packages/user-management/package.json`, `.changeset/j02-login-admission.md`.
Tests written first: different full preset with same ID is refused; duplicate admitted IDs disappear; readiness never resolves secrets and rechecks on second call; wrong endpoint/failing resolver returns fixed refusal.
Mutations: `OIDC-ID-ONLY-PIN` changes fingerprint comparison to ID membership; `OIDC-CACHE-READY` retains the first readiness projection. Named witnesses must go red.
API regeneration pending: user-management `./member-login/{providers,credentials,ready-providers}`.

## 3. J03 — mail capture clear

Files: `packages/user-management/src/mail/site/capture-clear.ts`, `__tests__/capture-clear.test.ts`, `packages/user-management/package.json`, `.changeset/j03-mail-capture-clear.md`.
Tests written first: denied principal never reads; denial uses injected error identity; clear retains reviewed workspace/arrays/revision.
Mutation: `MAIL-CLEAR-READ-LIVE-SET` replaces captured arrays with a second review in clear; the reviewed-ID witness must fail.
API regeneration pending: user-management `./mail/site/capture-clear`.

## 4. J04 — publish candidate

Files: `packages/devops/src/deploy/site/publish-candidate.ts`, `__tests__/publish-candidate.test.ts`, `packages/devops/package.json`, `.changeset/j04-publish-candidate.md`.
Tests written first: unsafe paths never resolve/read; configured order and literal key match; empty list/no match.
Mutation: `PUBLISH-CANDIDATE-RESOLVE-BEFORE-CONTAINMENT` moves resolvePath ahead of containment; unsafe-path witness must fail.
API regeneration pending: devops `./deploy/site/publish-candidate`. Host-specific suggestion commentary neutralized per G3.

## 5. J05 — artifact provider selection

Files: `packages/platform/src/object-store/site/artifact-provider.ts`, `__tests__/artifact-provider.test.ts`, `packages/platform/package.json`, `.changeset/j05-artifact-provider.md`.
Tests written first: saved-provider revoke does not resolve another provider; credential rotation preserves fallback tuple; explicit provider binding wins.
Mutation: `ARTIFACT-SAVED-PROVIDER-FALLBACK` drops savedProvider filtering; revoke witness must fail.
API regeneration pending: platform `./object-store/site/artifact-provider`. Provider example neutralized per G3.

## 6. J06 — static export transformations

Files: `packages/devops/src/static-export/site/{static-security-headers,media-original-urls}.ts` and corresponding two tests; `packages/cms/src/html/site/export-html-policy.ts` and corresponding test; both package manifests; `.changeset/j06-static-export.md`.
Tests written first: report-only policy stays out of meta; strip occurs before identity edits and preserves unrelated bytes; foreign media origin is not rewritten; binary response retains object/header identity.
Mutations: `EXPORT-ENFORCE-REPORT-ONLY` emits an enforced meta CSP from report-only header; `EXPORT-SKIP-NATIVE-STRIP` skips injected strip; `EXPORT-SKIP-ORIGIN-CHECK` drops same-origin guard. Each named witness must fail.
API regeneration pending: devops `./static-export/site/{static-security-headers,media-original-urls}`, cms `./html/site/export-html-policy`.

## 7. J07 — backup landing and push mechanics

Files: `packages/devops/src/backup/site/{static-download-landing,push-content}.ts`, corresponding two tests, `packages/devops/package.json`, `.changeset/j07-backup-mechanics.md`.
Tests written first: escaped site/page/theme labels retain delivered hrefs, empty/singular rendering; stale deferred read never builds manifest; database-first/manifest-last; reviewed parent/tree forwarded and committed counts preserved.
Mutations: `BACKUP-LANDING-RAW-TITLE` bypasses site title escaping; `BACKUP-COMMIT-DROP-REVIEWED-PARENT` drops parentCommitSha. Named witnesses must fail.
API regeneration pending: devops existing `./backup/site/static-download-landing` and new `./backup/site/push-content`.
T07 must bind `readPlannedFile: ({ file }) => readPlannedFile(file)`, manifest name/policy and cancellation copy. BackupPushResult remains structurally compatible with host PushResult.

## 8. J08 — newsletter admin refusals

Files: `packages/user-management/src/newsletter/http-error-responses.ts`, `__tests__/http-error-responses.test.ts`, `packages/user-management/package.json`, `.changeset/j08-newsletter-refusals.md`.
Tests written first: all ten class/status/code/detail shapes; unknown secret-shaped error falls through.
Mutation: `NEWSLETTER-RETURN-UNKNOWN-MESSAGE` adds a generic message mapper; unknown-error witness must fail.
API regeneration pending: user-management `./newsletter/http-error-responses`.

## 9. J09 — seal-AAD AST rule

Files: `packages/integrations/src/webhooks/site/seal-aad-invariant.ts`, `__tests__/seal-aad-invariant.test.ts`, `packages/integrations/package.json`, `.changeset/j09-seal-aad-rule.md`.
Tests written first: exact path/collapsed-call exemption; zero/multiple args fail closed; undefined versus shorthand AAD and unresolved spread.
Mutation: `AAD-ALLOW-UNRESOLVED` returns null for unresolved arguments/spreads; fail-closed witnesses must fail.
API regeneration pending: integrations `./webhooks/site/seal-aad-invariant`. Optional TypeScript peer/dev dependency added at ^5.6.0; Opus reconciles lockfile. Runtime scanner imports TypeScript only as a type; no runtime barrel change.

## Handoff and final scope review

- Implementation slices completed in order: J01–J09. No Jini sheet stopped; no OPUS-only/NEEDS-OPUS/REJECT Jini sheet in this set. All Tovu sheets remain outside this Jini-only job.
- All named Jini prerequisite files are byte-identical between ad71bf68dee9907ce4db8fe86dcb8d1ffd06e8ba and dispatch HEAD (read-only Git diff returned no changes).
- 29 focused tests added in 15 files, before the corresponding production changes. Existing tests were not deleted or weakened. No test/mutation execution or coverage measurement was performed, per dispatch.
- Static architecture review: the implementations use the specified owners; user-management has no new platform/integrations/CMS runtime imports; devops media has no CMS import; scanner has only a type import from TypeScript. Product policy remains injected. Source-only audit passes; runtime/type/API gates remain unverified.
- Neutrality: the requested `rg -ni 'tovu|open design|OD_'` over all 16 moved/extended production files returned no matches.
- Diff pruning: removed incidental JSON Unicode escaping changes in four manifests and restored unrelated CMS indentation. No source files, tests, capabilities, assertions, or measured coverage were deleted.
- Documentation: moved existing why-comments; added no new production explanatory comments. J04/J05 wording neutralized as explicitly required.
- Function review: retained existing named private helpers and statement/effect order except the listed injection/signature/unknown-element guards. No new helpers, factories, adapters, runtime barrels, or dependencies beyond J09's named TypeScript peer/dev dependency. Residual risk is unexecuted TypeScript/test/API validation; no claim of green gates.
- Tovu intake: requires candidate artifacts for core, user-management, devops, CMS, platform and integrations, then T01a–T09 bindings/repoints in the supplied order. There are 15 new direct subpaths (listed above), plus extended existing core project-key-attachments and devops landing exports. J09 accepts `ast` and `isExempt`; Tovu retains scanner policy/CLI. No Tovu package versions were invented.
- Opus follow-up: apply/revert all 15 named mutations, execute witnesses and gates, reconcile J09 lockfile, and regenerate the six corresponding API baseline files (core, user-management, devops, CMS, platform, integrations) before combined cutover. Baselines were deliberately not hand-edited.
- Overall delivery: PARTIAL verification, implementation complete. No commits or pushes; coordinator owns the nine logical commits above, including COMMIT-PLAN.md as the handoff ledger.
