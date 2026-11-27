# Round 2 w3b-arch — Jini working-tree handoff

No git mutations, subagents, tests, builds, installs, typechecks or linters. Tests/mutations below are authored and UNRUN; no RED/GREEN, coverage or runtime claim. Programmer bootstrap read from /Users/la/Programming/Tovu/AI-Dev-Shop/agents/programmer/skills.md. Dispatch overrides skill approval/testing/refactoring steps. The working tree was initially clean.

## Ordered design commits implemented (verification and API generation pending)

The coordinator commits these units. Changesets follow the owner X5 fixed-group minor convention; the accepted agent-plugins major is retained. Existing patch entries remain patches. Baselines were not hand-edited or regenerated because the dispatch prohibits build/generation/typecheck workflows.

### 13. R01.ADMIN.J — implemented, UNRUN

Tests first: `email form spacing and provider loading paint survive the selector cutover`; `a drag changes the dropzone outline without changing its accessible name`; dashboard collapsed/error CSS pairing. CSS text is read with readFileSync; no computed-style claim. Mutation M-admin-markup-with-old-css leaves an old email/drag selector in CSS and loses the emitted-class witness. IDs, handles, generic dialog classes, animation name, reduced motion and status classes are preserved. The host-shaped pending dialog is fixture markup: its real renderer belongs to Tovu sheet 14.

Files:

- `.changeset/r01-admin-owned-selectors.md`
- `packages/admin/src/screens/dashboard/Dashboard.tsx`
- `packages/admin/src/screens/dashboard/__tests__/Dashboard.unit.test.tsx`
- `packages/admin/src/screens/dashboard/dashboard.css`
- `packages/admin/src/screens/email/EmailActivityTab.tsx`
- `packages/admin/src/screens/email/EmailOverviewTab.tsx`
- `packages/admin/src/screens/email/EmailParts.tsx`
- `packages/admin/src/screens/email/EmailSenderTab.tsx`
- `packages/admin/src/screens/email/EmailTemplatesTab.tsx`
- `packages/admin/src/screens/email/__tests__/EmailParts.unit.test.tsx`
- `packages/admin/src/screens/email/email.css`
- `packages/admin/src/screens/plugins/provider-settings-dialog.css`
- `packages/admin/src/shell/components/InstallTabCard/InstallTabCard.tsx`
- `packages/admin/src/shell/components/InstallTabCard/__tests__/InstallTabCard.unit.test.tsx`
- `packages/admin/src/shell/components/InstallTabCard/install-tab-card.css`

### 15. R01.UI-WIDGETS.J — implemented, UNRUN

Tests first: `a keyboard-opened Select paints its portalled option panel`; `InfoTip retains the below-placement marker and keyboard focus`; `SeeMore expands only its own text`; `a selected UI TabBar item retains its count and underline`. Mutation M-ui-tab-markup-with-old-active-selector loses the exact aria-selected CSS rule witness. Preserves shared state classes, CSS custom properties, UI Kit prefixes and native portal ownership. The settings-dialog.css changes belong to commit 16.

Files:

- `.changeset/r01-ui-widget-selectors.md`
- `packages/admin/src/shell/components/AssistantDock/DockHeaderTip.tsx`
- `packages/admin/src/shell/hooks/__tests__/use-list-table-cell-labels.unit.test.tsx`
- `packages/admin/src/shell/hooks/use-list-table-cell-labels.hooks.ts`
- `packages/chat/src/react/features/chat-pane/components/RuntimeDropUp.tsx`
- `packages/chat/src/react/styles/chat-settings.css`
- `packages/ui/src/features/admin-widgets/__tests__/InfoTip.unit.test.tsx`
- `packages/ui/src/features/admin-widgets/__tests__/SeeMore.unit.test.tsx`
- `packages/ui/src/features/admin-widgets/__tests__/Select.portal.unit.test.tsx`
- `packages/ui/src/features/admin-widgets/__tests__/Select.unit.test.tsx`
- `packages/ui/src/features/admin-widgets/components/InfoTip.rules.ts`
- `packages/ui/src/features/admin-widgets/components/InfoTip.tsx`
- `packages/ui/src/features/admin-widgets/components/SeeMore/SeeMore.tsx`
- `packages/ui/src/features/admin-widgets/components/Select/Select.tsx`
- `packages/ui/src/features/tab-strip/__tests__/admin/TabBar.unit.test.tsx`
- `packages/ui/src/features/tab-strip/react/components/TabBar.tsx`
- `packages/ui/src/features/tab-strip/react/components/__tests__/TabBar.characterization.unit.test.tsx`
- `packages/ui/src/styles/admin.css`
- `packages/ui/src/theme/__tests__/see-more-css.unit.test.ts`
- `packages/ui/src/theme/__tests__/tab-count-css.unit.test.ts`

