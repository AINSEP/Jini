# X4 WAL Jini fix pass — coordinator commit plan (do not commit)

Baseline: 36617d43b, branch codex/x4f-walj. Jini only. No subagents, execution checks, installs, builds, tests, typechecks, linters, commits, pushes or package intake. All test/mutation claims are authored, not executed.
Architecture: preserve effects/read order and wire bytes; no new runtime dependency edges; required structural ports; named splits only. Dispatch design is the approved pattern and overrides generic skill confirmation/execution requirements.

## Ordered units
1. WAL-01: shared core scoped vault authorization, removes old database helper (no forwarder). Mutation drop-principal-null-check; test contracts/site/__tests__/vault-context.test.ts. Both host callers must bind new core helper, with binding:null.
2. WAL-02: narrow existing root-only helper contracts. Mutation picked-folder-escapes-root; registrar test refuses ../ and absolute target paths before target resolution. Retain existing truncation/decline pins. Do not touch fs-files.ts/site-file-request.ts.
3. WAL-03/04/05/06: existing implementations retained; repoint permission imports to core where needed. Existing first-pass tests retained.
4. WAL-07 STOP: baseline 3b89a0c26a applies missing termIds as empty through existing prepareTermSync; unchanged requested mutation contradicts behavior. No redesign authorized.
5. WAL-08: existing implementation retained.
6. WAL-17: workspace SQL/permission-first/password-schema security pins; injected identity card names retained. Mutations authz-sql-drop-workspace-predicate, permission-list-skip-permission-check, user-create-schema-exposes-password. Existing revocation/purge/owner pins retained.
7. WAL-15: existing registrar injected ports retained; access-only SQL pin; shared public-origin owner. Mutations access-write-keeps-stale-credential-pointer, update-without-expected-version, skip-post-card-basis-read.
8. WAL-09a STOP: automatic controller remains absent; baseline factory 84 lines vs hard 80 with no named split. No padding/formatting workaround.
9. WAL-09b: shared publicOrigin resolver; ordered token refusal pin token-refusal-order-swapped. Source connect-tool drift must be resolved by coordinator, not silently adopted.
10. WAL-09c/d: existing package surfaces retained; Tovu source drift prevents claiming cutover.
11. WAL-09e: rootOverride injection and exact diagnostics; layout-accept-dotdot-plugin-id.
12. WAL-09f: existing migration lock-order pin; Tovu memory blob drift still unresolved.
13. WAL-09g: fix provisioning port argument shape; capture-recovery-deps-at-bind; preserve deferred reads.
14. WAL-13a: catalog permission shadowing fix, bundled registry definition fix; run-ops bounded request/fingerprint and secret-confirm extraction. Mutations take-first-duplicate-target, forward-unbounded-response, confirm-before-permit.
15. WAL-13b: neutral structural types; owner-only project write/ordered sealing pins. Mutations read-registry-at-bind, fallback-after-explicit-choice-refusal, seal-before-owner-lookup, project-write-without-owner. Requires WMZ17 host binding; cannot claim host retirement here.
16. WAL-13c PARTIAL: structural undeclared-type corrections. Peer identity/type injection stopped (see stop notes); original history code restored. Existing credential-review pins retained.
17. WAL-13d: retain named splits/exports; no new runtime edges. Existing narrow-export pin retained.
18. WAL-12: gateway and ext-crp humanConfirmedToolHandler remain injected. Named prerequisite: ext-crp shared confirmation owner, already merged in merge-24, supplied by Tovu binding. Mutations execute-unconfirmed-restore-plan, restore-point-outside-operation-lock, confirm-with-agent-principal.
19. WAL-14: structural EmailTemplateStorePort; no CMS→platform type import. Existing rollback/CAS pins retained.
20. WAL-10: loadCreateCredentialProviders moves to credentialed-http/tools. Mutation create-provider-catalog-drop-fallback. Host must split tool-registrations.copy.ts and bind loader.
21. WAL-11/16: no Jini code change needed.

## Host-only counter work
K0 cannot run in Jini: Appendix B exact 177 paths not provided, five reports/scanner are Tovu planning artifacts; no Tovu writes authorized. No host residual checked, counted or declared DONE; G3 residual LOC/keeps must be supplied by Tovu lane after actual deletion/binding review.

