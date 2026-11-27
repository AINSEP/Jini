# X4 admin round 2 — Jini working-tree handoff

PARTIAL. Baseline `984a319b4adc3ea78ea148e6cb50e7ba5d875bd8`, branch `codex/x4g-adminj`. Coordinator commits; **do not commit this ledger**. Jini only; Tovu and Git metadata untouched. No subagents, package intake, tests/mutations, installs, builds, typechecks, linters, commits or pushes.

The explicit dispatch overrides missing-toolkit startup, pipeline, approval and execution defaults. Read the dispatched programmer skills, implementation guardrails, pattern priming, architecture decisions, coding foundations, general behavior and honest-testing skill. Supplied sheets override their broader workflow requirements. Read local locked architecture and the prior Jini handoff; re-opened current anchors at the read-only sibling `c-tv-x4f-admin/apps/admin/src`. No graph MCP or repository-wide search.

Before every edit: named units only; no new dependency edges; required hooks; structural types for undeclared package types; verbatim moved statements/comments except required injection/import/signature changes; no new validations or fallbacks; <=80-line functions, <=10 complexity, <=500-line files; unchanged theme/flags/wire bytes. Existing characterization pins were read before the independent A22/A24 moves; no redundant test cases added.

## Ordered coordinator commits and file lists

### 1. A06 — execution refresh correction, partial

A `packages/admin/src/shell/components/AssistantDock/hooks/__tests__/execution-config-refresh.unit.test.ts`
A `packages/admin/src/shell/components/AssistantDock/hooks/execution-config-refresh.ts`
M `packages/admin/package.json`
M `.changeset/x4-a06.md`

Test FIRST: one new case for hidden/visible visibility, focus, namespace filtering and disposal. Mutation **exec-config-skip-visibility-revalidate** removes the visibility listener; the visible refresh count fails. Not executed.

Current source matches `subscribeExecutionConfigRefresh` at :62–84. Moved its comment, registration, filtering and disposal statements in the same order. Required `deps.window`, `deps.document`, `deps.subscribeToSettingsRefresh`, `deps.EXECUTION_NAMESPACE`; existing `revalidate` argument. New entry `admin/shell/components/AssistantDock/hooks/execution-config-refresh`, browser, with exports/entries/typesVersions.

This closes the missing focus/visibility entry, not the entire host file's G3 gate: its `storedKeyIo` event-only filter and `persistMode` useCallback still remain host behavior. Reusing the focus subscriber for stored keys would add refresh behavior; no such change was made.

### 2. A09 — picker locale injection, Jini side ready for the hook residual

M `packages/cms/src/react/widgets/WidgetPickerDialog/__tests__/WidgetPickerDialog.hooks.unit.test.tsx`
M `packages/cms/src/react/widgets/WidgetPickerDialog/WidgetPickerDialog.hooks.tsx`
M `.changeset/x4-a09.md`

Updated the existing select/cancel/reopen case FIRST to pass the required locale hook; same test/assertion count. Mutation **widget-create-on-select** creates on existing-selection change, violating the no-create assertions. Not executed.

`useWidgetPickerDialog` and `useWidgetAddControl` now take required `deps.useAdminLocaleHook` instead of a resolved `deps.locale`. The hook read precedes the original query/state calls, as in the current wired host wrappers. Internal `useExistingInstances` and `useWidgetPickerDraft` continue accepting locale data. Tovu's wired bindings pass its real hook; compatibility bindings pass a one-expression hook returning their existing optional locale/default. No second locale read, cache or default was added.

### 3. A19 — isolated list contracts and independent details modal

M `packages/agent-plugins/src/react/__tests__/use-agent-plugins.hooks.unit.test.tsx`
A `packages/agent-plugins/src/react/__tests__/AgentPluginDetailsModal.unit.test.tsx`
M `packages/agent-plugins/src/react/use-agent-plugins.hooks.ts`
A `packages/agent-plugins/src/react/AgentPluginDetailsModal.tsx`
M `packages/agent-plugins/package.json`
M `.changeset/x4-a19.md`

Existing stale-toggle case updated FIRST to reach the moved `useWiredAgentPlugins` through a required locale hook; all old assertions retained. Mutation **agent-plugins-replace-newer-toggle** lets the late list replace the confirmed enabled row.

One new details-modal case FIRST: selecting package files must not mount a listed Admin surface. Mutation **plugins-eager-open-surface** changes initialViewId to the first dynamically listed surface instead of only the originally supplied Manage surface; the surface spy and file-selection assertion fail. Not executed.

