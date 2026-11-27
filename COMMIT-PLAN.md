# X4 admin — Jini-only partial handoff

No commits: `.git` is read-only. No installs, builds, tests, mutations, typechecks, linters, subagents, or package intake ran. All edits are in this working tree. This file is NOT for commit.

## Anchors and ownership

- Working HEAD: `0ba3fd793eb87315504e1b6137ff7a9bf723d596` (merge-24). The named `origin/codex/m24-tip` ref is absent in both local repositories; no fetch was attempted against read-only Git metadata.
- Tovu source was read from available immutable `a96020e1e7` blobs, not its newer working checkout. Jini comparison anchor `0718702bb` is available.
- Required programmer instructions read at `/Users/la/Programming/Tovu/AI-Dev-Shop/agents/programmer/skills.md`; dispatch overrides seed approval, execution, extra abstractions/comments, and delegation.
- Tovu is untouched. No MOVE file meets the cross-repository DONE definition until its Tovu deletion/binding and importer ledger are completed. No counter completion is claimed.
- All new subpaths have `exports` and `jini.entries`; existing `typesVersions` maps are mirrored. Browser paths are browser; pure paths are universal. Existing manifest text was preserved outside the additions.
- Original why-comments accompany moved behavior. Host defaults, copy, URLs, catalogs, themes and live I/O remain inputs. No flag is enabled.

## Ordered coordinator commit units

These are proposed commit units, in sheet order, not commits made here. Every implementation unit also touches the named packages' `package.json` and `.changeset/x4-aNN.md`.

### A01 — Jini reuse, no delta
Verified existing locale, browser reconnect/feed, and shell exports. `packages/admin/src/shell/hooks/__tests__/use-admin-locale.hooks.unit.test.tsx` already characterizes scoped ownership and reverse-order refresh. Mutation `locale-drop-refresh-invalidation`: remove the refresh listener's prefix invalidation; the newer refresh cannot win. Tovu's compatibility-shaped locale binding and feed tests remain coordinator work. No changeset.

### A02 — Jini reuse, no delta
Verified execution ledger, agent presentation, BYOK footer and credential-copy exports. Tovu retains legacy migration and post-save removal. Host mutations/tests remain: `execution-ledger-send-key` (ledger receives the typed secret), `execution-clear-legacy-on-refusal` (refused save removes legacy key). No changeset.

### A03 — STOPPED typed slices; settings view LEFT
`lib/settings-tabs.ts` source `savePrivacy` includes localStorage withdrawal writes and CustomEvent dispatches before and between durable ledger writes. The specified universal core entry and ledger-only inputs cannot preserve these statements without a host effect contract that the sheet does not name. No DOM-bearing core copy was added. `SettingsUi.tsx:281-680` remains 400 lines before its named cuts; no UI cut or readiness test was implemented. Mutations left: `settings-open-before-slices-ready`, `settings-send-full-slice`.

### A04 — Jini implemented; @jini-ai/chat
- `packages/chat/src/core/assistant-client/ag-ui-approval-relay.ts`
- `packages/chat/src/core/assistant-client/__tests__/assistant-transport.ag-ui.approvals.unit.test.ts`
New public subpath: `transports/ag-ui/approval-relay`. Required relay copy is `ports.copy: { expired, unsent }`; tool-route copy is `{ sent, notSent }`. Fallback remains required. Only the permitted `segmentHandlersFor` cut was added; canonical identity, durable sink, held settlement and one-use claim remain.
Tests written before production: duplicate clicks resume once with the original parent; an unmatched exchange reaches fallback. Mutation `agui-drop-one-use-claim`: remove the parked claim guard/write; resume count becomes two. Tovu must bind its four original sentences and repoint both callers. The existing public AG-UI entry is unchanged.

