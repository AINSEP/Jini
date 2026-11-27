# w3-ext-a Jini commit plan

Starting branch `codex/w3-ext-aj`, HEAD `fd06f45b12ae0516b0fc196f58d785eba4d3831e`; .git untouched. Coordinator owns all commits.

Design base: Jini `ad71bf68dee9907ce4db8fe86dcb8d1ffd06e8ba`; Tovu `bf1519bba7329e0637eee4a6600dbdaba48f83db`. Tovu's current merge-23 remote-tracking ref and read-only worktree `/Users/la/Programming/tovu-m20` are `c0f1068a59e78a39dfdbbd3760b2c8aac996f794`. Mapped source blobs match the design base except J19's absent hook. Tovu main is newer and was not used as extraction source.

No tests, builds, installs, typechecks, linters, generators, commits, pushes, or subagents ran. The tests below were written before their corresponding production edits. Mutation instructions are proposed cloud witnesses, not executed results. No generated API baselines edited; exact deltas for Opus are listed below.

Status: 9 implemented sheets (J01/J02/J03/J05/J06/J08/J11/J13/J18), 2 partially implemented (J04/J07), 7 stopped (J09/J12/J14/J16/J17/J19/J20), J15 left on J16, J10 NEEDS-OPUS. All T sheets are outside this Jini-only dispatch. No OPUS-only or rejected cross-set work attempted.

## Coordinator commit units in design order

The following implementation units are unverified. Package prep is the first logical commit within J04/J07/J08, as required by G3. Their listed first tests precede source implementation. Each unit also updates this plan. Manifest edits mirror new leaves in exports, jini.entries, typesVersions where used, and existing isolation entry maps; new optional React peers include optional-peer capability descriptions.