Removed undeclared admin/UI type imports from the list hook, using core FetchQueryAdapter and equivalent structural row/port/subscription types in the target file. Preserved the full files-list method and all row fields; existing `useAgentPlugins({locale,t,...})` remains available. Moved the already-named host `useWiredAgentPlugins` into the same owner with required `useAdminLocaleHook`, preserving locale → translator → list-hook order and the original why-comment. The host's wired residual can now be one package call.

Moved `AgentPluginDetailsModal` verbatim apart from DI/imports/signature: four required kit views, required `useHostAdminSurfaceFrame`, required existing hook props and required live surfacesPort. No admin/UI imports or runtime dependency additions. New browser entry `agent-plugins/react/AgentPluginDetailsModal`; no typesVersions exists in this package. AgentPlugins/Plugins screens remain stopped independently.

### 4. A22 — independent report-row move; controller stopped

A `packages/cms/src/react/publish-content/PublishContentDialog.hooks.tsx`
A `packages/cms/src/react/publish-content/hooks/publish-content-confirm.rules.ts`
M `packages/cms/package.json`
A `.changeset/x4-a22.md`

BEFORE moving, read existing Tovu `PublishContentDialog.unit.test.tsx:204–235,2253–2272`: opening/planning/refused confirmation execute nothing; a pending overwrite replan admits neither confirm nor execute. Named mutations **publish-execute-unconfirmed**, **publish-confirm-during-replan** remain at that held controller; not executed, not claimed covered by a new row test.

Current report-row function is **76 lines**, so the earlier blanket size stop no longer applies to this file. Moved its JSX, comments, checkbox guards and callback order unchanged. Its view argument is the structural projection it reads. Moved existing `overwriteTooltipFor`, `reportRowNote`, `DISPOSITION_PILL_CLASS`, `reportRowPillClass` verbatim into the named private rules owner; no unused controller/rules shell. Browser entry `cms/react/publish-content/PublishContentDialog.hooks` exposes the row. No CMS typesVersions exists. Tovu can repoint the row import and delete its original `.hooks.tsx` independently. The full dialog/controller remain held by the prescribed 194-line plan-selection cut.

### 5. A24 — independent other-credential entry and removal actions

A `packages/integrations/src/react/credentials/OtherCredentialsSection.hooks.tsx`
A `packages/integrations/src/react/credentials/OtherCredentialsSection.tsx`
M `packages/integrations/package.json`
M `.changeset/x4-a24.md`

BEFORE moving, read existing Tovu `OtherCredentialsSection.unit.test.tsx:138–182`: opening does not remove; Cancel closes without removing; confirmation removes exactly this row once and closes. Existing sheet mutations **security-serialize-blank-replacement**, **security-apply-earlier-reload**, **security-show-site-key-without-grant** remain in their original host/form suites. No added test cases or executed mutation results are claimed for this move.

Moved `useOtherCredentialRemoveDialog`, `rowHandleBase`, the existing row shape and `OtherCredentialRemoveDialogActions` into the named hook owner. Close then remove ordering and the existing ref cast/null guard are unchanged. The controller input structurally requires only its existing remove operation.

Moved the entry and existing private view functions without a dependency on the held loader/controller implementation. Required deps: `useAdminLocaleHook`, `useOtherCredentialRemoveDialogHook`, `removeDialogTitle`, `otherCredentialRemoveDialogBody`, `VIEWER_TIME_ZONE`, `REMOVE_FROM_TOVU`, `removeHandleLabel`. The last two inject the unchanged product copy; Tovu supplies `"Remove from Tovu"` and its original handle-label expression. Threaded deps through the existing children; retained all why-comments, disabled masked-value fields, explicit native confirmation and locale → removal-hook order. New browser exports/entries `integrations/react/credentials/OtherCredentialsSection{,.hooks}`. Mirrored both paths in integrations typesVersions. No credential store roster, default, API or secret behavior changed.

## Per-file inventory of all 48 supplied LEFT rows

All paths below are relative to Tovu `apps/admin/src`. LOC is the unchanged sibling residual, including comments/blank lines, not a claim about function complexity. **READY means Jini side available; Tovu deletion/pure-binding work and runtime validation are still pending.** No Tovu file is counted DONE here.