## Source drift retained from Tovu report
connect-tool expected 67c6aa91c2 actual ee1411a1722db67f7bb0b7dc976bfe2e8aee6eb1;
exports/source expected ea24b05d72 actual 1ff1f20d47422b33351725838ef1e508679afc69;
install-tool expected 42e0e13086 actual 67b9ed3a3535e115c8a9f57313eba3266f380632;
install-upload expected 6c3263208f actual 8764aa143ddc53ff34c4b53f636ad31ab4da93f5;
memory expected 8515e1a54a actual 0eb10d8eea4bd39cf48f337b0d13574eabb689f3;
set-enabled expected fa704ffac2 actual abe61a2a61f65192fb84674f103b0ed67cf2266e.

## Final diff audit / files by commit
Pending. No test deleted or weakened. No theme or feature mount touched. All tests unexecuted per dispatch.

## Fix-pass stops discovered during inspection
- WAL-09b mutation token-refusal-order-swapped: parseNewSiteAgentPluginTokens delegates to parsePluginTokenMap, which checks count before entry shape/length. Neither parser has a retired-ID check. Retirement applies only to bundled discovery. Adding/swapping the requested parser decision would change behavior; no fake mutation pin authored.
- WAL-13b seal-before-owner-lookup: requested metadata → owner → seal → invalidate ceremony spans the host credential save composition and vault owner. The moved Jini store has no invalidation callback. The existing owner-only pin is retained and maps project-write-without-owner; full ceremony characterization must be authored in Tovu, not simulated by calling invalidation manually in a package test.
- WAL-13c publish-history G2: replacing the literal peer kind by string destroys the discriminated PublishDestination union and leaves an incompatible return type for host consumers. Preserving the caller's literal requires a new generic, prohibited unless named by the design. STOP this file pending an authorized type contract. Reverted the provisional history changes and associated own test; original wire bytes remain verbatim and are not claimed neutral/completed. Other 13c structural import corrections continue.

Cleanup deletions (own provisional work only): removed the provisional publish-history peer injection/test because its widened return discriminator would break host typing; restored publish-run test constructor with it. Moved the new credential catalog loader out of the 900+ line existing tool-registrations implementation into the existing public tools/index entry (named tools owner), so no unrequested file split was introduced. Removed the old authorizeDestinationVaultContext body; no compatibility forwarder.

## Files for coordinator commits (ordered; shared maps by union)

### WAL-01
- `packages/db/src/transfer/destination-store.ts`
- `packages/integrations/src/api-connections/shared-owner.ts`
- `.changeset/x4-walf-01-core.md`
- `.changeset/x4-walf-01-db.md`
- `packages/core/src/contracts/site/vault-context.ts`

### WAL-02
- `packages/cms/src/fs-files/__tests__/tool-registrations.test.ts`
- `packages/cms/src/fs-files/tool-registrations.ts`

### WAL-05
- `packages/cms/src/content-duplication/tool-registrations.ts`

### WAL-06
- `packages/cms/src/content-types/site/publish-content.ts`

### WAL-17
- `packages/user-management/src/identity/__tests__/sql-identity.test.ts`
- `packages/user-management/src/identity/__tests__/tool-registrations.identity-authorization.test.ts`

### WAL-15
- `packages/mcp/src/federation/hosted/__tests__/external-mcp-repo.sql.test.ts`

### WAL-09b
- `.changeset/x4-walf-09b-core.md`
- `packages/core/src/contracts/site/__tests__/public-origin.test.ts`
- `packages/core/src/contracts/site/public-origin.ts`

### WAL-09e
- `packages/agent-plugins/src/lifecycle/layout.ts`
- `packages/agent-plugins/src/site/__tests__/install-upload-update.unit.test.ts`
- `packages/agent-plugins/src/site/__tests__/site-layout.test.ts`
- `.changeset/x4-walf-09e-agent-plugins.md`

### WAL-09f
- `packages/agent-plugins/src/site/__tests__/memory.integration.test.ts`

### WAL-09g
- `packages/agent-plugins/src/site/__tests__/update-effects.unit.test.ts`
- `packages/agent-plugins/src/site/update-effects.ts`
- `.changeset/x4-walf-09g-agent-plugins.md`