### A05 — Jini implemented; @jini-ai/chat, @jini-ai/admin
- `packages/chat/src/react/chat-cleanup/{ChatCleanupPanel.tsx,chat-cleanup.hooks.ts}`
- `packages/chat/src/react/chat-cleanup/__tests__/chat-cleanup.unit.test.tsx`
- `packages/admin/src/shell/components/AssistantDock/DockCleanupHeader.tsx`
The copy and wire interfaces moved with the controller contract; no host translation table moved. The header imports chat types only and requires the panel and cleanup hook. Test first: cancel a visible confirmation (zero deletes), then accept exactly `[b,a]` (one delete). Mutation `chat-cleanup-delete-before-confirm`: invoke deletion before awaiting consent. Tovu must retain its real Button adapter assertions and bind the panel/hook at its mount.

### A06 — Jini partial; @jini-ai/admin
Implemented:
- `packages/admin/src/shell/components/AssistantDock/hooks/{agents-inventory,runtime-access,messages-change}.hooks.ts`
- `packages/admin/src/shell/components/AssistantDock/__tests__/{agents-loader.unit.test.ts,use-messages-change-handler.unit.test.tsx}`
Inventory injects request, original error constructor, endpoint, 60s timeout, snapshot writer, boot/query hooks and clock. Runtime access takes bound loader, health, snapshot and rescan functions. Messages take persistence, debug-mirror and both refresh sinks; their effect order is unchanged.
Tests first/mutations: `dock-cache-empty-inventory` returns an empty catalog instead of rejecting; `dock-republish-tool-result` removes the already-published count guard. Repeated tool-result deltas must announce once.
LEFT: `AssistantDock`, `AssistantDock.state.hooks`, `DockChatPane`, `assistant-dock-props`, and their required-hook-to-pane characterization. No composition move or host deletion is claimed. The existing package `composer-discovery.hooks.ts` already has a private `watchComposerCapabilities` scope owner; the residual host function has that same name. Its public lifetime cut/contract remains unresolved; no second resolver or renamed extra helper was invented.

### A07 — Jini partial; @jini-ai/cms
Implemented under `packages/cms/src/react/media/`:
- `ExternalProvidersPanel.tsx`, `MediaLoadMore.tsx`, `chrome-playback-note.tsx`, `media-icons.tsx`, `use-media-provider-catalog.hooks.ts`
- `hooks/use-grid-pages.hooks.ts`
- `__tests__/media-grid-cursor.unit.test.tsx`
Grid takes the existing host list key. Provider port, policy, pinned IDs and theme-boundary hook are required. Codec threshold is required as `maxUploadBytes`.
Test first/mutation `media-accept-old-cursor`: remove `currentMore`'s base ownership check; old All rows append after switching to Videos.
STOPPED `use-media-writes.hooks.ts`: source sends `{ alt: input.alt }`, including undefined; existing `MediaPort.uploadMedia` declares `alt?: string` under Jini's exact optional properties. No wire-shape rewrite, false non-null assertion or port widening was made.
STOPPED view cuts at the current declarations: `EditMediaPanel:314-511` 198 lines, `MediaEditRenderOverrideFields:516-602` 87, `MediaToolbar:763-856` 94, `MediaLibraryPanel:1183-1306` 124. Moving these declarations to the named files does not meet 80 lines. `useEditMediaPanel:183-331` is 149 lines, `useMedia:171-306` 136; finer function contracts remain LEFT. Catalog rows/count characterization `media-count-from-pinned-catalog` remains LEFT with the main view.

### A08 — Jini reuse, no delta
Verified Library and live port-factory exports. Moving the three fake declarations into Tovu's test fixture is host work. Mutation left there: `library-capture-client-method-early`. No changeset.

### A09 — Jini partial; @jini-ai/cms
- `packages/cms/src/react/widgets/WidgetConfigFields/MediaContentEditor.hooks.ts`
- `packages/cms/src/react/widgets/WidgetConfigFields/__tests__/MediaContentEditor.markup.unit.test.tsx`
Requires media port, locale, bound picker hook and acceptance validator. Test first/mutation `widget-reset-html-on-mode-switch`: clear the inactive stash while switching; HTML and structured HTML attributes must survive round trips.
LEFT: media editor view, both picker modules and `widget-create-on-select` characterization. The media view's preview hook type is currently the concrete host `WidgetPreview.hooks.ts`; its full preview/kit slot cut was not implemented. Picker loader/draft cuts were not implemented. No deletion/binding claim.