| Sheet | Tovu MOVE path | LOC | Jini side now / exact remaining blocker |
|---|---|---:|---|
| A03 | features/settings/SettingsUi.tsx | 760 | BLOCKED: screen/slice entries absent; depends on unresolved universal consent seam below. Current SettingsUi :281–680 also exceeds 80 before named tab cuts. |
| A03 | lib/settings-tabs.ts | 368 | BLOCKED: savePrivacy :284–321 does localStorage/CustomEvent effects before/between durable writes; universal destination's prescribed inputs do not place those effects at a host seam. |
| A03 | hooks/use-admin-appearance.hooks.ts | 46 | BLOCKED G3: painter already present; namespace-filter conditional remains in defaultPort. No named namespace-subscription seam supplied; no theme edit. |
| A04 | lib/durable-run-subscription.ts | 21 | BLOCKED G3: follower/activity owner exists; native schedule adapter :12–14 still creates timer/disposer in multiple statements. Existing browser factory requires schedule; no named additional timer owner supplied. |
| A06 | components/AssistantDock/AssistantDock.state.hooks.ts | 319 | BLOCKED G1: >15 live collaborators across :1–55, including folder deps, preference/permission/renderer/voice hooks, deep-link ports, execution adapters and browser-agent settings. |
| A06 | components/AssistantDock/AssistantDock.tsx | 236 | DEPENDENT: named composition entry absent; state contract above remains held. |
| A06 | components/AssistantDock/DockChatPane.tsx | 275 | DEPENDENT: named pane entry absent; dock/state contract above remains held. |
| A06 | components/AssistantDock/hooks/execution-config.hooks.ts | 124 | PARTIAL: focus/visibility refresh entry built; storedKeyIo's event-only scope filter and persistMode useCallback still prevent whole-file G3. |
| A07 | features/media/Media.tsx | 1577 | BLOCKED G1/size: >15 undeclared values; EditMediaPanel :318–518 remains ~201 lines after named file cut. No Q2 retarget answer supplied. |
| A07 | features/media/hooks/use-edit-media-panel.hooks.ts | 344 | BLOCKED: useEditMediaPanel :183–338 remains 156 lines; no further named function cuts for that body. |
| A07 | features/media/hooks/use-media.hooks.ts | 319 | BLOCKED: useMedia :171–312 remains 142 lines; named grid/write files alone do not specify an under-limit parent cut. |
| A09 | components/WidgetConfigFields/MediaContentEditor.tsx | 389 | DEPENDENT: view entry absent; current controller still imports 18 admin value members, exceeding G1. |
| A09 | components/WidgetPickerDialog/WidgetPickerDialog.hooks.tsx | 44 | READY: required locale-hook contract now permits pure wired/compatibility bindings. |
| A12 | features/deployment/StaticSiteTab.tsx | 1427 | BLOCKED: GettingItOnlineCard :520–620 is 101 lines after named component/file cuts; no further named view cut. |
| A12 | features/deployment/hooks/use-publish-credentials.hooks.ts | 456 | BLOCKED: usePublishCredentials :238–437 is 200 lines; named rows cut lacks the further function boundaries needed for <=80. |
| A12 | features/deployment/hooks/use-static-export.hooks.ts | 64 | DEPENDENT G3: Jini hook already present; host locale read and required fold into deployment-panel depend on absent StaticSiteTab; partial fold creates a panel/view cycle. |
| A12 | features/deployment/hooks/use-static-publish.hooks.ts | 406 | BLOCKED: useStaticPublish :144–373 is 230 lines; named preview/run files do not supply all under-limit function cuts. |
| A13 | features/email/Email.tsx | 243 | DEPENDENT: Email and Provider view entries still absent; Provider contract below prevents faithful fifth-tab move. |
| A13 | features/email/EmailProviderTab.tsx | 275 | BLOCKED contract: :210,213 pass plugin with pluginId and optional displayName; prescribed displayName({id}) loses that custom label. No redesigned contract invented. |
| A13 | features/email/EmailTemplateEditor.tsx | 306 | BLOCKED contract: existing Jini editor needs pageEditorT(key) pre-bound to resolved locale, but original order is controller → locale → view → keys. Existing createEmailPageTranslator needs locale data and supplies no hook seam preserving that order. |
| A18 | features/pages/PageEditor.tsx | 1111 | BLOCKED size: current PageEditorHeader :122–228 and PageEditorPane :951–1111 exceed 80 after named component cuts; no further named view children. |
| A18 | features/pages/PageEditorPreview.tsx | 334 | BLOCKED size: PagePreview :92–221 is 130 lines; named destination lacks further cuts. |
| A18 | features/pages/hooks/use-page-editor.hooks.ts | 1322 | BLOCKED cut size (NOT stale anchor): usePageEditor now starts at :593 and named boundaries match. Drafts :746–862 would be 117 lines with multiple hook declarations, not one over-limit callback; recipe does not name a further split preserving those hooks/comments. |
| A18 | features/pages/rules.ts | 239 | BLOCKED G3/hold: remaining pagePublicPath/pageAdminPath/theme row/picker branches are route/theme policy expressly retained. No theme behavior moved or keep claimed. |
| A19 | features/plugins/AgentPluginDetailsModal.tsx | 77 | READY: new isolated browser view; host can inject its existing kit/hooks/port at current callers and delete this path. |
| A19 | features/plugins/AgentPlugins.tsx | 540 | BLOCKED G1/size: >15 values targeting agent-plugins; AgentPluginsScreen :411–532 remains >80 despite existing List/Marketplace components. No Q2 retarget supplied. |
| A19 | features/plugins/Plugins.tsx | 505 | BLOCKED G1: >15 undeclared values/policy/view imports in :1–29; named row/overlay cuts do not authorize an oversized shared dependency bag or admin retarget. |
| A19 | features/plugins/hooks/use-agent-plugins.hooks.ts | 39 | READY: structural package-owned contracts and moved useWiredAgentPlugins accept required real locale hook; preserve the existing arbitrary t/locale API for non-wired callers. |
| A20 | features/posts/Posts.tsx | 213 | BLOCKED: Posts :57–213 remains >80; sheet names no further list-view child functions. |
| A20 | features/posts/hooks/use-posts.hooks.ts | 249 | BLOCKED: usePosts :99–242 remains 144 lines; named writes cut has no additional under-limit parent boundary. |
| A20 | features/posts/rules.ts | 319 | RICH-TEXT HOLD: remaining drop/title-node/EditorView and theme-picker/cover behavior; excluded from claimed drops. |
| A21 | features/routines/use-conversation-deep-link.ts | 31 | BLOCKED G3: query URL construction/mutation/replaceState remain multi-statement replaceBrowserQuery; no named browser-query owner supplied. Existing consume-once hook already present. |
| A22 | features/publish-content/PublishContentDialog.hooks.tsx | 82 | READY: report row and its three private presentation rules moved; new row entry has no dependency on held controller. |
| A22 | features/publish-content/PublishContentDialog.tsx | 439 | DEPENDENT: full dialog/report view not built while required confirm-view/controller contract remains held; row cut completed independently. |
| A22 | features/publish-content/hooks/use-publish-content-confirm.hooks.ts | 1289 | BLOCKED: prescribed usePublishPlanSelection :552–745 is 194 lines of state/refs plus four useCallback declarations. Each callback is under 80; callback-splitting permission does not split the enclosing hook. |
| A24 | features/security/AccessTokensTab.hooks.tsx | 198 | DEPENDENT: full credential-group/custom-draft/controller structural contracts await the stopped controller; independent OtherCredentials actions/view moved. |
| A24 | features/security/AccessTokensTab.tsx | 1072 | BLOCKED: TokenInputFields :494–610 is 117 lines; AddCustomCredentialDialog near :948–1072 remains >80 after prescribed top-level component cuts. |
| A24 | features/security/OtherCredentialsSection.hooks.tsx | 51 | READY: existing close/confirm and handle projection with full structural row shape; no loader dependency. |
| A24 | features/security/OtherCredentialsSection.tsx | 268 | READY: entry/private views, native confirm and masked field preserved; required hook/copy/time deps, no host imports. |
| A24 | features/security/Security.tsx | 140 | BLOCKED G3: :122–132 useMemo stabilizes injected panel identities; removing it remounts children. Existing package panels API provides no named replacement identity seam. |
| A24 | features/security/hooks/use-access-tokens.hooks.ts | 918 | BLOCKED anchor/G1: source useAccessTokens starts :386, not prescribed :383; :384 closes preceding writeCredential. Also 26 undeclared collaborators exceed G1. No shifted seed-effect cuts invented. |
| A24 | features/security/hooks/use-other-credentials.hooks.ts | 422 | BLOCKED: useOtherCredentials :191–285 remains 95 lines without a named further controller cut. Its read/load/replace semantics remain host-held. |
| A25 | features/providers/Providers.tsx | 330 | BLOCKED G1/size: >15 undeclared values/slots; ProvidersView :222–330 is 109 lines with no named further child cut or supplied Q2 retarget. Feature holds untouched. |
| A25 | features/settings/ExternalMcpSettingsPanel.hooks.tsx | 72 | ALREADY READY on HEAD: existing MCP useExternalMcpDriftCopy({useLocaleHook,translate}) handles the exact locale/useCallback adapter. Tovu can repoint; no duplicate/new Jini code. |
| A25 | features/settings/ExternalMcpSettingsPanel.tsx | 630 | BLOCKED G1: 23 undeclared value collaborators targeting MCP, above 15; no new runtime edges/retarget. |
| A25 | features/settings/hooks/use-external-mcp-admissions.hooks.ts | 42 | BLOCKED G1: existing Jini admissions hook still has 16 injected collaborators plus undeclared admin/UI type edges. Existing drift-copy owner alone does not clear this file. |
| A25 | features/settings/hooks/use-external-mcp.hooks.ts | 438 | BLOCKED: useExternalMcp :284–438 remains 155 lines; prescribed config/write files lack further named under-limit hook cuts. |
| A28 | features/storage/Storage.tsx | 93 | BLOCKED G3: locale hook, dynamic storageCopy/storageLinks and native Button adapter remain. Existing StorageScreen accepts resolved data/native Button; no named additional composition/adapter seam supplied. |

