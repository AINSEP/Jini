# x4-wal — uncommitted coordinator handoff

Jini-only dispatch. No subagents and no git writes. No tests, builds, installs, typechecks or linters were run. All results below are implementation/source-review status, not green-check or mutation-run claims. Keep this file out of commits.

## Source basis

- Actual starting HEAD: `0ba3fd793eb87315504e1b6137ff7a9bf723d596`.
- All 53 named Tovu MOVE blob prefixes match pinned `a96020e1e7e5126ca6d086753d6e03b3087200fb`, available through the Tovu clone. Its working tree is newer; final source reads use that pinned commit. `origin/codex/m24-tip` was unavailable there.
- Compared with cited Jini code tip `1838a01ed`, inspected slice areas differ only in bundled-id-upgrade outside this slice. No unexplained slice drift was adopted.
- The supplied dispatch overrides absent local AI-Dev-Shop bootstrap and default programmer checks. Programmer instructions were loaded from `/Users/la/Programming/Tovu/AI-Dev-Shop/agents/programmer/skills.md`.

## Ordered logical commits

The coordinator stages/commits each logical unit below in sheet order. Shared package.json additions must be staged per sheet. WAL-03/04 are reuse characterizations, with no runtime changeset. The implementation/relevant characterizations were written before the corresponding moves; the additional deployment credential-card golden was added during final review after the move. Identity and project-scope characterizations were strengthened during review to exercise the real guards. No tests were deleted or assertions softened.

### WAL-01

Jini contribution and sealed issuing-context owners added.

- replace-original-issuing-context: bypass the existing-context refusal; the case requires the account-changed identity and the original sealed context.
- skip-plugin-namespace-check: skip checkApiConnectionClientNamespace; the shape-valid foreign namespace must then escape the asserted refusal.

Files:

- `.changeset/x4-wal-01-integrations.md`
- `packages/integrations/package.json`
- `packages/integrations/src/api-connections/__tests__/contribution.unit.test.ts`
- `packages/integrations/src/api-connections/__tests__/shared-owner.integration.test.ts`
- `packages/integrations/src/api-connections/contribution.ts`
- `packages/integrations/src/api-connections/shared-owner.ts`

### WAL-02

Catalog/schema builder and FS registrations added. Host owns roots, readers, approval and the existing exchange.

- drop-list-truncated: omit truncated from the listing projection.
- write-before-approval: call the prepared writer before the approval run callback.

Files:

- `.changeset/x4-wal-02-cms.md`
- `packages/cms/package.json`
- `packages/cms/src/fs-files/__tests__/tool-registrations.test.ts`
- `packages/cms/src/fs-files/agent-tools.ts`
- `packages/cms/src/fs-files/tool-registrations.ts`

### WAL-03

Existing CMS destination/copy APIs reused; no runtime change or changeset.

- persist-first-before-second-preflight: persist document one before validating document two; the existing package preflight case requires zero saves. Added same-batch collision response and exact approval pin.

Files:

- `packages/cms/src/asset-transfer/__tests__/copy-tool.test.ts`

### WAL-04

Existing CMS transform API reused; no runtime change or changeset.

- inspect-calls-destination-writer: enter the destination writer on an inspection-only request; the existing inspect case requires zero destination calls. Added real prepared-writer success and named partial-failure pin.

Files:

- `packages/cms/src/media/site-transform/__tests__/tool.test.ts`

### WAL-05

Resource discovery, per-resource authorization and duplication contributor added.

- authorize-after-resource-duplicate: move authorization after the callback; the denied case requires callback count zero.

Files:

- `packages/cms/package.json (shared; stage only this sheet’s additions)`
- `.changeset/x4-wal-05-cms.md`
- `packages/cms/src/content-duplication/__tests__/tool-registrations.test.ts`
- `packages/cms/src/content-duplication/tool-registrations.ts`

### WAL-06

Content-type publish contributor added with seeded-key, permission and schema-command bindings.

- skip-seeded-check-at-apply: skip the write-time seeded refusal; the test requires apply rejection and unchanged storage.