### A10 — Jini reuse, no delta
Verified CMS `CollectionEntryEditor`; injected field-key/unrelated-field characterization and TipTap wiring stay in Tovu (`collection-drop-json-field-slot`). No changeset.

### A11 — Jini reuse, no delta
Verified Database screen. Tovu's three-controller binding/test remains (`database-swap-schema-timeline-hook`). No changeset.

### A12 — Jini partial; @jini-ai/devops
- `packages/devops/src/deploy/react/download-dockerfile.ts`
- `packages/devops/src/deploy/react/hooks/use-static-export.hooks.ts`
- `packages/devops/src/deploy/react/__tests__/DockerfileTab.unit.test.tsx`
Download receives Blob, URL operations and document. Export receives query/refresh hooks, timers and error/copy functions. Original 1500ms polling and three-failure bound remain. Test first/mutation `deploy-revoke-before-click`: revoke before click; expected order is create, click, revoke.
STOPPED view: `GettingItOnlineCard:520-601` remains 82 lines even in the named file. LEFT: static-publish 228-line hook and credential 201-line hook splits, stale-preview and duplicate-publish tests (`deploy-accept-stale-preview`, `deploy-drop-trigger-claim`). No StaticSiteTab or publish-credential exports were added.

### A13 — NEEDS-OPUS, no delta
The sheet expressly requires Opus to confirm EmailParts, all six EmailTabHooks members, Provider and template-hook/kit interfaces before the move. The approved four-component map alone does not supply those shapes. Both email mutations/tests remain host/coordinator work: `email-mount-inactive-tab`, `email-ignore-dirty-leave`.

### A14 — Jini reuse, no delta
Verified CMS filesystem client. Runtime bridge lookup and 409 binding test remain Tovu work (`files-drop-host-bridge-key`). No preload changes. No changeset.

### A15 — Jini reuse, no delta
Verified ImportExport shell; host reduction and `import-export-read-sites-on-other` stay Tovu work. No changeset.

### A16 — Jini reuse, no delta
Verified IntegrationDeliveries. Host timezone characterization remains (`deliveries-drop-viewer-zone`). No changeset.

### A17 — Jini implemented; @jini-ai/admin
- `packages/admin/src/screens/menus/hooks/use-route-guarded-menu-editor.hooks.ts`
- `packages/admin/src/screens/menus/__tests__/use-route-guarded-menu-editor.hooks.unit.test.tsx`
Required editor hook and before-navigation subscription; layout effect, cancellation and router ownership preserved. Test first/mutation `menus-ignore-router-cancellation`: omit preventDefault; Back must invoke the mounted callback once, and unmount removes the listener. Tovu must bind its real browser event in use-menu-editor and delete the old route-guard path.

### A18 — Jini partial; @jini-ai/cms
- `packages/cms/src/react/pages/hooks/use-preview-embed-ids.hooks.ts`
- `packages/cms/src/react/pages/page-editor-rules.ts`
- `packages/cms/src/react/pages/__tests__/PageEditor.preview-youtube.unit.test.tsx`
Loader requires host request and path builder. Surface selector receives the styling discriminated state as data and reuses the existing admin view type. Test first/mutation `page-apply-stale-embed-ids`: allow a superseded request to settle state; late old IDs must not replace current IDs.
STOPPED view cuts: source `PageEditorHeader:126-216` 91 lines, `PageEditorActions:238-331` 94, `PageEditorPane:955-1115` 161; preview `PagePreview:92-208` 117. Named declaration moves alone exceed 80 lines. NEEDS-OPUS before the 700-line controller's flush/preview/save/draft split; no controller or interactive-flush test implemented (`page-save-before-interactive-flush`).