### J01 — deployment contracts
- First: `packages/core/src/contracts/site/__tests__/deployment-admin.contract.test.ts`.
- Then: `packages/core/src/contracts/site/deployment-admin.ts`, `packages/core/package.json`, `.changeset/admin-extraction-01.md`.
- Mutation `M-drop-deploy-linked-peer`: delete `linkedPeerId?` from `DeployRunDestination`; deploy fixture must fail typecheck.
- API delta for `api-baseline/jini-ai__core.json` (Opus generates): new `./contracts/site/deployment-admin`: `StaticDeploymentDestination`, `DeployRunDestination`, `DeploymentDestination`, `StaticExportPort`, `StaticPublishPort`.
- T01: use that core leaf, specialize publish port; keep `tovu-peer` host-owned; static target is now string. Live wire parity test belongs to T01.
### J02 — browser reconnect and settings feed
- First: `packages/admin/src/browser/__tests__/{browser-adapter-parity.unit.test.ts,settings-feed-principal.unit.test.ts}`.
- Then: `packages/admin/src/browser/{server-reconnect.ts,settings-events.ts,index.ts}`, `packages/admin/package.json`, `.changeset/admin-extraction-02.md`.
- Mutations: `M-retry-ambiguous-write` permits POST without refused-upstream proof; `M-share-settings-across-principals` removes the principal from the stream key. Tests also pin synchronous joined polling, independent supplemental revision replay and native reconnect keeping the stream open.
- Existing `core/routing/__tests__/route-template.test.ts` already pins query and fragment stripping; no duplicate telemetry work or test added.
- API delta for `api-baseline/jini-ai__admin.json`: new `./browser/server-reconnect`: `ServerConnectionStatus`, `ServerReconnectDeps`, `ServerReconnectOptional`, `ServerReconnect`, `createServerReconnect`, `shouldRetryAfterReconnect`, `probeReadyz`; new `./browser/settings-events`: `subscribeToSettingsChanges`. Added the same symbols to existing `./browser`.
- T02 supplies clocks, ready URL/signal, headers, singleton, settings URL query order, supplemental decoder/publisher, browser stream ports/activity, and warn. Telemetry binds existing route-template/root-handler APIs.
### J03 — browser durable transport and routed A2UI
- First: `packages/chat/src/core/assistant-client/__tests__/browser-durable-subscription.unit.test.ts`, `packages/chat/src/react/components/__tests__/RoutedA2uiSurfaceCard.routing.unit.test.tsx`.
- Then: `packages/chat/src/core/assistant-client/{browser-durable-subscription.ts,entry.ts}`, `packages/chat/src/react/components/RoutedA2uiSurfaceCard.tsx`, `packages/chat/package.json`, `.changeset/admin-extraction-03.md`.
- Mutations: `M-use-checkpoint-etag-on-recover` sends a poll's conditional ETag on POST recovery; `M-portal-live-refusal` removes `!hasError` from the portal condition.
- API delta for `api-baseline/jini-ai__chat.json`: existing `./transports/http` adds `browserDurableSubscriptionPorts`; new `./react/components/RoutedA2uiSurfaceCard` exports `RoutedA2uiSurfaceCardProps`, `RoutedA2uiSurfaceCard`.
- T03 keeps run map, notices and activity wrapper; inject request/open/schedule/encoded runPath. Mount injects SurfaceCard, translator, routing hook and chart registry hook; CSS import remains at host mount.
### J04 — PARTIAL: stored credential hint only
- Package prep: `packages/integrations/{package.json,tsconfig.json}`: G3 optional React/ReactDOM peers, CMS-matched dev versions, JSX/DOM libs.
- First: `packages/integrations/src/react/credentials/__tests__/credential-copy.fidelity.unit.test.ts`.
- Then: `packages/integrations/src/react/credentials/credential-copy.ts`, manifest export, `.changeset/admin-extraction-04.md`.
- Mutation `M-show-mask-for-other-endpoint`: remove the endpoint mismatch guard; the undefined hint assertion fails. `M-trim-secret-before-validation` belongs to T04, using existing admin credentialDraftError.
- API delta for `api-baseline/jini-ai__integrations.json`: new `./react/credentials/credential-copy`: `storedCredentialHint`.
- STOP BYOK panel step: source imports `resolveByokFooterStatusLine` from `hooks/use-admin-execution-credential.hooks.ts:39`; J04 names neither its move nor an injected resolver prop. Integrations cannot import admin or the Tovu controller. Adding that seam would exceed the hard named-only rule. `AdminByokKeyPanel.status.unit.test.tsx` not added because no legal target implementation is specified.
- T04 may bind storedCredentialHint; BYOK mounts await a corrected sheet. No credentialDraftError duplicate added.
### J05 — placeholder and appearance arbitration
- First: `packages/admin/src/react/shell/__tests__/{Placeholder.two-hosts.unit.test.tsx,appearance-arbitration.unit.test.tsx}`.
- Then: `packages/admin/src/react/shell/{Placeholder.tsx,appearance.ts}`, `packages/admin/package.json`, `.changeset/admin-extraction-05.md`.
- Mutations: `M-read-module-nav-instead-of-arg` ignores the second host nav input; `M-retire-newer-appearance-draft` changes retirement comparison from `<=` to `>=`, deleting the newer draft behind an in-flight read.
- API delta for `api-baseline/jini-ai__admin.json`: new `./react/shell/Placeholder`: `findNavGroupLabel`, `ComingSoonNotice`, `Placeholder`; new `./react/shell/appearance`: `createAppearanceDraftStore`, `useAdminAppearance`, `useSettingsAppearance`.
- T05 retains dictionaries, nav construction, CSS/DOM painters and defaults; creates one store shared by both bound hooks. Both hooks require root and store; reader/resolver share one generic appearance payload.
### J06 — files client and publish deep link
- First: `packages/cms/src/react/fs-files/__tests__/fs-files-api.wire.unit.test.ts`, `packages/cms/src/react/publish-content/__tests__/publish-criteria-deep-link.consume.unit.test.ts`.
- Then: `packages/cms/src/react/{fs-files/fs-files-api.ts,publish-content/publish-criteria-deep-link.ts}`, `packages/cms/package.json`, `.changeset/admin-extraction-06.md`.
- Mutations: `M-send-custom-root-clear-as-put` changes clear DELETE to PUT; `M-keep-invalid-publish-query` skips replacement for an invalid decoder result.
- API delta for `api-baseline/jini-ai__cms.json`: new `./react/fs-files/fs-files-api`: `createFsFilesApi`; new `./react/publish-content/publish-criteria-deep-link`: `takePublishCriteriaFromQuery`.
- T06 supplies authenticated request/workspace and query parameter/decoder; desktop bridge, native folder picker and 409 classifier stay host-owned.
### J07 — PARTIAL: skills client only
- Package prep: `packages/agentic/package.json`: optional React peer and CMS-matched React/dev types; no DOM lib or exclude change.
- First: `packages/agentic/src/react/skills/__tests__/skills-client.wire.unit.test.ts`.
- Then: `packages/agentic/src/react/skills/api.ts`, manifest export, `.changeset/admin-extraction-07.md`.
- Client pins confirmed:true and accepted-write-only notification. Named hook mutations `M-install-before-confirm`, `M-allow-superseded-upload-read` remain LEFT with the hooks.
- API delta for `api-baseline/jini-ai__agentic.json`: new `./react/skills/api`: `SkillFiles`, `createSkillsApi`.
- STOP hook step: G3 claims the four files have all DOM injected, but `use-skills.hooks.ts:153-154` creates HTMLInputElement refs, and :193-194 calls `.click()`; upload uses File[] at `use-skill-install.hooks.ts:16`. No replacement input-ref/click seam is specified; adding DOM libs or changing exclude is explicitly forbidden. `skills-install-generation.unit.test.tsx` and `skills-reload-after-write.unit.test.tsx` remain unadded pending corrected seam.
- T07 can bind the client, preserving its original event, format text, and invalid guidance error. Controller mounts await the corrected sheet.
### J08 — plugin transports and installed skill snapshots
- Package prep: `packages/{agent-plugins,plugins}/package.json`: optional React peer, CMS-matched dev dependencies. Existing tsconfigs retained (no TSX in these leaves).
- First: `packages/{agent-plugins,plugins}/src/react/__tests__/plugin-install-transport.wire.unit.test.ts`, `packages/agent-plugins/src/react/__tests__/installed-skills-snapshot.unit.test.ts`.
- Then: `packages/agent-plugins/src/react/{agent-plugin-install-port.ts,installed-skills-composer-source.ts}`, `packages/plugins/src/react/plugin-install-port.ts`, manifest exports, `.changeset/admin-extraction-08.md`.
- Mutations: `M-drop-expected-old-digest` removes update digest query; `M-use-unconfirmed-replacement` forces replace=true; `M-stale-skill-refresh-wins` removes generation guard on cache publication. Witness also pins 304 retaining snapshot, invalid-body refusal, abort silence and no guidance in cache.
- API delta for `api-baseline/jini-ai__agent-plugins.json`: new `./react/agent-plugin-install-port`: `createAgentPluginInstallPort`; new `./react/installed-skills-composer-source`: `createInstalledSkillsComposerCapabilitySource`. Delta for `api-baseline/jini-ai__plugins.json`: new `./react/plugin-install-port`: `createPluginInstallPort`.
- T08 binds crypto digest, authenticated request/workspace and composer path/304 classification/error sink; apply host satisfies for port/source shapes. Fakes stay host-owned.
### J11 — page editor port and save transaction
- First: `packages/cms/src/react/pages/hooks/__tests__/{page-editor-save.expected-version.unit.test.ts,page-editor-save.partial.unit.test.ts}`.
- Then: `packages/core/src/contracts/site/content-editor-ports.ts`, `packages/cms/src/react/pages/hooks/page-editor-save.ts`, `packages/{core,cms}/package.json`, `.changeset/admin-extraction-11.md`.
- Mutations: `M-use-pre-metadata-version-for-body` sends plan.updatePostPayload.expectedVersion to the body write; `M-clean-html-after-partial-save` advances the saved HTML baseline on body refusal. Tests pin metadata version 8 rather than attempted 3, canSaveHtml refusal and partial-success dirty retention.
- API delta for `api-baseline/jini-ai__core.json`: new `./contracts/site/content-editor-ports`: `EditorDraftPort`, `PageEditorPort`. Delta for `api-baseline/jini-ai__cms.json`: new `./react/pages/hooks/page-editor-save`: `PageSavePlan`, `applySavedPage`, `writePage`, `PageBodyWriteError`, `applyPartialSave`, `applySaveFailure`.
- T11 specializes Row/Embed/Draft/Snapshot at its live port and injects all existing message functions plus conflict/unexpected-failure readers. Core keeps activeThemeApiVersion required with undefined allowed, nullable tier and null-vs-empty template choice.
### J13 — publish-content client and port
- First: `packages/cms/src/react/publish-content/api/__tests__/publish-content-client.ceremony.unit.test.ts`.
- Then: `packages/cms/src/react/publish-content/{api/publish-content-api.ts,hooks/publish-content-port.hooks.ts}`, `packages/cms/package.json`, `.changeset/admin-extraction-13.md`.
- Mutations: `M-drop-confirmed-overwrite-set` omits overwriteEntityKeys from execute; `M-send-empty-plan-body-when-absent` sends `{}` instead of omitting body. Witness pins peer encoding and bundle/token/overwrite transport.
- API delta for `api-baseline/jini-ai__cms.json`: new `./react/publish-content/api/publish-content-api`: `createPublishContentApi`; new `./react/publish-content/hooks/publish-content-port.hooks`: `PublishContentPort`.
- T13 instantiates once with request/workspace and uses the neutral collaboration port; keeps ceremony controllers/stores and host fake ports.
### J18 — media edit and picker
- First: `packages/cms/src/react/media/MediaEditDialog/__tests__/MediaEditDialog.hidden-alt.unit.test.tsx`, `packages/cms/src/react/media/MediaPickerDialog/__tests__/MediaPickerDialog.backend-parity.unit.test.tsx`.
- Then: `packages/cms/src/react/media/MediaEditDialog/MediaEditDialog.tsx`, `packages/cms/src/react/media/MediaPickerDialog/{MediaPickerDialog.tsx,MediaPickerDialog.hooks.tsx}`, `packages/cms/package.json`, `.changeset/admin-extraction-18.md`.
- Mutations: `M-drop-picker-redaction-port` omits errorRedaction from the bridge's arguments; `M-clear-hidden-alt-on-style-save` replaces initial.alt with null when showAlt=false. Witness pins legacy cancellation once, enabled backend choice, null/empty lists and host redaction identity.
- API delta for `api-baseline/jini-ai__cms.json`: new `./react/media/MediaEditDialog/MediaEditDialog`: `MediaEditDialogProps`, `MediaEditDialog`; new `./react/media/MediaPickerDialog/MediaPickerDialog`: `MediaPickerDialogProps`, `MediaPickerDialog`; new `./react/media/MediaPickerDialog/MediaPickerDialog.hooks`: `useMediaPickerItems`, `acceptedMediaItems`, `MediaPickerDialogController`, `useMediaPickerDialog`.
- T18 supplies native dialogs, real controller hook, both picker hooks, translator/acceptance rule, error renderer and pickerHostArgs (request port, errorRedaction, incident extractor and cached-loader hook). Required legacy controller injection is removed from the bridge arguments so it does not itself disable the enabled backend. Host mount retains explicit legacy-override policy and CSS. Existing media index untouched.