Files:

- `packages/cms/package.json (shared; stage only this sheet’s additions)`
- `.changeset/x4-wal-06-cms.md`
- `packages/cms/src/content-types/site/__tests__/publish-content.test.ts`
- `packages/cms/src/content-types/site/publish-content.ts`

### WAL-07

STOP — source/spec semantic mismatch; no Jini contributor or new test.

- Pinned source blob 3b89a0c26a unconditionally calls prepareTermSync({ wanted: state.termIds }). Existing packages/cms/src/taxonomy/site/publish-term-ids.ts:103 normalizes non-arrays to []. Absent terms already apply as empty; apply-absent-terms-as-empty is baseline behavior. A red characterization distinguishing absence from explicit empty requires a behavior decision from Opus.

### WAL-08

Owner-start file protection/retry and form publish contributors added.

- mark-complete-after-stamp-failure: mark completion despite an attachment-protection-failed warning; the next-owner retry and absent-marker assertions fail.
- take-notify-from-source: use state.notify instead of existing.notify; destination-recipient preservation fails.

Files:

- `packages/cms/package.json (shared; stage only this sheet’s additions)`
- `.changeset/x4-wal-08-cms.md`
- `packages/cms/src/forms/site/__tests__/form-file-purge.test.ts`
- `packages/cms/src/forms/site/__tests__/publish-content.test.ts`
- `packages/cms/src/forms/site/protect-existing-files.ts`
- `packages/cms/src/forms/site/publish-content.ts`

### WAL-09

PARTIAL — eleven MOVE paths handled; automatic runs stopped. No replacement-attempt test claimed.

- STOP automatic-agent-plugins.ts: pinned createAutomaticPluginRuns spans lines 197–280 (84 lines), exceeding the hard 80-line limit. No named split is authorized. Needs Opus before moving this file; reuse-retired-attempt-receipt remains unimplemented.
- catalog-inactive-before-digest: admit inactive refusal verdicts before the trusted digest gate; the one-package/one-read assertion fails.
- publish-before-off-record: move publication before the initial OFF record; the exact [off, publish] effect order fails.
- capture-recovery-deps-at-bind: resolve recovery deps while binding; reads=0 at bind fails.
- Additional listed cases: workspace isolation and exact invalid-ID text; sibling locks finish before active ownership; rejected update preserves the previous installed revision.

Files:

- `.changeset/x4-wal-09-agent-plugins.md`
- `packages/agent-plugins/package.json`
- `packages/agent-plugins/src/connect/connect-tool.ts`
- `packages/agent-plugins/src/connect/new-site-agent-plugin-tokens.ts`
- `packages/agent-plugins/src/lifecycle/layout.ts`
- `packages/agent-plugins/src/site/__tests__/install-upload-update.unit.test.ts`
- `packages/agent-plugins/src/site/__tests__/memory.integration.test.ts`
- `packages/agent-plugins/src/site/__tests__/site-layout.test.ts`
- `packages/agent-plugins/src/site/__tests__/update-effects.unit.test.ts`
- `packages/agent-plugins/src/site/exports/__tests__/plugin-embed-source.test.ts`
- `packages/agent-plugins/src/site/exports/diagnostics.ts`
- `packages/agent-plugins/src/site/exports/runtime.ts`
- `packages/agent-plugins/src/site/exports/source.ts`
- `packages/agent-plugins/src/site/install-tool.ts`
- `packages/agent-plugins/src/site/install-upload.ts`
- `packages/agent-plugins/src/site/memory.ts`
- `packages/agent-plugins/src/site/set-enabled.ts`
- `packages/agent-plugins/src/site/update-effects.ts`

### WAL-10

HOST-ONLY — no Jini code, export, changeset or test addition. Existing credential catalog/request/save owners inspected.


### WAL-11

HOST-ONLY — no Jini code, export, changeset or test addition. Existing sealed database destination owner inspected.


### WAL-12

Database migration plan/approval orchestration and contributor added. Restore-guidance remains unwired and restore-point creation stays single-registered.