### WAL-13a
- `packages/devops/src/deploy/site/deploy-ops/agent-tools.ts`
- `packages/devops/src/deploy/site/deploy-targets/__tests__/registry.test.ts`
- `packages/devops/src/deploy/site/deploy-targets/registry.ts`
- `.changeset/x4-walf-13a-devops.md`
- `packages/devops/src/deploy/site/deploy-ops/__tests__/tool-registrations.test.ts`
- `packages/devops/src/deploy/site/deploy-ops/run-ops.ts`
- `packages/devops/src/deploy/site/deploy-ops/secret-confirm.ts`

### WAL-13b
- `packages/devops/src/deploy/site/publish-credentials/store.ts`

### WAL-13c (partial)
- `packages/devops/src/deploy/site/static-publish/adapter.ts`
- `packages/devops/src/deploy/site/static-publish/verify.ts`

### WAL-13d
- `packages/devops/src/deploy/site/publish-tool-deps.ts`

### WAL-12
- `packages/db/src/site/__tests__/tool-registrations.database-recovery.test.ts`

### WAL-14
- `packages/cms/src/posts/email-template-store.ts`
- `packages/platform/src/mail/email-template-tool-registrations.ts`

### WAL-10
- `packages/integrations/src/credentialed-http/tools/index.ts`
- `.changeset/x4-walf-10-integrations.md`
- `packages/integrations/src/credentialed-http/__tests__/tool-registrations.test.ts`

### Shared package export maps (union by sheet)
- `packages/core/package.json`
- `packages/devops/package.json`
- `packages/core/src/contracts/site/__tests__/vault-context.test.ts`

## Tovu integration contract
- `@jini-ai/core/contracts/site/vault-context#authorizeScopedVaultContext`: bind both API connections and database destination vault contexts; pass the same scope and a null principal/binding. Old destination helper removed without forwarder.
- `@jini-ai/core/contracts/site/public-origin#resolvePublicOrigin`: pass configured value read from the existing env name on each invocation, derived origin and invalidConfiguredOrigin. Plugin callback returns undefined; MCP callback throws its two original ToolInputError messages by reason `url`/`protocol`. Keep callback path and serverId encoding as existing bindings.
- `@jini-ai/cms/fs-files/tool-registrations`: resolvePickedFolder takes only resolveRoots/resolveFsRoots/siteBinding/workspaceId; preparePickedFolderBatch additionally takes resolveFsFilePath. No surface/catalog/reader fabrication required.
- `@jini-ai/agent-plugins/lifecycle/layout#createAgentPluginSiteLayout`: required `{siteDir,rootOverride,diagnostics}`; diagnostics now also supplies rootOverride error. Tovu passes env.TOVU_AGENT_PLUGINS_DIR without reading it in Jini. Existing createAgentPluginLayout unchanged.
- `@jini-ai/agent-plugins/site/update-effects`: mcp is host context + repo/saveServer/optional notifyRosterChanged, not the package's whole provisioning input. provisionServers receives `(mcp,{workspaceId,pluginId,servers,principalId})`; trust/copy remain in the bound host provisioner. Recovery actor remains injected and resolveDeps remains invocation-time.
- `@jini-ai/devops/deploy/site/deploy-ops/run-ops`: `secretFingerprint({value,deps:{parseSiteKeyHex,fingerprintSiteKeyHex}})`; `bindDeployOpsRuntime({runtime,deps,makeCredentialedRequest})` adds the bounded credentials.request to the existing runtime/credential ports. Pass original request deps as `deps`, preserving getters; no early reading of repo/sealer/audit/auth-scheme/client. Runtime's other fields are host bindings. Fingerprint and transport why-comments moved with their statements.
- `@jini-ai/devops/deploy/site/deploy-ops/secret-confirm#secretConfirm`: pass ctx/surfaces/options/permit and deps with approvalToolHandler, notConfirmedResult and exact removeDescription/replaceDescription. The two Tovu descriptions remain exact host bytes. Permission is rechecked after human response and before confirming.
- `@jini-ai/integrations/credentialed-http/tools#loadCreateCredentialProviders`: named export on existing public tools/index entry. Pass original routeDeps, keeping optional hosting + required source catalog callbacks. Host split tool-registrations.copy.ts still required.
- `@jini-ai/platform/mail/email-template-tool-registrations#EmailTemplateStorePort`: structural public port; CMS store now declares its own structural mail record/session/store shapes without importing platform.
- db recovery lookup-adapters, migrate-forward-hooks, reconcile-interrupted-migration, disclosure and deep-link are already covered by `./recovery/*` in BOTH exports and jini.entries. No missing-entry change required; no redundant exact exports added.
- WMZ17 remains a host prerequisite for publish credential binding. X4-02/09 and hot shared-file ordering remain coordinator prerequisites. No package intake performed.