## Stopped and left sheets

- **J09 STOP:** `features/integrations/Integrations.tsx:8` imports `deleteWebhookBody` and `actionsForWebhookLabel` from admin-owned i18n. The sheet does not name moves or required injected props for those helpers; retaining an admin dependency violates the specified domain boundary, while introducing unnamed seams violates the owner rule. No J09 tests/source/prep edits.
- **J10 LEFT / NEEDS-OPUS:** approved component-map direction still requires explicit EmailParts, EmailTabHooks and kit interfaces from Opus. No mail work.
- **J12 STOP:** `features/posts/hooks/use-post-url-dialog.hooks.ts:2,38` imports and invokes `getEmbedUrlFromYoutubeUrl` from `@tiptap/extension-youtube`. No parser injection is named, while a TipTap-owned runtime import is forbidden. No unlisted parser prop or duplicate validation added; J12 not built.
- **J14 STOP:** `features/security/SiteKeyTab.tsx:1,135` imports/calls `siteKeyStatusBadgeLabel` from admin's `security/host/hooks/site-key-status.rules`. The FIX explicitly forbids importing that module into integrations, but names no replacement collaborator or move for the badge helper. No J14 tests/source/prep edits beyond J04's existing integrations prep.
- **J16 STOP:** FIX (3) requires a table naming every injected prop for Deployment/OverviewTab/DockerfileTab **before dispatch**. That table is absent from the supplied revision; the original sheet expressly says required controller hooks is not a signature. No replacement interface/table invented and no devops edits.
- **J15 LEFT:** depends on J16 field helpers, which were stopped. No source-control work.
- **J17 STOP:** `HtmlAttributeRows.tsx:5,48` imports/uses admin-owned DockHeaderTip; HtmlAttributeRowsProps names four new collaborators but no tooltip/renderer seam. The hook source also contains three unconditional useWidgetAddControl calls (Form/Menu/Gallery at :66-68), against the sheet's two-call premise. No collaborator/count redesign inferred; no J17 source/tests.
- **J19 STOP / source anchor mismatch:** `apps/admin/src/hooks/use-ai-agent-presentation.hooks.ts` is present at bf1519bb but absent at current merge-23 c0f1068a. Sheet stopped as required; no successor inferred.
- **J20 STOP:** Recovery.tsx is 583 lines. Keeping existing statements/comments verbatim and removing only imports cannot meet the 500-line file cap. The named RestoreFlow/RestoreFlowBody split is inside the same destination and does not reduce the file size. No second destination or deletion of why-comments is authorized. No db prep/source/tests.
- **T01–T20 LEFT:** Tovu half belongs to another dispatch. J01 live route parity, J04 draft-validation fidelity, existing host live binding witnesses and all repointing remain Tovu-owned.