- confirm-with-agent-principal: attribute gatewayConfirm to ctx.principal.id instead of confirmer.id. Cases cover no click, unavailable restore-point plan, and plan/confirm/lock/restore-point/execute/unlock order.

Files:

- `.changeset/x4-wal-12-db.md`
- `packages/db/package.json`
- `packages/db/src/site/__tests__/tool-registrations.database-recovery.test.ts`
- `packages/db/src/site/tool-registrations.ts`

### WAL-13

Deployment registries, credential storage/resolution, static publish stages and both registrars added using the named private splits. No equivalents of the two host indexes.

- take-first-duplicate-target: retain the first duplicate instead of dropping all claimants.
- read-registry-at-bind: read compatibility source/registry while binding; the immediate empty-read assertion fails.
- fallback-after-explicit-choice-refusal: remove the chosen-id refusal return before environment resolution; the explicit-choice test reaches its forbidden registry read.
- skip-reviewed-credential-recheck: bypass credentialChangedSinceReview in publishStaticSiteSteps; the changed-credential test must reach its forbidden export/publication callback.
- forward-narrow-route-deps: forward the ExportEngine options wholesale to exportSiteBound; the exact three-key projection fails.
- Additional listed pins: owner-card-only shared replacement, person confirmation before agent execution, ineligible history exclusion, failed-run history exclusion and exact credential form projection.

Files:

- `.changeset/x4-wal-13-devops.md`
- `packages/devops/package.json`
- `packages/devops/src/deploy/site/__tests__/publish-credential-card.unit.test.ts`
- `packages/devops/src/deploy/site/__tests__/tool-registrations.trigger-export.unit.test.ts`
- `packages/devops/src/deploy/site/deploy-ops/__tests__/registry.test.ts`
- `packages/devops/src/deploy/site/deploy-ops/agent-tools.ts`
- `packages/devops/src/deploy/site/deploy-ops/registry.ts`
- `packages/devops/src/deploy/site/deploy-targets/__tests__/registry.test.ts`
- `packages/devops/src/deploy/site/deploy-targets/registry.ts`
- `packages/devops/src/deploy/site/publish-agent-tools.ts`
- `packages/devops/src/deploy/site/publish-credentials/__tests__/compatibility-port.unit.test.ts`
- `packages/devops/src/deploy/site/publish-credentials/__tests__/project-scope.unit.test.ts`
- `packages/devops/src/deploy/site/publish-credentials/compatibility-port.ts`
- `packages/devops/src/deploy/site/publish-credentials/store-resolution.ts`
- `packages/devops/src/deploy/site/publish-credentials/store-validation.ts`
- `packages/devops/src/deploy/site/publish-credentials/store.ts`
- `packages/devops/src/deploy/site/publish-tool-capabilities.ts`
- `packages/devops/src/deploy/site/publish-tool-credential.ts`
- `packages/devops/src/deploy/site/publish-tool-deps.ts`
- `packages/devops/src/deploy/site/publish-tool-execution.ts`
- `packages/devops/src/deploy/site/static-publish/__tests__/adapter.unit.test.ts`
- `packages/devops/src/deploy/site/static-publish/__tests__/credentials.unit.test.ts`
- `packages/devops/src/deploy/site/static-publish/__tests__/domain-publish-tool.unit.test.ts`
- `packages/devops/src/deploy/site/static-publish/__tests__/publish-history.unit.test.ts`
- `packages/devops/src/deploy/site/static-publish/__tests__/publish-run.unit.test.ts`
- `packages/devops/src/deploy/site/static-publish/adapter-export.ts`
- `packages/devops/src/deploy/site/static-publish/adapter-plan.ts`
- `packages/devops/src/deploy/site/static-publish/adapter.ts`
- `packages/devops/src/deploy/site/static-publish/credentials.ts`
- `packages/devops/src/deploy/site/static-publish/domain-publish-tool.ts`
- `packages/devops/src/deploy/site/static-publish/inspection.ts`
- `packages/devops/src/deploy/site/static-publish/publish-history.ts`
- `packages/devops/src/deploy/site/static-publish/publish-run.ts`
- `packages/devops/src/deploy/site/static-publish/verify.ts`
- `packages/devops/src/deploy/site/tool-registrations.ts`