### A19 — Jini partial; @jini-ai/agent-plugins, @jini-ai/plugins
- `packages/agent-plugins/src/react/use-agent-plugins.hooks.ts`
- `packages/agent-plugins/src/react/__tests__/use-agent-plugins.hooks.unit.test.tsx`
- `packages/plugins/src/react/PluginProviderSettingsDialog.tsx`
Controller takes query hooks, refresh subscription/resource, translators, error guard/describer and host refusal map. Settings dialog takes kit/views, live settings hook, required-field policy and legacy-format copy; focus hook takes document. Neither imports admin view implementations at runtime.
Test first/mutation `agent-plugins-replace-newer-toggle`: allow an earlier list read to overwrite the loader's confirmed toggle replacement.
STOPPED details modal: source explicitly passes `initialViewId={... : undefined}`, but existing `PackageFilesModalProps.initialViewId?: string` rejects explicit undefined under Jini's exact optional properties. No shared prop widening or JSX rewrite was made. Its staged production/test files were removed, so `plugins-eager-open-surface` remains LEFT. LEFT: AgentPlugins and Plugins screens and named row/marketplace/overlay cuts; both host install-fixture moves. G3 package prep remains coordinator work: agent-plugins/plugins tsconfigs currently lack JSX setup; plugins also lacks DOM lib setup. No config/intake edit was made here.

### A20 — Jini partial; @jini-ai/cms
- `packages/cms/src/react/posts/{posts-list-rules,post-editor-rules}.ts`
- `packages/cms/src/react/posts/editor/notices/PostEditorNotices.tsx`
- `packages/cms/src/react/posts/editor/notices/__tests__/PostEditorNotices.unit.test.tsx`
Rules cover row actions/handles, draft/conflict copy, preview/date and slug decisions. Existing save/state rules remain their owners. Cover/theme rules and TipTap stay host. Notice leaves, recovery formatter and external-change bindings are required inputs.
Test first/mutation `posts-show-duplicate-stale-notice`: remove the outside-change suppression; stale draft returns only after outside-change notice clears.
STOPPED list view: `Posts:59-216` is 158 lines and the sheet names no view cut. LEFT: 139-line usePosts split at writes, stale list/selection characterization (`posts-apply-stale-list`), host rich-text residual/counter audit.

### A21 — Jini implemented; @jini-ai/admin
- `packages/admin/src/screens/routines/{Routines.tsx,RoutineForm.tsx,Routines.hooks.ts,RoutinesMount.tsx,project-routine-row.ts,routines-api.ts}`
- `packages/admin/src/screens/routines/__tests__/Routines.test.tsx`
- `packages/admin/src/shell/hooks/use-conversation-deep-link.ts`
- `packages/admin/src/shell/hooks/__tests__/dock-conversation-deep-link.integration.test.tsx`
Mount requires host translator, desktop notice key and unavailable-state map; preserves the pre-controller release gate and hook order. Client and 409 mapping are verbatim. Poll remains 30s. Authorized lookup/query replacement/notification/dock selection are injected.
Tests first: waiting + catch-up projection, stale write reload with one write, owned selection once, transient failure leaves query intact. Mutations: `routines-render-waiting-as-complete` maps waiting to Succeeded; `routines-consume-link-on-lookup-error` treats a rejected lookup as absence. Package deep-link test exercises the hook; full dock/no-run integration remains dependent on A06. Host URL builder/owned-list/replaceState stay Tovu.

### A22 — NEEDS-OPUS, no delta
The sheet expressly requires the peer/criteria/replan/confirmation/execute ordering check before the 1289-line controller implementation. No controller move was attempted. Dialog/report cut is LEFT; no package-local View contract was invented while its controller cut is held. Mutations/tests left: `publish-execute-unconfirmed`, `publish-confirm-during-replan`.

### A23 — Jini reuse, no delta
Verified DB Recovery entry. Preview-not-apply host binding/test remains (`recovery-wire-apply-to-preview`). No changeset.