48 rows accounted for: **6 newly Jini-ready files + 1 already ready = 7 ready; 41 still blocked/dependent/partial/held.** A06 additionally advances its missing refresh substep. This is not a Tovu drop count. Original 30 deleted / 11 bindings / 48 left inventory is not rewritten by Jini-only edits.

## Tovu intake / caller work (no intake done here)

Five new browser subpaths:
- `@jini-ai/admin/shell/components/AssistantDock/hooks/execution-config-refresh`
- `@jini-ai/agent-plugins/react/AgentPluginDetailsModal`
- `@jini-ai/cms/react/publish-content/PublishContentDialog.hooks`
- `@jini-ai/integrations/react/credentials/OtherCredentialsSection`
- `@jini-ai/integrations/react/credentials/OtherCredentialsSection.hooks`

Existing paths: pass `deps.useAdminLocaleHook` to CMS picker/add-control hooks; import `useWiredAgentPlugins` and package-owned row types from the existing agent-plugin hook entry. Bind the modal's four kit views, host frame hook and surfaces port. Bind OtherCredentialEntry's seven required deps (including unchanged product labels and timezone), import its row/action types from the new hook entry, then delete both original OtherCredentialsSection files and update AccessTokensTab/tests. Repoint the standalone publish row, then delete its old report-row path. Do not create forwarding shells.