### 16. R01.UI-FEATURES.J — implemented, UNRUN

Tests first: drawer/status/Escape, empty external tools, expanded memory, expanded source-config and connector toolbar CSS/interaction cases. The toolbar family was restored to its original tokens while its paired witness was added, then cut over. Mutations M-connector-status-styles-old-class and M-ui-feature-utility-renamed target the status selector and preserved hint/ghost utilities. The revised rows 1–4 have no generated Tailwind utility literal to rename. Only CSS/literal-emitter intersections of named families were prefixed; no remaining-UI census expansion. Status/size/state suffixes, data attributes and existing prefixes stay unchanged.

Files:

- `.changeset/r01-ui-feature-selectors.md`
- `packages/ui/src/features/connectors/ConnectorsBrowser.tsx`
- `packages/ui/src/features/connectors/__tests__/components/ConnectorCard.test.tsx`
- `packages/ui/src/features/connectors/__tests__/components/ConnectorDetailDrawer.test.tsx`
- `packages/ui/src/features/connectors/__tests__/components/ConnectorLogo.test.tsx`
- `packages/ui/src/features/connectors/__tests__/components/ConnectorSearchBar.test.tsx`
- `packages/ui/src/features/connectors/components/ConnectorCard.tsx`
- `packages/ui/src/features/connectors/components/ConnectorDetailDrawer.tsx`
- `packages/ui/src/features/connectors/components/ConnectorGrid.tsx`
- `packages/ui/src/features/connectors/components/ConnectorLogo.tsx`
- `packages/ui/src/features/connectors/components/ConnectorSearchBar.tsx`
- `packages/ui/src/features/connectors/components/ProviderTabBar.tsx`
- `packages/ui/src/features/external-mcp/react/components/ExternalMcpTab.tsx`
- `packages/ui/src/features/external-mcp/react/components/__tests__/ExternalMcpTab.actions.test.tsx`
- `packages/ui/src/features/external-mcp/react/components/__tests__/ExternalMcpTab.characterization.unit.test.tsx`
- `packages/ui/src/features/memory/__tests__/react/components/MemoryConnectedPanel.test.tsx`
- `packages/ui/src/features/memory/__tests__/react/components/MemorySettingsPanel.test.tsx`
- `packages/ui/src/features/memory/react/components/MemoryConnectedPanel.tsx`
- `packages/ui/src/features/memory/react/components/MemoryHooksPanel.tsx`
- `packages/ui/src/features/memory/react/components/MemoryList.tsx`
- `packages/ui/src/features/memory/react/components/MemorySettingsPanel.tsx`
- `packages/ui/src/features/memory/react/components/MemorySuggestionPanel.tsx`
- `packages/ui/src/features/settings/dialog/styles/settings-dialog.css`
- `packages/ui/src/features/skills/react/components/SkillRow.tsx`
- `packages/ui/src/features/source-config-list/__tests__/SourceConfigItemCard.test.tsx`
- `packages/ui/src/features/source-config-list/react/components/SourceConfigAddForm.tsx`
- `packages/ui/src/features/source-config-list/react/components/SourceConfigField.tsx`
- `packages/ui/src/features/source-config-list/react/components/SourceConfigItemCard.tsx`
- `packages/ui/src/features/source-config-list/react/components/SourceConfigListView.tsx`

### 20. R01.DOMAIN-PAINT.J — implemented, UNRUN