### WAL-14

CMS email-template store and platform mail registrations added.

- convert-outside-create-transaction: perform HTML conversion after committing the draft; the real SQLite rollback assertion fails.
- ignore-template-expected-version: skip the shared edit operation’s stale-version check before HTML write; the rejection and zero-writer assertions fail.

Files:

- `packages/cms/package.json (shared; stage only this sheet’s additions)`
- `.changeset/x4-wal-14-cms.md`
- `.changeset/x4-wal-14-platform.md`
- `packages/cms/src/posts/__tests__/email-template-store.sql.test.ts`
- `packages/cms/src/posts/email-template-store.ts`
- `packages/platform/package.json`
- `packages/platform/src/mail/__tests__/email-template-tool-registrations.test.ts`
- `packages/platform/src/mail/email-template-tool-registrations.ts`

### WAL-15

External MCP registrar with private save-input/access-review splits added. Existing hosted SQL owner reused without modifying repository behavior.

- update-without-expected-version: remove the editor UPDATE version predicate; the strengthened SQL WHERE assertion fails. Existing SQL access-only case pins untouched credential columns.
- skip-post-card-basis-read: bypass currentMcpSaveRecord after submission; the changed-card case reaches its forbidden writer and fails the fresh-approval/zero-write assertions.

Files:

- `.changeset/x4-wal-15-mcp.md`
- `packages/mcp/package.json`
- `packages/mcp/src/external/__tests__/tool-registrations.test.ts`
- `packages/mcp/src/external/access-review.ts`
- `packages/mcp/src/external/save-input.ts`
- `packages/mcp/src/external/tool-registrations.ts`
- `packages/mcp/src/federation/hosted/__tests__/external-mcp-repo.sql.test.ts`

### WAL-16

HOST-ONLY — no Jini code, export, changeset or test addition. Receiver-key persisted label/scope stays host-owned.


### WAL-17

Identity registrar added above existing server registrations; SQL, permission-list and purge owners reused.

- overwrite-first-session-revocation: replace the stored-revocation-preserving expression; existing identity/__tests__/sql-identity.test.ts pins the first revocation.
- commit-purge-before-outbox: move the outbox append outside the purge transaction; existing user-purge.transaction.test.ts pins rollback.
- skip-owner-check-after-human-approval: skip the fresh assertCallerHasAnyPermission call in the real service’s inAuthorizedIdentityTransaction; the new disabled-caller-after-card test must delete its role and fail. The test uses real seeded memory repositories, not a mocked authorization handler.
- Existing permission-list-tool.test.ts pins permission-first reads. Host must preserve purge buildEvent’s present reason key via { reason: options?.reason }; Jini’s existing absent-reason contract remains unchanged.

Files:

- `.changeset/x4-wal-17-user-management.md`
- `packages/user-management/package.json`
- `packages/user-management/src/identity/__tests__/tool-registrations.identity-authorization.test.ts`
- `packages/user-management/src/identity/tool-registrations.ts`

## New public subpaths

Each listed subpath has exports and jini.entries metadata. Internal split files are not public compatibility entries. Existing connect/lifecycle entries expose their additions through the existing owners.

`@jini-ai/integrations`:

- `api-connections/shared-owner` — universal
- `api-connections/contribution` — universal

`@jini-ai/cms`:

- `posts/email-template-store` — node
- `forms/site/publish-content` — universal
- `forms/site/protect-existing-files` — universal
- `content-types/site/publish-content` — universal
- `content-duplication/tool-registrations` — universal
- `fs-files/tool-registrations` — node
- `fs-files/agent-tools` — node

`@jini-ai/agent-plugins`:

- `connect/new-site-agent-plugin-tokens` — node
- `site/set-enabled` — node
- `site/memory` — node
- `site/install-upload` — node
- `site/install-tool` — node
- `site/exports/runtime` — universal
- `site/update-effects` — node
- `site/exports/source` — universal
- `site/exports/diagnostics` — universal

`@jini-ai/db`:

- `site/tool-registrations` — node

`@jini-ai/devops`:

- `deploy/site/publish-credentials/compatibility-port` — universal
- `deploy/site/deploy-targets/registry` — node
- `deploy/site/deploy-ops/registry` — node
- `deploy/site/deploy-ops/agent-tools` — universal
- `deploy/site/publish-credentials/store` — universal
- `deploy/site/publish-credentials/store-resolution` — universal
- `deploy/site/static-publish/credentials` — universal
- `deploy/site/static-publish/verify` — node
- `deploy/site/static-publish/publish-history` — universal
- `deploy/site/static-publish/adapter` — node
- `deploy/site/static-publish/inspection` — node
- `deploy/site/static-publish/publish-run` — node
- `deploy/site/static-publish/domain-publish-tool` — node
- `deploy/site/publish-tool-deps` — universal
- `deploy/site/publish-agent-tools` — node
- `deploy/site/tool-registrations` — node

`@jini-ai/platform`:

- `mail/email-template-tool-registrations` — node

`@jini-ai/mcp`:

- `external/tool-registrations` — node

`@jini-ai/user-management`:

- `identity/tool-registrations` — node

## Tovu half and coordinator work

- No Tovu file was changed or deleted. Run the exact scanner inbound-edge ledger, open/repoint every production/type/dynamic/mock/test/barrel consumer, and record anchored keeps before deleting host forks. No host cutover or complete MOVE-file retirement is claimed here.
- Bind the new required host policy/effect ports, preserving existing approval/exchange/activation owners and dark mounts. Pass one existing composition-scoped publish job store through staticPublishPorts; there is no package singleton. Supply the host env snapshot, public headers, form rewrite, redaction, diagnostics and bound kit at the former call points.
- For trusted deploy registries, the injected loader consumes the package’s definition spec (and ops read/import refusal options); the host binds its existing defineExecutablePluginContribution/lifecycle loader. Inactive data discovery remains a separate path.
- Bind credentialStorePorts to current vault/scope/token/metadata policies; bind credentialSourceStorePorts to those store APIs. The source’s positional firstExportFailure(report) port needs the host’s existing adapter to canonical firstExportFailure({ report }). No exported host-only index is recreated.
- WAL-03 own-key differences remain published behavior: Jini omits non-theme themeId/batch when undefined. Scoped inspected handlers/tests consume values; the complete live-host ledger is still required before cutover. WAL-04 uses the prepared writer whose successful result omits failed.
- Preserve the host’s project context digest identity, label policies, strict configured-origin OAuth resolver, namespace/legacy identity bindings, receiver labels and purge reason own key. Generic types/helpers should import their Jini owners directly.
- Package intake is intentionally not performed. Coordinator must handle any dependency/peer admission and lockfile/API baselines required by the newly referenced existing type owners, then run the named suites and one-at-a-time mutations. No migration, approval ownership, theme content or availability flag was changed.
- Remaining Jini work: WAL-07 and WAL-09 automatic runs need Opus decisions described above. No other Jini sheet is deliberately left pending. All runtime/typecheck outcomes remain unverified under the dispatch rule.

## Final diff cleanup / deletions

No tracked source files were deleted. Removed from the new diff: duplicate parse-forwarding wrappers; the extra inline PluginEmbedDiagnostic type in favor of its core owner; five memory pass-through wrappers (pluginMemory, migrateAgentPluginLayout, withAgentPluginWorkspaceLock, assertOwnedPluginPath, withAgentPluginStateLock); the unused PublishConfirmationContext; unused imports and unused verification-deps fields; host catalog initialization/default exchange construction and host filesystem/ZIP/vendor selection from moved bodies; incidental Unicode escaping in package metadata. Existing why-comments move with their decisions, with host names/path references translated only where needed for neutrality. No two host barrel equivalents were created.
