# Commit plan (working tree only; coordinator commits)

No numbered design sheets or blob anchors were supplied; groups below follow the dispatched rows. No tests, builds, installs, typechecks, linters or guard were run, per dispatch. No git mutations.

1. Correct descriptor-close characterization spy scope.
   - packages/platform/src/fs/__tests__/guarded-reader.binary.test.ts
   - Existing growth/refusal and shrinkage/early-exit/abort tests spy on a filesystem object copied from the Node adapter, rather than the global node:fs object. appendFileSync/truncateSync themselves close unrelated descriptors; those closes previously inflated the reader's count. Production closes the checked descriptor once. Assertions are unchanged.
   - Mutation: remove `fs.closeSync(fd)` from withGuardedBinaryStream's finally; every close-count assertion becomes red (0 versus 1). Duplicate that close and the operation rejects with EBADF. Tests were inspected before editing production.

2. Declare immutable module catalogs readonly and complete plugin-memory runtime metadata.
   - packages/agent-plugins/package.json; src/site/install-tool.ts and install-upload.ts
   - packages/db/src/site/tool-registrations.ts
   - packages/devops/src/{backup/site/tool-registrations,deploy/site/publish-agent-tools,deploy/site/tool-registrations,source-control/site/tool-registrations}.ts
   - packages/mcp/src/external/tool-registrations.ts
   - packages/platform/src/mail/email-template-tool-registrations.ts
   - packages/user-management/src/{mail/status/delivery-tool-registrations,mail/status/provider-tool-registrations,mail/status/tool-registrations,members/tool-registrations,newsletter/delivery/tool-registrations,newsletter/tool-registrations}.ts
   - All listed Map/Set allocations are static lookup catalogs, not mutable instance state. Explicit ReadonlyMap/ReadonlySet declarations remove mutation methods from their contract; allocation and lookup order are unchanged.
3. Neutralize consumer-specific rationale references and injected remove-label name.
   - packages/agent-plugins/src/react/use-agent-plugins.hooks.ts; src/site/update-effects.ts
   - packages/devops/src/deploy/react/{StaticExportCard,StaticSiteTab}.tsx; react/hooks/use-static-publish.hooks.ts; deploy/site/static-publish/{adapter-export,adapter}.ts; deploy/site/tool-registrations.ts; source-control/site/store.ts
   - packages/integrations/src/react/credentials/OtherCredentialsSection.tsx: host supplies REMOVE_FROM_HOST instead of the consumer-specific property.
   - packages/mcp/src/react/external-mcp/hooks/external-mcp-form.rules.ts
   - Why-comments retained, only forbidden consumer references replaced with neutral descriptions.
4. Break the ten reported runtime-cycle paths.
   - Publish schemas moved verbatim to deploy/site/publish-tool-schema.ts; execution imports that leaf.
   - Publish credential validation error moved to store-validation.ts; source-control validation error moved to store.validation.ts. Both validators now import store types with statement-level import type.
   - Publish owner lookup moved verbatim to store-owner.ts (type-only dependency); decryptRecord moved verbatim into store.ts. The store now has only a type import from store-resolution.ts.
   - checkSavedServer moved verbatim into external-mcp-source-actions.ts; actions no longer import runtime hook code.
   - ownerPasskeySite, resolveOwnerPasskeyRouteDeps and answerOwnerPasskeyFailure moved verbatim to passkey-route-deps.ts. Admission imports the route binder only as a type. Existing deferred store/MFA/WebAuthn/site getter order retained.
   - toNewsletterSendPipelineDeps and its why-comment moved verbatim to tool-registrations.deps.ts; write/delivery callers import the leaf.
   - Removed user-trash-adapter.ts's kernel-adapter forwarding export; the existing kernel implementation gets its own public subpath. Its test imports the implementation directly.
