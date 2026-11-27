# WMZ Jini fix pass — DO NOT COMMIT

Base HEAD ad558c8824ba2a97cbe58c110df80661aed371ee. Jini only; no subagents, package intake, installs, builds, tests, typechecks, linters, commits or pushes. Characterization pins are authored before their production edits; all remain UNEXECUTED. The supplied revision-2 fixes govern this pass. No whole-sheet stop for an independent blocked file.

Boundary checklist: no new runtime package edges; structural types for undeclared collaborators; required deps; preserve deferred reads, order, persisted bytes and result property presence. No theme edits or feature activation. Existing explicit design seeds are the style contract.

K0: Tovu-only ledger/counter inputs are not present in Jini and no Tovu writes are authorized; coordinator must run there. G3 residual LOC and keep entries belong to Tovu; no end-to-end MOVE is claimed by Jini.

## Ordered logical units (coordinator commits)

### WMZ17 → WMZ01 — identity prerequisite
WMZ17: remove added derive/deriveSigningSecret fallbacks; narrow existing service keyring contracts to activeKey, the only method used. Files: integrations/vendor-credentials/{vault-adapter.ts,__tests__/vault-adapter.test.ts}; platform/secrets/credential-sets/vault.service.ts. Added object-shape pin; existing change-vault-owner-key sealed fixture retained. Tovu vault-adapter must be <=40 LOC pure binding or DELETE at consumers.
WMZ01: DELETE duplicate user-management/project-keys/shared-oauth-disconnect.ts and its export/entry and changeset. Its no-CAS characterization moved into existing integrations/api-connections/__tests__/shared-oauth-disconnect.test.ts (no assertions weakened). Added disconnect-other-owner-credential mutation pin. Tovu imports existing integrations/api-connections/shared-oauth-disconnect; supplies ownerWorkspaceId, digest and copy. No user-management changeset for WMZ01.

### WMZ03 → WMZ04 → WMZ05 — media parity
WMZ03: singleton vault no longer duplicates service ownership validation; video extractor always receives signal property. Tests added first in media/site/__tests__/{provider-credential-store,view-video-tool}.test.ts. Existing sealed legacy fixture already pins change-credential-aad. Tovu provider store/vault/video paths must DELETE and bind at modules/media.ts and media-video-ports.ts. Media publish port fields remain required: Tovu theme fixture is an independent forbidden-theme-edit dependency, not loosened here.
WMZ04: generation-credentials.ts and its two tests move from integrations/media-providers to cms/media/site-generation (new universal export/entry); catalog remains integrations. Registrar saved-selection pass now uses original optional lookup and preserves undefined editorial properties. Tests pin unknown saved model and full upload shape before edit.
WMZ05: remove rewritten editorialFields helper; restore original local/remote field reads and filename override read position. IMPORTANT: claimed extra filename validation is NOT a mismatch: a96020e1e7:media-import/tool-registrations.ts:361 has the exact same guard as Jini. Keep it. No host/theme change authorized. Existing permission-before-I/O pin is open-local-file-before-authorize.

### WMZ06 / WMZ07 / WMZ09 / WMZ10b / WMZ11–13 / WMZ16 / WMZ20
WMZ06: G2 namespace is already required acceptsManifest at HEAD; no additional production edit. Existing descriptor filename constant remains unchanged.
WMZ07 remove-member-before-authorize: existing denied members_delete test asserts no read or remove. WMZ09 launch-when-sending-disabled: existing real newsletter/__tests__/launch-gate.test.ts conflicting-workspace pin tests disabled state; mocked handler gate refusal also retained. No sending changes.
WMZ10b: duplicate normalizePublishAt import removed; unchangedLiveRow receives the same injected comparator as first comparison. Existing no-op characterization strengthened to assert both comparisons before fix. WMZ10a STOP: actorKind omitted by pinned reconstruction and memory append; H2 execution prerequisite is forbidden in this dispatch. No actor/schema redesign. WMZ10d unreadable-inverse-is-unreferenced already pinned; X4-04 lock injection retained. WMZ10c built at HEAD.
WMZ11 undo-overwrites-newer-version already pinned by conflicting undo; Jini has permission/reporting/copy seams. Tovu must DELETE html-change-recording and bind at tool-host. WMZ12 execute-against-stale-approved-snapshot already pinned by stale selection case's execution closure.
WMZ13 callback now receives classified kind; tests assert symlink/fifo before refusal, count/yield absent. Tovu deletes isSpecialUnixEntry.
WMZ16 restore result uses source casts and preserves gateway plan identity plus createdAt property. Added characterization before edit. Existing no-surface pin = restore-without-confirmation; denied plan pin = deep-link-plan-before-authorize. Remove redundant explicit recovery export/entry (wildcard already node); no recovery changeset.
WMZ20 rename new public function exportHostSite, update direct tests. STOP anchor substitution: deploy/site/export-run.ts contains runExportSite callbacks, no runExport symbol. Keep existing static-export engine call until coordinator resolves anchor.