Tests first: `the host paints payments without changing the planned provider affordances`; `history, success and a failed run use the bound layout roles` in the existing HistoryTab/PublishRunResult suites; source-control shell fixture class assertions. Two hosts supply different markup classes with identical links, labels and result semantics. Mutation M-domain-paint-fixed-fallback restores dash-panel or save-error and fails those witnesses. Payments requires classes and its real/injected hook; private helpers receive the named class subset. SourceControl uses exactly six required roles.

Files:

- `.changeset/r01-domain-paint-bindings.md`
- `packages/commerce/src/react/Payments.tsx`
- `packages/commerce/src/react/__tests__/Payments.boundaries.unit.test.tsx`
- `packages/commerce/src/react/__tests__/Payments.hooks.unit.test.tsx`
- `packages/commerce/src/react/__tests__/Payments.locale.unit.test.tsx`
- `packages/commerce/src/react/__tests__/Payments.unit.test.tsx`
- `packages/commerce/src/react/index.ts`
- `packages/devops/src/deploy/react/HistoryTab.tsx`
- `packages/devops/src/deploy/react/PublishRunResult.tsx`
- `packages/devops/src/deploy/react/__tests__/HistoryTab.test.tsx`
- `packages/devops/src/deploy/react/__tests__/PublishRunResult.test.tsx`
- `packages/devops/src/source-control/react/SourceControl.tsx`
- `packages/devops/src/source-control/react/__tests__/SourceControl.test.tsx`

### 23. R02.LIVE-COPY.J — implemented, UNRUN

Tests first: `unavailable restore point is still a hard refusal with no attestation override` (renamed existing effect-order test); `enablement explains confirmation and live schema writes without a host document id`; `media-key help uses a neutral example without changing the field`. Mutations M-reinsert-internal-migration-id, M-remove-schema-risk-disclosure and M-provider-help-changes-field pin refusal bytes, live DDL/confirmation disclosure and mediaKeyPrefix. No schema, field/default, secret or permission changed.

Files:

- `.changeset/r02-neutral-runtime-copy.md`
- `packages/agent-plugins/s3-compatible/__tests__/bundled-package.test.mjs`
- `packages/agent-plugins/s3-compatible/jini-deploy-targets.json`
- `packages/cms/src/publish/content/__tests__/execute-import.test.ts`
- `packages/cms/src/publish/content/execute-import.ts`
- `packages/plugins/src/runtime/__tests__/plugin-host-copy.test.ts`
- `packages/plugins/src/runtime/agent-tools.ts`

### 25. R03.IDENTITY.J — implemented, UNRUN

Tests first: `the same installed document is legacy metadata only for its bound host`; `an own canonical key wins even when null or invalid`; `an explicit custom namespace keeps its existing isolation`; bound lifecycle projection with exactly one warning per read. Mutations M-use-legacy-when-canonical-is-invalid and M-projection-drops-identity-policy fail precedence and OAuth/reviewed-read/warning assertions. Includes absent/inherited keys and two distinct bound hosts. Canonical-only tests remain unbound; N-1 positives inject literal fixture descriptors. No canonical writer or installed bytes change. The old warning export is removed; the two named types are exported through current owners.

Files:

- `.changeset/r03-agent-identity-read-policy.md`
- `packages/agent-plugins/src/__tests__/integration-contract.test.ts`
- `packages/agent-plugins/src/core/identity-namespace.ts`
- `packages/agent-plugins/src/index.ts`
- `packages/agent-plugins/src/lifecycle/__tests__/test-support.ts`
- `packages/agent-plugins/src/lifecycle/__tests__/unit/capability-projection-host-contract.unit.test.ts`
- `packages/agent-plugins/src/lifecycle/__tests__/unit/legacy-vocabulary.pins.unit.test.ts`
- `packages/agent-plugins/src/lifecycle/__tests__/unit/manifest-default-namespace.unit.test.ts`
- `packages/agent-plugins/src/lifecycle/__tests__/unit/manifest-namespace.unit.test.ts`
- `packages/agent-plugins/src/lifecycle/__tests__/unit/plugin-identity.unit.test.ts`
- `packages/agent-plugins/src/lifecycle/__tests__/unit/portable-metadata.unit.test.ts`
- `packages/agent-plugins/src/lifecycle/capability-projection.ts`
- `packages/agent-plugins/src/lifecycle/install.ts`
- `packages/agent-plugins/src/lifecycle/installed-package-index.ts`
- `packages/agent-plugins/src/lifecycle/manifest.ts`
- `packages/agent-plugins/src/lifecycle/metadata.ts`
- `packages/agent-plugins/src/lifecycle/persistent-state.ts`
- `packages/agent-plugins/src/lifecycle/ports.ts`
- `packages/agent-plugins/src/manifest.ts`