5. Remove all 29 located SI-domain crossings.
   - Agent-plugin install errors, update error, host compatibility error, folder ZIP error, update plan, token-map policy, display-name projection, sign-in-list projection, provider-link lookup and export-prop validation moved into neutral src/core leaves. Existing lifecycle/connect aggregate exports point at the moved implementations where those exports already belonged; no old implementation-file forwarding shells were retained.
   - Site install/update imports name the shared leaves; remaining lifecycle references are statement-level import type.
   - Installed-plugin resolver now only type-imports its parser; removed the defaultResolveInstalledAgentPlugin forwarding function and its aggregate value export. Use resolveInstalledAgentPlugin from connect/installed-plugin and supply parseCredentialCards.
   - AutomaticPluginDeps requires createAutomaticAgentPluginUse and readChatAgentPluginState.
   - DatabaseToolDeps requires createDatabaseReadTools and executeMigrateForward.
   - SiteBackupToolDeps.deps requires findReservedPath.
   - ExternalMcpToolDeps requires externalMcpAccessSnapshot, ExternalMcpValidationError, applyExternalMcpAccess, parseArgs, parseAllowedToolNames, parseWriteAllowedToolNames and readExternalMcpToolGrants, supplied from the federation/hosted owner.
   - IdentityToolDeps requires buildIdentityRegistrations, identityDerivedRisk, normalizeUsername, parseIdentityToolInput, createUsernameChangePort and SelfDeleteError. contributeIdentityTools now requires { identityDerivedRisk }.
   - loadBundledLoginProviders requires parseLoginProviders.
6. Inject remaining host copy/identity and fetch; expose moved public implementations.
   - ExternalMcpToolDeps also requires unverifiedAccessMessage({ serverId }), unverifiedConnectionMessage, staleApprovalMessage, oauthUnavailableMessage({ serverId }) and accessErrorCode. The host must supply its original full messages/code; evaluation remains at the original error/description sites, including lazy refusal fallback.
   - ExternalMcpSettingsPanel dependency keys are pickerCollaborators and driftCopy; row and existing fixture callers updated.
   - ExportSiteRouteDeps requires fetch; the existing traced-fetch wrapper invokes that port at request time.
   - PublishHistoryEntry.kind / peer destination kind are host-owned strings. listPublishDestinations and InMemoryPublishHistoryStore require peerKind. Supply the host's existing persisted peer discriminator unchanged; it also supplies the existing destination ID prefix. No ledger rewrite or runtime string substitution was added.
   - Existing fixtures receive the real owner functions; existing assertions retained.

## Host public-path changes
- @jini-ai/agent-plugins/core/folder-zip-error: FolderZipError (previously folder-zip).
- @jini-ai/agent-plugins/core/provider-plugin-link: linkedProviderOf (previously site/provider-plugin-link).
- @jini-ai/agent-plugins/core/export-props: validateAgentPluginExportProps (previously manifest).
- @jini-ai/devops/deploy/site/publish-tool-schema: EXECUTE_STATIC_PUBLISH_SCHEMA.
- @jini-ai/devops/deploy/site/publish-credentials/store-validation: PublishCredentialValidationError.
- @jini-ai/devops/source-control/site/store.validation: SourceControlCredentialValidationError.
- @jini-ai/user-management/admin-http/owner/passkey-route-deps: ownerPasskeySite, resolveOwnerPasskeyRouteDeps, answerOwnerPasskeyFailure.
- @jini-ai/user-management/newsletter/tool-registrations.deps: toNewsletterSendPipelineDeps.
- @jini-ai/user-management/identity/sql/kernel-user-trash-store: bindKernelUserTrashAdapter.
- @jini-ai/mcp/react/external-mcp/hooks/external-mcp-source-actions: checkSavedServer.
- decryptRecord now belongs to the existing publish-credentials/store subpath; ownerOf is internal store-owner.ts.
- The connect/installed-plugin public subpath exports resolveInstalledAgentPlugin; callers must inject parseCredentialCards instead of using the removed default forwarder.

## Test evidence / integrity
- No test suite, test command, mutation run, guard, build, install, typecheck or linter was executed, as explicitly prohibited.
- Binary close-count assertions remain exactly-one. Test filesystem objects are shallow copies so unrelated fixture I/O closes are not included in the reader's descriptor spy.
- Added the explicitly required success outcome to the existing close-count table: growth/refusal + shrinkage/early-exit/abort executions were 4, now 5 including success. No existing case or assertion was deleted, skipped or weakened.
- Named mutation: removing the reader's finally close makes these counts 0 rather than 1; duplicating it rejects with EBADF. Neither mutation was applied or executed.
- All other test edits are imports or fixture wiring for the implementation moves and required injected values.