### WMZ21 — extra MOVE + plan parity
Test first: cms/site/__tests__/keep-off-content-store.test.ts assigns the CMS SQL adapter to devops KeepOffStore and asserts it drafts only selected HTML (execution/typechecking deferred). New node subpath cms/site/keep-off-content-store exports contentStore({db}); same SQL statements as source, no cms→devops edge. Tovu replaces contentStore SQL body with this call.
Backup savePlan now spreads required planVersion immediately after schema. Tovu passes planVersion:{tovuVersion:sources.tovuVersion}, preserving existing payload key/value and order without engine product identity. New pin tests persisted value/order; push-to-private-target pin checks no upload/commit on refusal. Correct push-jobs owner already backup/push-jobs at HEAD. Existing description/key-status copy seams are injected.

### WMZ24 — reuse owners / remove cycle
DELETE forbidden cms/trash/site/permissions.ts and adapters/user.ts plus their entries; remove added cms→user-management dependency. Relocate denied-visibility pin to existing cms/trash/__tests__/visibility.test.ts with its original deps/permissions contract. Retarget blocked-user SQL pin to existing user-management transition owner; add direct purge-blocked-user pin there, with no identity/session/event writes. Existing visibility pin kills return-row-without-visibility. Tovu must use cms/trash/visibility and user-management/identity/sql/user-trash-adapter directly.
STOP SQL portion of user cutover: existing user-management owner accepts store/policy ports, not db/tables/eventValues; revised sheet names no SQL factory to move the host SQL wiring into. No new CMS user adapter/cycle retained. Such Tovu residual is not counted until G3. Host trash-item delegates/LOC remain coordinator-owned.

### WMZ18 — G1 source-control injection
Existing blank-token, probe-failure, aborted-card and dry-run tests precede these fixes; blank-token pin is clear-saved-token-on-blank-patch. Replace source-control runtime platform/integrations imports with required deps fields: CREDENTIAL_MESSAGES, CredentialInputError, normalizeCredentialToken, credentialScopes, credentialCreateTarget; credential setup additionally takes abortGuardedCredentialRepo. Read and write operations both carry deps, including registrar and secure-card save. Sealer/card contracts come from core; plugin card loader/find signatures declared structurally. No vendor/server implementation edge. Existing URI/tool/copy fields already injected (G2). Tovu must forward the same deps object at all store reads/writes and abortGuardedSourceControlRepo calls.
Files: devops/source-control/site/{store.ts,store.validation.ts,credential-setup.ts,tool-registrations.ts,__tests__/store.test.ts,__tests__/credential-setup.test.ts}.

### WMZ21 — G1 backup service
Inject CustomCredentialValidationError, normalizeWriteFilePath, validateBranch, validateCommitMessage, buildAuthorizationHeader through required deps; structural signatures declared in backup-service.ts. Forward source-control store deps only when credential operations execute. Existing private-target/parent-SHA tests retain assertions and receive real collaborators. No changed refusal or authorization ordering.