### 26. R03.PREBOOT.J — implemented, UNRUN

Tests first: `legacy-only manifest produces the same capability decisions before and after boot` in credential-card, host-signal and host-tool suites; `a canonical fork preserves presentation but drops publisher and supersession claims`; `an untrusted successor cannot use the namespace binding`. Mutations M-preboot-skips-legacy-policy, M-fork-uses-alias-as-write-key, M-supersession-skips-trusted-verdict. The host-signals witness exercises disk-backed default resolution and custom-reader priority. createCredentialCardsContribution is added at the declaration owner; credentialCardsContribution remains createCredentialCardsContribution({}). Trust gates, source order, Soon lock and canonical output stay in their existing owners.

Files:

- `.changeset/r03-preboot-identity-policy.md`
- `packages/agent-plugins/src/connect/credential-cards.ts`
- `packages/agent-plugins/src/connect/index.ts`
- `packages/agent-plugins/src/folder-customization.test.ts`
- `packages/agent-plugins/src/folder-zip-node.ts`
- `packages/agent-plugins/src/lifecycle/__tests__/unit/credential-card-metadata.unit.test.ts`
- `packages/agent-plugins/src/lifecycle/__tests__/unit/host-tools-log-safety.unit.test.ts`
- `packages/agent-plugins/src/lifecycle/credential-card-metadata.ts`
- `packages/agent-plugins/src/lifecycle/host-tools/identity.ts`
- `packages/agent-plugins/src/lifecycle/host-tools/ports.ts`
- `packages/agent-plugins/src/lifecycle/host-tools/search-tool.ts`
- `packages/agent-plugins/src/lifecycle/host-tools/skill-tool.ts`
- `packages/agent-plugins/src/site/__tests__/host-signals.test.ts`
- `packages/agent-plugins/src/site/__tests__/supersession.unit.test.ts`
- `packages/agent-plugins/src/site/customize-tool.ts`
- `packages/agent-plugins/src/site/host-signals.ts`
- `packages/agent-plugins/src/site/provider-plugin-link.ts`
- `packages/agent-plugins/src/site/soon-lock.ts`
- `packages/agent-plugins/src/site/supersession.ts`

### 28. R03.FILENAMES.J — implemented, UNRUN

Tests first: canonical malformed-byte precedence and normalized basename candidates; configured legacy install/discovery/retained export/draft round trip; exact-name integrity exclusion; snapshot/browser asset witness. Mutations M-drop-bound-manifest-alias, M-snapshot-exempts-arbitrary-file and M-write-legacy-manifest. Uses neutral legacy.plugin.json fixtures. Canonicalization preserves present Map entries even when T includes undefined. Draft context captures one normalized candidate list and uses it for reads, writes, sealing and hashing. Stale aliases are removed only after canonical atomic write. Existing runtimeBinding spreads already cover discovery/install/source service; importer and loader options carry the same policy. SDK resolver API stays unchanged; old branded constants are removed; only the named neutrality allowlist row is retired.

Files:

- `.changeset/r03-plugin-format-read-options.md`
- `packages/plugins/src/host/__tests__/integration/browser-provider-approval-matrix.integration.test.ts`
- `packages/plugins/src/host/__tests__/unit/install.unit.test.ts`
- `packages/plugins/src/host/__tests__/unit/plugin-format.pins.unit.test.ts`
- `packages/plugins/src/host/__tests__/unit/plugin-format.unit.test.ts`
- `packages/plugins/src/host/__tests__/unit/source-drafts.unit.test.ts`
- `packages/plugins/src/host/node/browser-provider-assets.ts`
- `packages/plugins/src/host/node/discovery.ts`
- `packages/plugins/src/host/node/install.ts`
- `packages/plugins/src/host/node/integrity-command.ts`
- `packages/plugins/src/host/node/loader.ts`
- `packages/plugins/src/host/node/module-snapshot.ts`
- `packages/plugins/src/host/node/package-files.ts`
- `packages/plugins/src/host/node/runtime-activation.ts`
- `packages/plugins/src/host/node/runtime-contracts.ts`
- `packages/plugins/src/host/node/source-drafts.ts`
- `packages/plugins/src/host/plugin-format.ts`
- `packages/plugins/src/host/ports.ts`
- `scripts/source-neutrality-allowlist.json`

### 31. P10-H2.NEW-CHANGE-SET.J — implemented, UNRUN

Tests first: `one command persists one actor on both atomic records` in command/SQL suites; historical read witness; `an envelope preparation hook cannot erase or replace a stamped actor`; before-effects header/event mismatch refusal. Compile witnesses reject ChangeSetRecord as NewChangeSetRecord and as insert's record type. Mutations M-stamp-header-only, M-serialize-prepared-actor and M-infer-legacy-kind pin distinct behavior. SQL history is seeded directly, not cast into insert. Existing atomic rollback, trace-context and legacy-column capability witnesses remain. Original actor/id and envelope identity are captured before preparation; callback receives separate envelope/actor objects. Read types and OutboxPort.enqueue stay broad. No migration or universal outbox cutover.

Files:

- `.changeset/p10-h2-new-change-set-provenance.md`
- `packages/cms/src/change-sets/__tests__/tool-registrations.test.ts`
- `packages/cms/src/core/commands/__tests__/command.test.ts`
- `packages/cms/src/core/commands/command.ts`
- `packages/cms/src/core/commands/repo.memory.ts`
- `packages/cms/src/core/commands/revert.ts`
- `packages/cms/src/forms/__tests__/change-set.fixture.ts`
- `packages/core/src/contracts/events/change-set.ts`
- `packages/core/src/contracts/events/ports.ts`
- `packages/db/src/events/__tests__/change-set.sql.repo.dialects.test.ts`
- `packages/db/src/events/__tests__/outbox.sql.repo.dialects.test.ts`
- `packages/db/src/events/__tests__/sql.lock-keys.test.ts`
- `packages/db/src/events/change-set-repo.sql.ts`
- `packages/db/src/events/outbox-repo.sql.ts`

## Stopped sheets (no partial production edits)

- **17 R01.CHAT.J:** markup anchors exist, but neither packages/chat/src/react/styles/{reference,chat-settings}.css nor examples/reference-web/src/styles.css contains mcpui-surface-card-closed or question-form-locked. The approved shipped-CSS text witnesses cannot be paired without adding unspecified CSS or depending on Tovu. No new CSS invented.
- **19 R01.USER-MANAGEMENT.J:** the FIX's closed statusTone keys are ok|warn|error|muted; actual MemberRow/UserStatusCell emit active|disabled|pending, declared in core/contracts/site/user-management-react.ts:23,73. No mapping is specified. No inferred semantic mapping, extra slot, context API or kit change added.
- **22 R02.REASONS.J:** table anchors do not match this first-pass HEAD: core/README.md:319 now describes host-owned tool-metadata maps and its local provider-neutral test; core/README.md and cms/README.md have no SPEC/ADR hits. The comments/PORT.md private-link anchor still exists and the scoped cms/user-management/admin census returned 452 hits. Per sheet-stop rule no partial documentation sweep or new closed fixture list was invented.
- **33 P10-H2.PUBLISH.J:** the FIX's required applyRunActor (repo-handler.ts:451), requiredMutationActor and MissingMutationActorError (core/mutation-actor.ts:35–60) are absent. mutation-actor.ts ends after checkedMutationActor; repo-handler.ts ends at createRepoPublishHandler. Existing user fallbacks were not replaced by a new mechanism. Reapply after the cited FIX 19 prerequisite reaches this branch.