## Stopped / missing evidence
- Seven SI-resolution rows are unchanged. cloudflare/lib/cms-forms.mjs (six closures) and cloudflare/worker/portable-validation.mjs (one closure) do not exist until packages/agent-plugins/scripts/build-cloudflare.mjs bundles the declared CMS surfaces. Dispatch prohibits builds; adding placeholders or handwritten substitutes would change the copied plugin payload. Coordinator must run the existing build before assessing these seven findings.
- HW3 summary says 24 new, but only 16 detailed HW3 rows were supplied. All 16 located collections were addressed; the eight additional source locations are absent from the dispatch.
- HW8 summary says one new provider URL, but supplies no HW8 finding with a file/literal. No repository-wide search or guard was run to invent the missing location.
- R13 model-fallback freshness rows intentionally untouched.
- No numbered design sheets, blob checks, or additional certified characterization cases were attached. No redesign was inferred for missing prerequisites.

## Diff pruning / deletions
- Removed unrelated type-import conversions in seven files after reviewing the diff; restored the unrelated manifest grammar-test import. Removed unused imports left by moves.
- Deleted only the old implementation paths connect/token-map.ts, lifecycle/install-errors.ts and lifecycle/update-plan.ts after moving their contents; no forwarding shells.
- Removed only the existing defaultResolveInstalledAgentPlugin forwarder and kernel-adapter forwarding export described above. No capabilities or tests were dropped.
- No guard rule, allowlist, baseline, debt file, theme, git metadata or external repository was changed.

## Review disposition
PARTIAL / UNVERIFIED: edits address 76 located non-R13 findings (R8 1, neutrality 19, SI-domain 29, HW3 16, HW4 1, R14 10). This is a source-review mapping, not an executed guard result. Generated artifacts and unspecified summary-only locations remain for the coordinator. Host wiring must be updated with the required ports and unchanged host values before runtime verification.

## Exact final file inventory (groups 1–6 above; coordinator stages logical commits)

### agent-plugins