## Diff cleanup and review

- Removed unrelated JSON normalization and restored every original manifest duplicate key/array layout; only required metadata additions remain.
- Removed attempted agent-plugins/plugins tsconfig lib expansions: G3 names JSX/DOM prep for TSX; these three J08 leaves are TS. Existing configs retained. No production files or pre-existing tests deleted.
- No unlisted adapters, fallback paths, retry rules, coverage exclusions, suppression comments, or baseline hashes. Existing decision/effect order and why-comments retained in moved bodies; required injection/projection and generic typing are the intended changes.
- Runtime labels: request-injected fs-files/publish-content clients and page-save helper are universal; React/browser I/O leaves are browser; core contracts are universal. G3 browser entries take precedence for prepared domain leaves.
- No assertion weakened and no pre-existing test changed. Added 19 test files (21 test cases); total repository pass/fail/coverage counts are unmeasured. Mocks model only collaborators in the named cases; generation tests use explicitly controlled promises.
- Manual architecture audit: PARTIAL. Reviewed type-only core ownership, no domain import into admin, no admin runtime dependency in new domain leaves, host words/credentials, required injected custom hooks, omitted optional fields, source comments and export metadata. Runtime correctness, compiler compatibility, line/complexity gates and mutation kills remain unverified by instruction; no green claim.
- Known verification obligation: partial-save dirty witness supplies setSavedHtml as an extra observer; M-clean-html-after-partial-save must add that setter to the mutant's failure-setter projection and advance it, then the observer assertion goes red. No such mutation is retained.
- Cloud/Opus next: run specified tests and mutations, typecheck, guard (especially package layers/optional peers and browser boundaries), then generate API baselines/API check. No package release range changes were made in Tovu; bind against these new local leaves until release integration.