## Mutation ledger additions / retained pins
- drop-principal-null-check: delete context.principalId condition in authorizeScopedVaultContext; principal-scoped test must reject.
- picked-folder-escapes-root: admit parent/absolute batch targets before target resolution; new assertion requires refusal and zero target-resolver calls. Absolute picked FOLDER roots remain valid/required by existing requirePickedFolder; the traversal pin concerns files under that root, not a behavioral ban on absolute picked folders.
- create-provider-catalog-drop-fallback: remove hosting-catalog fallback; new test must still return source providers after hosting throws, and [] when source enrichment throws.
- execute-unconfirmed-restore-plan: execute despite the declined human handler; existing no-click/refusal cases assert no confirm/execute. restore-point-outside-operation-lock: invoke gatewayExecute before lock; strengthened fixture asserts held lock. confirm-with-agent-principal: confirmation kind must stay user and execute principal agent, with the minted token.
- forward-unbounded-response: remove maxResponseBytes forwarding or clipping flag; new request pin asserts ceiling, signal and bodyTruncated.
- confirm-before-permit: confirm without awaiting the post-card permit; new denied-permit test requires rejection and order card→custom-credentials.write.
- take-first-duplicate-target: retained registry duplicate-claimant test refuses all; added trusted definition propagation and catalog read-permission blocker pins.
- project-write-without-owner: retained project-scope test refuses before vault access. seal-before-owner-lookup remains host-dependent as noted above.
- access-write-keeps-stale-credential-pointer: existing access-only SQL test prohibits credential columns; strengthened grant audit principal/time checks. The precise mutant's stale-pointer behavior must also be exercised in Tovu's live credential-pointer fixtures; no credential behavior changed here.
- authz-sql-drop-workspace-predicate: remove workspace filter in grants read/delete; cross-workspace same-policy test requires isolation of returned rows and deletion. permission-list-skip-permission-check: existing denial test retains zero repo reads. user-create-schema-exposes-password: new schema pin asserts password absent from properties and required keys.
- layout-accept-dotdot-plugin-id: new exact '..' refusal pin. memory-migrate-sibling-before-lock: migration event callback now asserts held workspace lock, preserving sibling-before-active order. capture-recovery-deps-at-bind: existing zero bind-time reads retained and now actual provision arguments asserted.
- token-refusal-order-swapped remains a specification mismatch; no invented retired-ID parser branch. Existing earlier first-pass characterizations were neither removed nor weakened.

## Review / execution status
PARTIAL, not ready-for-merge. Architecture audit WARNING: first-pass publish-history still contains product peer identity because its neutral return contract is unresolved; WAL-09a absent; six Tovu anchor mismatches remain. No new runtime dependency edges, no theme changes or feature mounts. No tests/builds/installs/typechecks/linters run by explicit dispatch. Runtime, mutation, type and coverage results are UNVERIFIED. No hidden ignore/exclusion/threshold changes or certified-test deletions. Function review of added units: vault authority O(1); public origin O(URL bytes); provider catalog O(providers); transport O(response), host ceiling; fingerprint O(value); secret ceremony O(1), host I/O. New named functions are below 80 lines; no unnamed production helper split introduced. Existing named private deployment splits retained.

Self-validation not run: prohibited by dispatch. Fresh evidence is source/diff inspection only, never a green claim. Test seams: direct vault predicate, injected origin policy, real picked-root preparation, actual SQL adapters, injected transport + approval, real identity schema projection. No counter drop or Tovu MOVE completion claimed without G3.