- packages/agent-plugins/package.json — changed
- packages/agent-plugins/src/__tests__/folder-zip-node.characterization.test.ts — changed
- packages/agent-plugins/src/__tests__/folder-zip.boundaries.test.ts — changed
- packages/agent-plugins/src/__tests__/folder-zip.test.ts — changed
- packages/agent-plugins/src/connect/__tests__/token-map.unit.test.ts — changed
- packages/agent-plugins/src/connect/access-token-tool.ts — changed
- packages/agent-plugins/src/connect/connect-tool.ts — changed
- packages/agent-plugins/src/connect/index.ts — changed
- packages/agent-plugins/src/connect/installed-plugin.ts — changed
- packages/agent-plugins/src/connect/new-site-agent-plugin-tokens.ts — changed
- packages/agent-plugins/src/connect/token-map.ts — deleted after move
- packages/agent-plugins/src/connect/token-sign-in.ts — changed
- packages/agent-plugins/src/core/export-props.ts — created
- packages/agent-plugins/src/core/folder-zip-error.ts — created
- packages/agent-plugins/src/core/host-incompatible-error.ts — created
- packages/agent-plugins/src/core/install-errors.ts — created
- packages/agent-plugins/src/core/plugin-display-name.ts — created
- packages/agent-plugins/src/core/provider-plugin-link.ts — created
- packages/agent-plugins/src/core/token-map.ts — created
- packages/agent-plugins/src/core/token-sign-in-list.ts — created
- packages/agent-plugins/src/core/update-error.ts — created
- packages/agent-plugins/src/core/update-plan.ts — created
- packages/agent-plugins/src/folder-zip-node.ts — changed
- packages/agent-plugins/src/folder-zip.ts — changed
- packages/agent-plugins/src/lifecycle/__tests__/integration/install-from-url.integration.test.ts — changed
- packages/agent-plugins/src/lifecycle/__tests__/integration/install-from-url.real-zip.integration.test.ts — changed
- packages/agent-plugins/src/lifecycle/__tests__/unit/compatibility-update-plan.unit.test.ts — changed
- packages/agent-plugins/src/lifecycle/__tests__/unit/exports.unit.test.ts — changed
- packages/agent-plugins/src/lifecycle/__tests__/unit/install-edges.unit.test.ts — changed
- packages/agent-plugins/src/lifecycle/__tests__/unit/install.unit.test.ts — changed
- packages/agent-plugins/src/lifecycle/__tests__/unit/installed-package-index.unit.test.ts — changed
- packages/agent-plugins/src/lifecycle/__tests__/unit/seed-bundled-edges.unit.test.ts — changed
- packages/agent-plugins/src/lifecycle/__tests__/unit/set-enabled-compatibility.unit.test.ts — changed
- packages/agent-plugins/src/lifecycle/__tests__/unit/update.unit.test.ts — changed
- packages/agent-plugins/src/lifecycle/__tests__/unit/yauzl-archive-reader.real-zip.unit.test.ts — changed
- packages/agent-plugins/src/lifecycle/compatibility.ts — changed
- packages/agent-plugins/src/lifecycle/exports.ts — changed
- packages/agent-plugins/src/lifecycle/index.ts — changed
- packages/agent-plugins/src/lifecycle/install-errors.ts — deleted after move
- packages/agent-plugins/src/lifecycle/install.ts — changed
- packages/agent-plugins/src/lifecycle/installed-package-index.ts — changed
- packages/agent-plugins/src/lifecycle/seed-bundled.ts — changed
- packages/agent-plugins/src/lifecycle/set-enabled.ts — changed
- packages/agent-plugins/src/lifecycle/update-plan.ts — deleted after move
- packages/agent-plugins/src/lifecycle/update-store.ts — changed
- packages/agent-plugins/src/lifecycle/update.ts — changed
- packages/agent-plugins/src/react/use-agent-plugins.hooks.ts — changed
- packages/agent-plugins/src/site/__tests__/install-upload-update.unit.test.ts — changed
- packages/agent-plugins/src/site/__tests__/provider-plugin-link.test.ts — changed
- packages/agent-plugins/src/site/__tests__/uninstall-tool.unit.test.ts — changed
- packages/agent-plugins/src/site/__tests__/y5-automatic-agent-plugins.test.ts — changed
- packages/agent-plugins/src/site/automatic-agent-plugins.ts — changed
- packages/agent-plugins/src/site/customize-tool.ts — changed
- packages/agent-plugins/src/site/exports/diagnostics.ts — changed
- packages/agent-plugins/src/site/install-tool.ts — changed
- packages/agent-plugins/src/site/install-upload.ts — changed
- packages/agent-plugins/src/site/provider-plugin-link.ts — changed
- packages/agent-plugins/src/site/set-enabled.ts — changed
- packages/agent-plugins/src/site/uninstall-tool.ts — changed
- packages/agent-plugins/src/site/update-effects.ts — changed

### db

- packages/db/src/site/__tests__/tool-registrations.database-recovery.test.ts — changed
- packages/db/src/site/tool-registrations.ts — changed

### devops