## LEFT

- **30 G06.PHYSICAL.J:** NEEDS-OPUS, depends on round-1 G06.RUN.J. No launch split or size-debt edit.
- **14, 18, 21, 24, 27, 29, 32, 34:** Tovu repo only. Sheet 18's chat/public-widget part waits on 17; sheet 21's user-management part waits on 19; 34 waits on the missing 33 prerequisite. Other built Jini halves can be paired as described below. No REJECT Jini sheet in this set.
- API baseline regeneration: commerce, devops, agent-plugins, plugins, core, cms, db. No signature drift is claimed verified. Coordinator must generate rather than merge declaration JSON by hand.

## B1–B7 owner decision / prerequisite audit

- B1 STOP: no literal per-producer actor table is supplied. Receiving-service ids and origin-vs-worker attribution are not named. Existing MutationActor admits user|agent|system; the new seven-kind list omits user, with no conversion specified. No default/inferred provenance or second kind list added.
- B2 STOP/dependent: the chosen repo-handler mechanism depends on the absent applyRunActor/requiredMutationActor work noted in 33. No alternative settings-audit mechanism created.
- B3 STOP/dependent on B5 terminal taxonomy revision storage.
- B4–B6 LEFT to Tovu's single ADR-066 migration: apps/website's schema.sqlite.ts/schema.postgres.ts, trash/post/taxonomy revision tables and migration/checksum owner are absent here. Jini-only authorization does not authorize editing /Users/la/Programming/Tovu. No duplicate migration, backfill, SQL CHECK or VACUUM introduced.
- B7 CLOSED by owner decision: no queryable restore-ledger column; typed detail JSON unchanged.

## Tovu integration needs

No new package subpaths. Existing exports gain the named PaymentsClasses, AgentPluginIdentityReadOptions, LegacyAgentPluginIdentity, createCredentialCardsContribution, PluginManifestReadOptions, pluginManifestFilenames, AttributedDomainEvent and NewChangeSetRecord.

- 14: update package-facing jini-admin-email-* and jini-admin-provider-settings-* classes; preserve email IDs, shared field/dialog classes and provider-settings-spin animation.
- 18: bind jini-ui Select/InfoTip/SeeMore/UI TabBar and revised rows 1–4 private feature tokens. Existing jini-select-* / jini-tab-bar-* UI Kit branches and state classes stay distinct. Chat-owned/public FAB renames are not built.
- 21: supply existing host class values to HistoryTab, PublishRunResult and SourceControl; Payments has no new Tovu mount. UserManagementKit is unchanged.
- 24: align refusal/catalog description bytes; mediaKeyPrefix remains the same field.
- 27: bind the literal legacyIdentity descriptor to lifecycle, preboot, credential factory, provider-link, Soon/host-tool/supersession and fork readers in the same cut. The old warning export no longer exists.
- 29: own tovu.plugin.json and @tovu/sdk in site-plugin-vocabulary.ts; bind read options to host runtime, direct telemetry importer, integrity CLI and backup callbacks. Canonical writers remain canonical.
- 32: new insert fixtures need explicit matching actor/actorId. Historical rows belong at raw read-fixture boundaries. Outbox preparation preserves the producer actor.

## Final review / pruning

Removed only my draft's unrelated source-config barrel title/prose and data-testid substitutions; removed an unused legacyIdentity member accidentally added to the MCP warning helper. Corrected my draft's path-argument substitutions in legacy filename tests. Consolidated the duplicate newly-authored retained-export and historical-row witnesses into their existing suites. No baseline test, assertion, production capability or why-comment was deleted. The only production removals are the explicitly retired legacy constants/warning export; their fixtures remain intentional.

Architecture audit: WARNING — named owner/DI, canonical precedence, exact manifest exclusion, trusted-only supersession, actor preservation and existing transaction boundaries reviewed in source; no new abstraction/module or host dependency. Package execution, generated declarations and runtime behavior remain unverified by explicit dispatch. No approval requested and no external message sent.