Existing MCP `useExternalMcpDriftCopy` is sufficient for its host translator residual. No changes to its package required.

## Final static review / limits / honesty

Architecture audit: **WARNING overall** because the stopped baseline files/type edges remain; changed/new owners use declared core/React imports or own-package imports and explicit injected hooks/values. No runtime dependency/version changes, server imports into browser paths, Tovu imports, theme files or feature flags. New entries are browser; admin and integrations typesVersions mirror their new paths; agent-plugins and CMS have no typesVersions.

Source assessment (not measured by lint): execution subscriber 28 lines; picker hooks 17/45/58/67; list/wired hooks 66/7; details modal 33; report row 76; report helpers <=10; removal hook 17; credential entry/private views <=80, with the whole view file 272. Largest changed production file is picker hook at 288. Existing source conditions/effect order retained. No empirical complexity/coverage/typecheck claim. Resource cost: execution refresh retains exactly two DOM listeners and one settings subscription until disposal, no new timers or requests; list/discovery polling behavior unchanged.

Tests: **2 new cases** (execution refresh, details modal), **2 existing cases updated** (picker cancellation and stale-toggle) with unchanged assertions. A22/A24 existing host cases were read before moves and require coordinator retarget/run; no fresh Jini test coverage claim for them. No tests deleted, skipped, weakened or suppressed; no config/coverage changes.

Review cleanup/deletions: no source files deleted in Jini. Removed undeclared admin/UI type imports from the agent-plugin controller; removed its unnecessary new public export of the structural base summary (kept the used row export); removed resolved locale inputs from the two picker composition hooks in favor of the required hook. Product copy constants became required injected values in the moved credential view. Removed the automatically copied CMS isolation/forbidden-import rows, which the sheet did not require, retaining only exports and jini.entries for the new path. No other cleanup/reformatting added.

Pre-completion: dispatch/sheets reread; all 48 host paths reopened for current LOC/declaration anchors; new/changed sources and manifest diffs read; package entry metadata read back. No test/mutation, build, install, typecheck, linter, package intake, commit or push ran. Runtime/typing/self-validation **NOT RUN by dispatch**. Coordinator must commit the working tree, retarget Tovu imports/mocks, perform intake, and execute named tests/mutations before acceptance. K0/Appendix B/counter work is not authorized in this Jini-only slice and was not fabricated.