- packages/devops/package.json — changed
- packages/devops/src/backup/site/__tests__/backup-service.test.ts — changed
- packages/devops/src/backup/site/backup-service.plan.ts — changed
- packages/devops/src/backup/site/backup-service.ts — changed
- packages/devops/src/backup/site/tool-registrations.ts — changed
- packages/devops/src/deploy/react/StaticExportCard.tsx — changed
- packages/devops/src/deploy/react/StaticSiteTab.tsx — changed
- packages/devops/src/deploy/react/hooks/use-static-publish.hooks.ts — changed
- packages/devops/src/deploy/site/publish-agent-tools.ts — changed
- packages/devops/src/deploy/site/publish-credentials/store-owner.ts — created
- packages/devops/src/deploy/site/publish-credentials/store-resolution.ts — changed
- packages/devops/src/deploy/site/publish-credentials/store-validation.ts — changed
- packages/devops/src/deploy/site/publish-credentials/store.ts — changed
- packages/devops/src/deploy/site/publish-tool-credential.ts — changed
- packages/devops/src/deploy/site/publish-tool-execution.ts — changed
- packages/devops/src/deploy/site/publish-tool-schema.ts — created
- packages/devops/src/deploy/site/static-publish/__tests__/publish-history.unit.test.ts — changed
- packages/devops/src/deploy/site/static-publish/__tests__/publish-run.unit.test.ts — changed
- packages/devops/src/deploy/site/static-publish/__tests__/publish-verification-basis.unit.test.ts — changed
- packages/devops/src/deploy/site/static-publish/adapter-export.ts — changed
- packages/devops/src/deploy/site/static-publish/adapter.ts — changed
- packages/devops/src/deploy/site/static-publish/publish-history.ts — changed
- packages/devops/src/deploy/site/tool-registrations.ts — changed
- packages/devops/src/source-control/site/store.ts — changed
- packages/devops/src/source-control/site/store.validation.ts — changed
- packages/devops/src/source-control/site/tool-registrations.ts — changed
- packages/devops/src/static-export/site/__tests__/site-exporter.bindings.test.ts — changed
- packages/devops/src/static-export/site/__tests__/site-exporter.test.ts — changed
- packages/devops/src/static-export/site/site-exporter.ts — changed

### integrations

- packages/integrations/src/react/credentials/OtherCredentialsSection.tsx — changed

### mcp

- packages/mcp/package.json — changed
- packages/mcp/src/external/__tests__/tool-registrations.test.ts — changed
- packages/mcp/src/external/access-review.ts — changed
- packages/mcp/src/external/tool-registrations.ts — changed
- packages/mcp/src/react/external-mcp/ExternalMcpSettingsPanel.tsx — changed
- packages/mcp/src/react/external-mcp/ExternalMcpSourceRow.tsx — changed
- packages/mcp/src/react/external-mcp/__tests__/y5-external-mcp.test.tsx — changed
- packages/mcp/src/react/external-mcp/hooks/external-mcp-form.rules.ts — changed
- packages/mcp/src/react/external-mcp/hooks/external-mcp-source-actions.ts — changed
- packages/mcp/src/react/external-mcp/hooks/use-external-mcp.hooks.ts — changed

### platform

- packages/platform/src/fs/__tests__/guarded-reader.binary.test.ts — changed
- packages/platform/src/mail/email-template-tool-registrations.ts — changed

### user-management

- packages/user-management/package.json — changed
- packages/user-management/src/admin-http/owner/__tests__/owner-passkey-routes.unit.test.ts — changed
- packages/user-management/src/admin-http/owner/__tests__/y5-passkey-admission.test.ts — changed
- packages/user-management/src/admin-http/owner/passkey-admission.ts — changed
- packages/user-management/src/admin-http/owner/passkey-route-deps.ts — created
- packages/user-management/src/admin-http/owner/passkey-routes.ts — changed
- packages/user-management/src/identity/__tests__/tool-registrations.identity-authorization.test.ts — changed
- packages/user-management/src/identity/sql/__tests__/kernel-user-trash-store.test.ts — changed
- packages/user-management/src/identity/sql/user-trash-adapter.ts — changed
- packages/user-management/src/identity/tool-registrations.ts — changed
- packages/user-management/src/mail/status/delivery-tool-registrations.ts — changed
- packages/user-management/src/mail/status/provider-tool-registrations.ts — changed
- packages/user-management/src/mail/status/tool-registrations.ts — changed
- packages/user-management/src/member-login/__tests__/bundled-providers.test.ts — changed
- packages/user-management/src/member-login/providers.ts — changed
- packages/user-management/src/members/tool-registrations.ts — changed
- packages/user-management/src/newsletter/delivery/tool-registrations.ts — changed
- packages/user-management/src/newsletter/tool-registrations.deps.ts — created
- packages/user-management/src/newsletter/tool-registrations.ts — changed
- packages/user-management/src/newsletter/tool-registrations.write.ts — changed

COMMIT-PLAN.md is coordinator scratch and must not be committed.