### A24 — Jini partial; @jini-ai/integrations
- `packages/integrations/src/react/credentials/{access-token-forms,other-credential-stores}.ts`
- `packages/integrations/src/react/credentials/__tests__/access-token-forms.unit.test.ts`
Reuses existing leaf form rules and connection builders. Host error recognition and source-control discriminator are injected. Store roster and route catalog are NOT copied; lookup takes the host roster. Existing public form/projection types accompany behavior.
Test first/mutation `security-serialize-blank-replacement`: serialize connection despite hasToken false; a rename with blank token must contain only its label.
Existing admin live Security ALREADY renders Totp, RecoveryCodes and Passkeys before the tab bar in the original order, so no pre-tab option was added. STOPPED recovery reuse: the named `@jini-ai/user-management/react/auth/RecoveryCodesCard` export does not exist at HEAD.
STOPPED view cut: `TokenInputFields:492-607` remains 116 lines in the named field file. `useOtherCredentials:190-281` is 92 lines with no named finer hook cut. NEEDS-OPUS for the 506-line access-token hook's seed-effect/reload split. Remaining views/state hooks and reload/permission/recovery tests are LEFT (`security-apply-earlier-reload`, `security-show-site-key-without-grant`).

### A25 — Jini partial; @jini-ai/mcp
- `packages/mcp/src/react/external-mcp/hooks/use-external-mcp-admissions.hooks.ts`
- `packages/mcp/src/react/external-mcp/hooks/__tests__/external-mcp-missing-launcher-recovery.unit.test.tsx`
All query, permission, error, copy, drift projection, timers and diagnostic collaborators are required. Retry remains 60 at 3s; accepted restart watch remains 8 at 2.5s. Test written before the move pins the retry cap; source-review follow-up extended that test to pin restart observation too. Mutation `mcp-retry-past-cap`: increase the retry/watch bound; reads must stop at 61 total then 69 after one accepted restart.
STOPPED panel cut: `ExternalMcpSourceRow:309-398` remains 90 lines; `ProvidersView:222-330` 109 lines has no named finer cut. LEFT: source/config/write hook split, panels, reuse of existing banner/form-hook exports, and partial-write credential-preservation test (`mcp-write-blank-secret-in-partial-patch`). No connection/default policy changed.

### A26 — Jini reuse, no delta
Verified four Agentic skills exports. Host notify-after-accept test remains (`skills-notify-before-accept`). No DOM code or changeset.

### A27 — Jini reuse, export spelling mismatch
ProvidersTab exists. SourceControl source exists behind the existing `@jini-ai/devops/source-control/react` entry; literal `.../react/SourceControl` is NOT exported. The sheet says reuse unchanged, so no extra alias/forwarder was added. Tovu must use the existing root entry or coordinator must revise the subpath. Host credential binding/test remains (`source-control-drop-bound-credentials`). No changeset.

### A28 — Jini implemented; @jini-ai/admin
- `packages/admin/src/screens/storage/{StorageScreen.tsx,ScreenshotCleanupSection.tsx}`
- `packages/admin/src/screens/storage/api/{storage-api,screenshot-cleanup-api}.ts`
- `packages/admin/src/screens/storage/hooks/{use-storage,use-screenshot-cleanup}.hooks.ts`
- `packages/admin/src/screens/storage/__tests__/{Storage.unit.test.tsx,use-screenshot-cleanup.unit.test.ts}`
Required inputs preserve host links, labels, dictionary, DOM-shaped Button, age (host passes 90), anchor, clock and error presentation. Storage client uses the real generic HTTP request shape and injected basePath; screenshot client takes workspaceId and path builder. No live instances or host routes moved.
Tests first/mutations: `storage-send-unmeasured-class` adds a kind absent from the measured dry run; expected live request is exactly old-copy plus grant-1. `screenshots-apply-on-preview` applies during preview; apply must wait for confirm and use the shown token.
Tovu must bind clients/hooks/screen, repoint panel-pages directly, delete forwarding index and both original hook implementations. No retention runner, compaction or recovery action added.

### A29 — Jini reuse, no delta
Verified Trash screen/controller exports. Host refusal projection characterization remains (`trash-bypass-bound-error-projection`). No changeset.

## Source review and deliberate removals