### WMZ21 — G1 share projection
Projection host.deps now requires listTables/listColumns/declareDataModule/sqliteKernel/sqliteClientOf/sqliteConnectionOf/closeSqliteConnection; same call/read/cleanup positions. Kernel and search collaborator types are structural/core, no db/CMS runtime edge. Existing unknown-populated-table pin injects the real implementations. Tovu supplies serialize-capable connection projections (the source sqliteClientOf type is narrower than its runtime driver's serialize ABI).

### WMZ02 / WMZ09 — G1 mail
MailDeliveryToolCollaborators.deps injects exactly 15 platform runtime symbols; mail provider control/test-send/readiness/feedback types declared structurally in target files, shared DTOs use core. Test capture-clear binder supplies the same real operations. Newsletter mailer/sender types use core. Remove first-pass user-management→{platform,integrations} and devops→{platform,integrations,ui,agent-plugins,cms,db} runtime edges. Tovu must provide delivery collaborators.deps; four residual LOC/G3 checks remain Tovu work and are not counted by this Jini pass.

### WMZ10b / WMZ21 / WMZ22 — remaining structural contracts
Preview and site inspection declare the already-injected diagnostics callback types structurally; retain injected rendering/fetch operations. Retention result/policy shapes are structural. Remove first-pass cms→diagnostics dependency. Existing site inspection denied-live-URL test kills fetch-before-live-url-refusal; no fetch/limit behavior changed.

### Mutation follow-up and review
Add delete-post-without-expected-version to existing post.trashed-slug-release test: a marker conflict receives the exact read version, causes no revision/outbox effect and retains the row. disconnect-other-owner-credential uses a valid baseline digest/revision, so removing the owner check reaches CAS and fails its no-write assertion. Generator upload reads now occur in their original object order. Permission imports repointed to core. Restore incidental db JSON Unicode formatting. Test-only package imports are devDependencies, not runtime dependencies; no intake/install/lockfile update.

Core media-tool-ports property-presence correction: existing optional editorial and apiKey/baseUrl fields explicitly admit undefined, matching source object properties without runtime guards/defaults. Patch changeset wmz-media-port-property-presence.md. Characterization upload-shape assertions were written before this edit.
WMZ21 additional exact-source correction: backup-service.push.ts had toolId:PUSH_WAIT_MS plus a stray SITE_BACKUP_PUSH_TOOL_ID property in three calls, unlike Tovu a96020e1e7:679/694/701. Restore toolId:SITE_BACKUP_PUSH_TOOL_ID; private-target pin now also checks original diagnostic prefix before this fix.

## Stops and dependent work (final)
- K0/counter/G3: Tovu-only. No Tovu file touched, no residual counted, no end-to-end MOVE asserted. Coordinator measures every residual LOC and exact keep after cutover.
- WMZ03 media publish: Tovu theme fixture still lacks required uploadCaps/createBlobWriteBindings. No forbidden theme edit or fallback default added. Credential/video parity blockers fixed independently.
- WMZ04: generation-credentials is now CMS-owned. Registrar's readSavedCredential host binding must project the original apiKey/optional baseUrl result (no stored model field forwarded), and readEnvCredential must return the original credential-free absent-key outcome. Both use existing ports; no cms→integrations edge.
- WMZ05 Tovu cutover requires WAL-02/03/04; skip deleted asset-transfer/image-transform callers. Claimed filename-check mismatch was disproved against a96020e1e7:361; retain guard.
- WMZ10a: actorKind reconstruction mismatch remains, and H2 tests cannot run here. SQL repo/codec and memory repo remain NEEDS-OPUS.
- WMZ10d: X4-04 prerequisite missing: packages/core/src/contracts/site/post-revision-lock.ts does not exist at this HEAD. Existing injected lock bytes retained, no new fallback/redefinition.
- WMZ19a: guard CLIs already built at HEAD; existing synthetic tracked/history finding test asserts full finding shape and no secret value (leak-secret-value-in-finding).
- WMZ19b STOP keyring.env.ts: platform EnvOrFileKeyringRequired is env/envVarName/keyFilePath, caches first root; Tovu EnvOrFileKeyring takes ordered sources and resolves on every derive. No named ordered derivation seam exists; material.firstPresentSiteKey is private and loses parsed hexDigits in public results. Cannot replace by a cached primitive or invent an unlisted contract. Its 17-production/198-test importer ledger is Tovu work.
- WMZ19c HOLD / NEEDS-OPUS: site-key-ensure.ts/site-key-sources.ts state machine has no designed root-key/ensure contract. Existing first-pass artifacts left untouched; no additional root state-machine work or count claimed.
- WMZ20 specified deploy/site/export-run.ts#runExport anchor absent (it accepts runExportSite callbacks). New entry renamed exportHostSite independently; existing static-export engine call retained.
- WMZ23 catalog STOP: existing taxonomyAgentToolCatalog is static; preserving it plus injecting new permissions/read refs needs an additive factory name absent from the sheet. Publishing remains available at HEAD.
- WMZ24 SQL user adapter: existing user-management owner is a transition factory over store/policy, not a db/tables SQL factory. Forbidden CMS duplicate deleted; host must bind existing transition ports, and SQL residual is not counted until an approved SQL home is named. WAL-17 remains its cutover prerequisite.
- WMZ08/14/15/25/26/27 require no additional Jini production edits: existing owners/copy/table seams remain. WMZ15/25 KEEP only; no new changeset/test. WMZ27 already requires policy.bindingTable; persisted host name remains injected.

## Final review / cleanup
Removed only sheet-required duplicates: user-management shared OAuth disconnect (+ migrated test and redundant changeset), CMS site permissions/user adapter (+ migrated visibility test), integrations generation-credentials (moved with two tests), redundant explicit db recovery export/entry/changeset. Removed helper editorialFields and duplicate normalizePublishAt import. Removed added vault derivation fallbacks. Restored incidental JSON Unicode formatting. Removed unnecessary filename injection after verifying WMZ06's G2 namespace is already acceptsManifest; retained original exported descriptor filename. Removed accidental duplicate deps destructuring during source review. No test assertion/threshold/exclusion weakened, no test skipped.

Architecture audit: WARNING — no new runtime package edges remain in touched package manifests; cross-package operations are injected and undeclared package type imports removed from changed production files. Known contract/prerequisite stops listed above. SQL/data and security state transitions were not redesigned. No quality/coverage pass claimed: all execution checks prohibited by dispatch.

Function-quality review: changed logic consists of original property projection, existing owner delegation, and dependency forwarding; no new algorithm or retry/resource policy. Existing complexity/resource bounds preserved. New contentStore is one return object of existing SQL methods (<80 lines, one scan per requested collection). Owner/plan/version/capture/credential mutation probes map directly to assertions. Remaining no-runtime-evidence risk is explicit.

Fresh evidence: git diff --check passes; scoped caller/source review completed. No tests/builds/installs/typechecks/linters/package intake/commits/pushes. No Tovu, theme, desktop, mount, schedule or exposure changes.

## Mutation ledger — authored/reused, all UNEXECUTED

| WMZ | Named mutation(s) | Pin |
|---|---|---|
| 01 | disconnect-other-owner-credential; skip-reviewed-grant-digest | integrations/api-connections/__tests__/shared-oauth-disconnect.test.ts |
| 02 | clear-reviewed-capture-without-reread | user-management/mail/status/__tests__/registrations.test.ts |
| 03 | change-credential-aad; omit-stored-hash-check; serve-indexed-private-image | cms/media/site/__tests__/provider-credential-store.test.ts; blob-write-bindings.test.ts; search/site media-search-source test (HEAD) |
| 04 | env-wins-over-valid-saved-key | cms/media/site-generation/__tests__/generation-credentials.test.ts (moved) |
| 05 | open-local-file-before-authorize | cms/media/site-import/__tests__/tool-registrations.test.ts |
| 06 | hash-manifest-instead-of-descriptor | user-management/member-login/__tests__/bundled-providers.test.ts (HEAD) |
| 07 | remove-member-before-authorize; include-challenge-token-in-tool-result | user-management/members/__tests__/tool-registrations.test.ts (HEAD) |
| 08 | skip-expected-version-on-repoint | cms/navigation/site/__tests__/publish-content.test.ts (HEAD) |
| 09 | launch-when-sending-disabled; fan-out-reviewed-campaign-without-recheck | user-management/newsletter/__tests__/launch-gate.test.ts; newsletter/delivery/__tests__/tool-registrations.test.ts (HEAD) |
| 10a | omit-update-version-check; drop-actor-id-from-revision-row | stale-update pin retained; actor-codec mutation HELD with missing repository |
| 10b | delete-post-without-expected-version | cms/posts/__tests__/post.trashed-slug-release.test.ts |
| 10d | unreadable-inverse-is-unreferenced | cms/posts/sql/__tests__/revision-refs.test.ts (HEAD); X4-04 prerequisite held |
| 11 | undo-overwrites-newer-version; commit-html-when-recording-fails | cms/pages/__tests__/html-recording-revert.test.ts (HEAD) |
| 12 | execute-against-stale-approved-snapshot; use-preview-selection-without-fresh-authorization | cms/trash/permanent/__tests__/tool-registrations.test.ts (HEAD) |
| 13 | count-or-yield-before-special-refusal | agent-plugins/lifecycle/__tests__/yauzl-special-refusal.test.ts |
| 14 | run-pull-before-approval | cms/publish/content/__tests__/tool-registrations.test.ts (HEAD) |
| 15 | read-alternate-public-origin-key | unchanged host provisioning pin; no Jini edit |
| 16 | restore-without-confirmation; deep-link-plan-before-authorize; register-unwired-backup-entry | db/recovery/__tests__/tool-registrations.test.ts |
| 17 | change-vault-owner-key | integrations/vendor-credentials/__tests__/vault-adapter.test.ts sealed fixture retained |
| 18 | clear-saved-token-on-blank-patch; save-after-card-abort; commit-during-dry-run | devops/source-control/site/__tests__/{store,credential-setup,tool-registrations.dry-run}.test.ts |
| 19a | leak-secret-value-in-finding; ignore-missing-aad | diagnostics/redaction/__tests__/repo-secret-scan.node.test.ts; integrations/webhooks/site/__tests__/seal-aad-invariant.node.test.ts (HEAD) |
| 19b/c | skip-first-present-invalid-key; restamp-with-key-dependent-data | existing material/reconcile pins retained; ordered keyring and state-machine moves HELD |
| 20 | prefer-explicit-base-path-over-destination; leave-stale-feed-without-public-origin | devops/static-export/site/__tests__/site-exporter.test.ts |
| 21 | push-to-private-target; commit-after-parent-changes; skip-unknown-populated-table-refusal; unlink-before-expiry-tombstone | devops/backup/site/__tests__/{backup-service,share-retention}.test.ts; share-database/__tests__/projection.test.ts |
| 22 | fetch-before-live-url-refusal; accept-caller-context-override | cms/site-inspection/__tests__/tool-registrations.test.ts (HEAD) |
| 23 | apply-child-before-parent | cms/taxonomy/site/__tests__/publish-content.test.ts (HEAD); catalog held |
| 24 | purge-blocked-user; return-row-without-visibility; advance-credential-fence-outside-marker-transaction | user-management/identity/sql/__tests__/user-trash-adapter.test.ts; cms/trash/__tests__/visibility.test.ts; cms/trash/site/__tests__/marker-adapters.test.ts |
| 25 | change-per-host-window | unchanged host budget pin; no Jini edit |
| 26 | authorize-after-listing-captures | integrations/web-screenshot/__tests__/capture-retention.test.ts (HEAD) |
| 27 | write-widget-before-destination-schema-check | cms/widgets/site/__tests__/publish-content.test.ts (HEAD) |

## Test declarations (static count, not test results)

Changed/moved test files: 68 → 80 declarations (net +12). Duplicate-owner test deletions are migrations with their assertions retained at the existing owner. No executed/mutation/coverage result claimed.

| File | Before | After |
|---|---:|---:|
| `packages/agent-plugins/src/lifecycle/__tests__/yauzl-special-refusal.test.ts` | 1 | 1 |
| `packages/cms/src/media/site-generation/__tests__/tool-registrations.test.ts` | 4 | 5 |
| `packages/cms/src/media/site-import/__tests__/tool-registrations.test.ts` | 6 | 7 |
| `packages/cms/src/media/site/__tests__/provider-credential-store.test.ts` | 4 | 5 |
| `packages/cms/src/media/site/__tests__/view-video-tool.test.ts` | 3 | 4 |
| `packages/cms/src/posts/__tests__/post.trashed-slug-release.test.ts` | 4 | 5 |
| `packages/cms/src/trash/__tests__/visibility.test.ts` | 2 | 3 |
| `packages/cms/src/trash/site/__tests__/marker-adapters.test.ts` | 7 | 7 |
| `packages/cms/src/trash/site/__tests__/permissions.test.ts` | 1 | 0 |
| `packages/db/src/recovery/__tests__/tool-registrations.test.ts` | 7 | 8 |
| `packages/devops/src/backup/site/__tests__/backup-service.test.ts` | 2 | 4 |
| `packages/devops/src/backup/site/share-database/__tests__/projection.test.ts` | 1 | 1 |
| `packages/devops/src/source-control/site/__tests__/credential-setup.test.ts` | 1 | 1 |
| `packages/devops/src/source-control/site/__tests__/store.test.ts` | 2 | 2 |
| `packages/devops/src/source-control/site/__tests__/tool-registrations.dry-run.test.ts` | 1 | 1 |
| `packages/devops/src/static-export/site/__tests__/site-exporter.test.ts` | 2 | 2 |
| `packages/integrations/src/api-connections/__tests__/shared-oauth-disconnect.test.ts` | 4 | 6 |
| `packages/integrations/src/media-providers/__tests__/generation-credentials.test.ts` | 3 | 1 |
| `packages/integrations/src/vendor-credentials/__tests__/vault-adapter.test.ts` | 5 | 6 |
| `packages/user-management/src/identity/sql/__tests__/user-trash-adapter.test.ts` | 4 | 5 |
| `packages/user-management/src/mail/status/__tests__/registrations.test.ts` | 3 | 3 |
| `packages/user-management/src/project-keys/__tests__/shared-oauth-disconnect.test.ts` | 1 | 0 |
| `packages/cms/src/media/site-generation/__tests__/generation-credentials.test.ts` | 0 | 2 |
| `packages/cms/src/site/__tests__/keep-off-content-store.test.ts` | 0 | 1 |

## Exact working-tree inventory (coordinator stages; omit COMMIT-PLAN.md)

- DELETE `.changeset/wmz01-project-keys.md`
- CHANGE `.changeset/wmz04-generation.md`
- DELETE `.changeset/wmz16-recovery.md`
- CHANGE `packages/agent-plugins/src/lifecycle/__tests__/yauzl-special-refusal.test.ts`
- CHANGE `packages/agent-plugins/src/lifecycle/yauzl-archive-reader.ts`
- CHANGE `packages/cms/package.json`
- CHANGE `packages/cms/src/media/site-generation/__tests__/tool-registrations.test.ts`
- CHANGE `packages/cms/src/media/site-generation/tool-registrations.ts`
- CHANGE `packages/cms/src/media/site-import/__tests__/tool-registrations.test.ts`
- CHANGE `packages/cms/src/media/site-import/tool-registrations.ts`
- CHANGE `packages/cms/src/media/site/__tests__/provider-credential-store.test.ts`
- CHANGE `packages/cms/src/media/site/__tests__/view-video-tool.test.ts`
- CHANGE `packages/cms/src/media/site/provider-credential-vault.ts`
- CHANGE `packages/cms/src/media/site/view-video-tool.ts`
- CHANGE `packages/cms/src/posts/__tests__/post.trashed-slug-release.test.ts`
- CHANGE `packages/cms/src/posts/post-tool-duplicate.ts`
- CHANGE `packages/cms/src/posts/post-tool-input.ts`
- CHANGE `packages/cms/src/posts/post-update.ts`
- CHANGE `packages/cms/src/posts/preview-tool.ts`
- CHANGE `packages/cms/src/posts/tool-registrations.handlers.ts`
- CHANGE `packages/cms/src/posts/tool-registrations.ts`
- CHANGE `packages/cms/src/site-inspection/tool-registrations.ts`
- CHANGE `packages/cms/src/trash/__tests__/visibility.test.ts`
- CHANGE `packages/cms/src/trash/permanent/tool-registrations.ts`
- CHANGE `packages/cms/src/trash/site/__tests__/marker-adapters.test.ts`
- DELETE `packages/cms/src/trash/site/__tests__/permissions.test.ts`
- DELETE `packages/cms/src/trash/site/adapters/user.ts`
- DELETE `packages/cms/src/trash/site/permissions.ts`
- CHANGE `packages/core/src/contracts/site/media-tool-ports.ts`
- CHANGE `packages/db/package.json`
- CHANGE `packages/db/src/recovery/__tests__/tool-registrations.test.ts`
- CHANGE `packages/db/src/recovery/tool-registrations.ts`
- CHANGE `packages/devops/package.json`
- CHANGE `packages/devops/src/backup/site/__tests__/backup-service.test.ts`
- CHANGE `packages/devops/src/backup/site/backup-service.credentials.ts`
- CHANGE `packages/devops/src/backup/site/backup-service.plan.ts`
- CHANGE `packages/devops/src/backup/site/backup-service.push.ts`
- CHANGE `packages/devops/src/backup/site/backup-service.ts`
- CHANGE `packages/devops/src/backup/site/share-database/__tests__/projection.test.ts`
- CHANGE `packages/devops/src/backup/site/share-database/projection.tables.ts`
- CHANGE `packages/devops/src/backup/site/share-database/projection.ts`
- CHANGE `packages/devops/src/backup/site/share-retention.ts`
- CHANGE `packages/devops/src/source-control/site/__tests__/credential-setup.test.ts`
- CHANGE `packages/devops/src/source-control/site/__tests__/store.test.ts`
- CHANGE `packages/devops/src/source-control/site/__tests__/tool-registrations.dry-run.test.ts`
- CHANGE `packages/devops/src/source-control/site/credential-setup.ts`
- CHANGE `packages/devops/src/source-control/site/store.ts`
- CHANGE `packages/devops/src/source-control/site/store.validation.ts`
- CHANGE `packages/devops/src/source-control/site/tool-registrations.ts`
- CHANGE `packages/devops/src/static-export/site/__tests__/site-exporter.test.ts`
- CHANGE `packages/devops/src/static-export/site/site-exporter.ts`
- CHANGE `packages/integrations/package.json`
- CHANGE `packages/integrations/src/api-connections/__tests__/shared-oauth-disconnect.test.ts`
- CHANGE `packages/integrations/src/media-providers/__tests__/generation-credentials.test.ts`
- DELETE `packages/integrations/src/media-providers/generation-credentials.ts`
- CHANGE `packages/integrations/src/vendor-credentials/__tests__/vault-adapter.test.ts`
- CHANGE `packages/integrations/src/vendor-credentials/vault-adapter.ts`
- CHANGE `packages/platform/src/secrets/credential-sets/vault.service.ts`
- CHANGE `packages/user-management/package.json`
- CHANGE `packages/user-management/src/identity/sql/__tests__/user-trash-adapter.test.ts`
- CHANGE `packages/user-management/src/mail/status/__tests__/registrations.test.ts`
- CHANGE `packages/user-management/src/mail/status/delivery-tool-registrations.ts`
- CHANGE `packages/user-management/src/mail/status/provider-operations.ts`
- CHANGE `packages/user-management/src/mail/status/provider-tool-registrations.ts`
- CHANGE `packages/user-management/src/mail/status/tool-registrations.ts`
- CHANGE `packages/user-management/src/newsletter/tool-registrations.ts`
- DELETE `packages/user-management/src/project-keys/__tests__/shared-oauth-disconnect.test.ts`
- DELETE `packages/user-management/src/project-keys/shared-oauth-disconnect.ts`
- CREATE `.changeset/wmz21-keep-off.md`
- CREATE `.changeset/wmz-media-port-property-presence.md`
- CREATE `packages/cms/src/media/site-generation/generation-credentials.ts`
- CREATE `packages/cms/src/media/site-generation/__tests__/generation-credentials.test.ts`
- CREATE `packages/cms/src/site/keep-off-content-store.ts`
- CREATE `packages/cms/src/site/__tests__/keep-off-content-store.test.ts`

## Tovu API handoff

- Existing integrations/api-connections/shared-oauth-disconnect replaces deleted user-management duplicate. Supply ownerWorkspaceId/digest/copy.
- New CMS universal media/site-generation/generation-credentials replaces integrations path.
- New CMS node site/keep-off-content-store#contentStore({db}) replaces host keep-off SQL.
- Existing CMS trash/visibility and user-management/identity/sql/user-trash-adapter replace deleted CMS duplicates. No forwarding shell.
- db/recovery/tool-registrations resolves via existing node wildcard; explicit universal entry removed.
- devops/static-export/site/site-exporter now exports exportHostSite. Existing engine exportSite remains unchanged.
- Mail delivery supplies collaborators.deps (15 operations/errors); other mail operations keep existing API.
- Source-control store/read operations supply required deps (credential messages/error/normalizer/scope operations); setup adds abortGuardedCredentialRepo. Forward same object through registrar, secure-card save, commit credentialDeps and backup credential resolution.
- Backup service supplies deps for validation/authorization-header construction and planVersion:{tovuVersion:sources.tovuVersion}. Plan-store port adapter retains the host version field in its host-owned plan type.
- Share projection supplies host.deps (seven schema/SQLite operations); serialize-capable driver adapters remain host-owned.
- Special Unix refusal callback receives {entry,kind}; Tovu removes its classifier.
- Media provider store/vault/video wrappers DELETE; bind the existing credential/vault/readers at modules/media.ts/media-video-ports.ts.
- No package intake or end-to-end deletion count is claimed. Opus executes all tests/mutations and H2 migration prerequisites, then coordinator completes Tovu importers, G3 residual checks, K0 and counter.