- Removed this run's staged `packages/cms/src/react/media/hooks/use-media-writes.hooks.ts` and its new export after finding the exact optional upload-port mismatch; other media files remain.
- Removed this run's staged `packages/agent-plugins/src/react/AgentPluginDetailsModal.tsx`, its test and its new export after finding the exact optional initialViewId mismatch. No original test was removed or weakened. The surface-opening mutation remains pending, not covered.
- Removed the now-unused Routines TKey alias when its host unavailable-copy map stayed out.
- Preserved manifest formatting outside new keys; removed whole-file JSON reformat noise.
- Removed unused copied test imports and cursor-request recording unrelated to the one retained stale-page case.
- Corrected moved relative slug import, imported type-query shadowing, and type-only array/presence assertions whose existing invariants guarantee values. Storage's existing state type explicitly admits the undefined values its unchanged statements store.
- Source-size reading found retained production files below 500 lines and their top-level functions below 80. This was source inspection, not lint/typechecking. No complexity or compilation pass is claimed.
- No original source/test deletion, re-export shell, new feature, flag, permission, trigger, theme/CSS change, suppression or lowered threshold.

## Verification and intake handoff

PARTIAL, unexecuted. Characterization additions: 17 files / 20 cases. No pass/fail or mutation result is known. Read-only evidence: immutable source blobs, current destination declarations, package exports and changed-file source review. Runtime validation is intentionally not run by dispatch instruction.

Final inventory: 80 changed/untracked files = 40 production sources, 17 test files, 8 package manifests, 14 minor changesets, and this handoff. No original tracked source/test deletion; source review found no host `@/` or `@tovu/` imports in the new production files. No compiler, lint, test or mutation execution backs that inspection.

Mandatory Opus work: A13/A18/A22/A24 checks; execute tests and named mutations; package intake/dependencies and G3 JSX/DOM setup (especially plugins/agent-plugins), with direct MCP intake in Tovu; finish the explicitly LEFT source cuts; resolve stopped anchors without relaxing the limits; run approved checks and the exact counter; commit from the working tree.

New subpaths to consume (39):

### @jini-ai/admin

- `shell/components/AssistantDock/DockCleanupHeader`
- `screens/menus/hooks/use-route-guarded-menu-editor.hooks`
- `screens/routines/Routines`
- `screens/routines/RoutineForm`
- `screens/routines/Routines.hooks`
- `screens/routines/RoutinesMount`
- `screens/routines/project-routine-row`
- `screens/routines/routines-api`
- `shell/hooks/use-conversation-deep-link`
- `screens/storage/StorageScreen`
- `screens/storage/api/storage-api`
- `screens/storage/api/screenshot-cleanup-api`
- `screens/storage/hooks/use-storage.hooks`
- `screens/storage/hooks/use-screenshot-cleanup.hooks`
- `shell/components/AssistantDock/hooks/agents-inventory.hooks`
- `shell/components/AssistantDock/hooks/runtime-access.hooks`
- `shell/components/AssistantDock/hooks/messages-change.hooks`

### @jini-ai/agent-plugins

- `react/use-agent-plugins.hooks`

### @jini-ai/chat

- `transports/ag-ui/approval-relay`
- `react/chat-cleanup/ChatCleanupPanel`
- `react/chat-cleanup/chat-cleanup.hooks`

### @jini-ai/cms

- `react/media/ExternalProvidersPanel`
- `react/media/MediaLoadMore`
- `react/media/chrome-playback-note`
- `react/media/media-icons`
- `react/media/use-media-provider-catalog.hooks`
- `react/media/hooks/use-grid-pages.hooks`
- `react/pages/hooks/use-preview-embed-ids.hooks`
- `react/posts/posts-list-rules`
- `react/posts/post-editor-rules`
- `react/posts/editor/notices/PostEditorNotices`
- `react/widgets/WidgetConfigFields/MediaContentEditor.hooks`
- `react/pages/page-editor-rules`

### @jini-ai/devops

- `deploy/react/download-dockerfile`
- `deploy/react/hooks/use-static-export.hooks`

### @jini-ai/integrations

- `react/credentials/access-token-forms`
- `react/credentials/other-credential-stores`

### @jini-ai/mcp

- `react/external-mcp/hooks/use-external-mcp-admissions.hooks`

### @jini-ai/plugins

- `react/PluginProviderSettingsDialog`
