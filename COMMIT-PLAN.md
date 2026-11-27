# Y5 adm — Jini working-tree delivery

No commits, installs, builds, tests, typechecks, linters, or counters are run in this dispatch. `.git` and Tovu remain untouched. Tests are written before production edits; mutations below are specified for the coordinator to run, not claimed red here.

Base: codex/y5-admj at 7b30ee0920ac8c2c4f10ccaeca23aaad1a4ae6b0. `git ls-remote origin refs/heads/codex/m25-tipj` confirms that exact SHA. Host sources come from Tovu 48f6802924, not the later live working tree.

## 1. adm-shell-lib

Jini codec extraction implemented; not runtime verified.

Files:
- packages/admin/src/core/__tests__/y5-settings-tabs.test.ts (written first)
- packages/admin/src/core/settings-tabs.ts
- packages/admin/src/core/settings-tab-preferences.ts
- packages/admin/src/core/settings-tab-privacy.ts
- packages/admin/src/core/settings-tab-appearance.ts
- packages/admin/package.json
- .changeset/y5-adm-shell-lib.md

Mutation DEFER_WITHDRAWAL_UNTIL_WRITE: move `deps.onMetricsWithdrawal()` after the awaited metrics write in settings-tab-privacy.ts. The first-write-failure test must fail because the immediate denial disappears. Not executed (dispatch prohibits all test execution).

New path: @jini-ai/admin/core/settings-tabs (universal, source export).

Tovu needs: one createSettingsTabs({ deps }) binding with its existing ledger adapters, defaults, interface namespace, legacy theme ID, normalizer, and privacy withdrawal/durable-success callbacks. Its retained API is not counted here because this job may not edit Tovu.

Read-only review: primitives reuse core/ledger-slice.ts; no new dependency edges; privacy denial precedes durable write and confirmed metrics signal precedes remaining writes. Bound legacy save pairs retain their positional signatures for unchanged theme consumers. No code deleted from Tovu.

## Deletions during final scope review

- Removed the old private createPostPublicPath factory from routing.ts after lifting its implementation into the new public-path leaf.
- Removed the unused DEFAULT_PRIVACY factory input; privacy's existing sentinel/fallback logic is unchanged.
- Removed copied orphan comments describing constants/catalog exports that remain host-owned, from the new private codec files. Their host declarations and rationale were not changed.
- Removed unused context members from the extracted MCP source actions and the unnecessary joinArgs export.
- Dropped the source preview's unused UI Icon import; the moved PagePreview never renders it. Required frame and embed collaborators are injected.
- Restored unrelated manifest Unicode formatting introduced by JSON serialization; only requested entry rows remain changed.
- No existing tests or Tovu files were deleted.

## 2. adm-shell-hooks

Jini binding implemented; not runtime verified.

Files:
- packages/admin/src/react/shell/__tests__/y5-appearance-binding.test.tsx (written first)
- packages/admin/src/react/shell/appearance.ts
- .changeset/y5-adm-shell-hooks.md

Existing export extended: @jini-ai/admin/react/shell/appearance now exports bindAdminAppearance({ hooks, deps }). The required hooks are the theme-state, appearance-snapshot and invalidate hooks. Required deps carry the namespace, load, refresh bus, preview clock, painter, accent resolver and lazy root getter. The binder owns one shared draft store and namespace filtering. Root and port overrides remain on the bound hook.

Mutation RETIRE_NEWER_DRAFT: reverse `draft.version <= readVersion` in the existing engine. The second bound-hook test must fail because second-theme draft version 2 is retired by accepted read version 1. Not executed.

Tovu needs one factory call destructuring the returned hooks; no theme edits or new package paths. No Tovu keep entry can be asserted by this Jini-only dispatch.

## 3. adm-shell-components — partial

Implemented Jini execution binder/filter and media-content view/binder. Dock state, dock component and pane extraction remain open; no completion/count claim for this sheet.

Files:
- packages/admin/src/shell/components/AssistantDock/__tests__/y5-dock.test.tsx (filter test written first)
- packages/admin/src/shell/components/AssistantDock/hooks/execution-config.hooks.ts
- packages/admin/src/shell/components/AssistantDock/hooks/execution-config-refresh.ts
- packages/cms/src/react/widgets/WidgetConfigFields/__tests__/y5-media-content-editor.test.tsx (written first)
- packages/cms/src/react/widgets/WidgetConfigFields/MediaContentEditor.tsx
- packages/cms/package.json
- .changeset/y5-adm-shell-components.md

Exports:
- existing @jini-ai/admin/shell/components/AssistantDock/hooks/execution-config.hooks: bindExecutionConfig
- existing @jini-ai/admin/shell/components/AssistantDock/hooks/execution-config-refresh: subscribeStoredKeyRefresh
- new @jini-ai/cms/react/widgets/WidgetConfigFields/MediaContentEditor: MediaContentEditor, MediaContentEditorProps, bindMediaContentEditor

The CMS leaf copies HtmlAttributeRows browser/isolation/exports registration. No admin/ui/ui-kit imports are introduced into CMS. The host must supply every kit piece, preview/picker/tab-keyboard hook, port, locale and tab-index rule.

Named mutation ADOPT_AFTER_DISPATCH is not yet covered: adoption lives behind the host transport collaborator; the dock state/pane tests and extraction remain outstanding. Filter/config tests do not claim to prove first-turn durability.

## 4. adm-security — partial

Built only the two independently movable dialog hooks and their existing view types. No store/controller/tab/security factory completion claim.

Files:
- packages/admin/src/security/host/__tests__/y5-live-secrets.test.tsx (written first)
- packages/admin/src/security/host/AccessTokensTab.hooks.ts
- packages/admin/package.json
- .changeset/y5-adm-security.md

New path: @jini-ai/admin/security/host/AccessTokensTab.hooks, browser/source. Exports useRemoveConfirmDialog, useAddCustomCredentialDialog, RemoveConfirmDialogActions and AddCustomCredentialDialogState. The add-dialog hook now takes ({ ref, controller }, _optional = {}). Controllers are structural subsets and supplied, not hidden defaults.

Tests verify close-before-remove, required custom token readiness, failed save retaining the dialog, and explicit close resetting the form. Neither REMOVE_DEFAULT_WITHOUT_PROMOTION nor REVOKE_UPSTREAM_ON_LOCAL_REMOVE is covered or executed: the store controllers have not been built. Five-query bootstrap, promotion/reconciliation, partial-store/serial writes, search counts, merged ordering, AccessTokensTab and bindSecurity remain outstanding. Tovu must not delete or repoint the complete dialog-hook module until useMergedSecretsOrder is also delivered.

## 5. adm-other — partial

Built email facts/navigation, storage binding helpers, and external MCP controller/form/actions. Media, plugin, provider, settings and MCP panel views plus admissions binder remain outstanding.

Files:
- packages/admin/src/screens/__tests__/y5-admin-surfaces.test.tsx (written first)
- packages/admin/src/screens/email/EmailSenderTab.tsx
- packages/admin/src/screens/email/Email.hooks.ts
- packages/admin/src/screens/storage/storage-screen-bindings.tsx
- packages/mcp/src/react/external-mcp/__tests__/y5-external-mcp.test.tsx (written first)
- packages/mcp/src/react/external-mcp/hooks/use-external-mcp.hooks.ts
- packages/mcp/src/react/external-mcp/hooks/external-mcp-form.rules.ts (private)
- packages/mcp/src/react/external-mcp/hooks/external-mcp-source-actions.ts (private)
- packages/admin/package.json
- packages/mcp/package.json
- .changeset/y5-adm-other.md

Exports:
- existing @jini-ai/admin/screens/email/EmailSenderTab: EmailStatusFacts
- existing @jini-ai/admin/screens/email/Email.hooks: createEmailNavigate
- new @jini-ai/admin/screens/storage/storage-screen-bindings: bindStorageScreen, localizeStorageLinks, createStorageReporter
- new @jini-ai/mcp/react/external-mcp/hooks/use-external-mcp.hooks: useExternalMcp, ExternalMcpController, ExternalMcpPort, describeStoredCredentials, toAccessTokenWriteBody, bindExternalMcp

Mutation EXTERNAL_MCP_LOST_UPDATE: remove expectedVersionOf's spread from updateSource's saved body in external-mcp-source-actions.ts. The saved-update test's expectedVersion: 7 assertion must fail. Not executed.

MCP uses only React and core value imports. UI/host form/credential/error/version rules and serial-write/locale hooks are required inputs; Date.now is injected as now. The five original source actions retain their order, keyed update lane, stored-version guard, omission rules and probe-after-changed-token behavior. Opening Tools is a panel responsibility still outstanding; the test proves roster loading and a non-token conflict do not probe, not the unbuilt Tools UI.

Tovu needs createEmailNavigate({ deps: { navigate, routePath, tabKey, partKey } }); EmailStatusFacts in KIT; bindStorageScreen's exact current links/copy/labels/age/anchor/client/clock/kit/hooks; and bindExternalMcp({ hooks, deps }). Standalone credential projections take their injected deps in the required object. New MCP port is structural, not typeof the host API.

## 6. adm-deployment — partial

Built only bindStaticExport on the existing lifecycle hook. StaticSiteTab, publish credentials and static publish controller remain outstanding.

Files:
- packages/devops/src/deploy/react/__tests__/y5-static-site.test.tsx (written first)
- packages/devops/src/deploy/react/hooks/use-static-export.hooks.ts
- .changeset/y5-adm-deployment.md

Existing path @jini-ai/devops/deploy/react/hooks/use-static-export.hooks now exports bindStaticExport({ hooks, deps }). The host provides useLocaleHook/query/refresh hooks and port/translate/error-copy/clock deps. Tests cover refusal without forcing clean, running/completed progress and unmount timer cleanup.

ACCEPT_STALE_PREVIEW is not covered or executed because checkPreview's client controller has not been extracted. Credential edit/verify/picker persistence, stale preview, publish duplicate guard and publish failure-limit cases remain outstanding. No server deployment contract or composition file was touched.

## 7. adm-pages — partial

Built public path, admin route/menu/picker rules and PagePreview. Main editor, controller and controller splits remain outstanding.

Files:
- packages/admin/src/pages/__tests__/y5-page-editor.test.tsx (written first)
- packages/cms/src/routing/__tests__/y5-public-path.test.ts (written first)
- packages/admin/src/pages/page-route-rules.ts
- packages/admin/src/pages/PageEditorPreview.tsx
- packages/cms/src/routing/public-path.ts
- packages/cms/src/routing/routing.ts
- packages/admin/package.json
- packages/cms/package.json
- .changeset/y5-adm-pages.md

New paths:
- @jini-ai/admin/pages/page-route-rules: createPageRouteRules, PageAdminHandle, ThemePageRowMenuHandlers
- @jini-ai/admin/pages/PageEditorPreview: PagePreview, PreviewEmbeds
- @jini-ai/cms/routing/public-path: postPublicPath

createRouting now uses the same postPublicPath function; its old private factory was removed. PagePreview requires hooks.usePreviewEmbedIds/useThemePreviewFrameHook, kit.DevicePreviewFrame and deps.videoLink. It preserves merged/deduped ids, GET URL/slug/version key, hidden POST bodyHtml, target/name, sandbox, referrer policy and frame load callback.

Mutation BODY_WRITE_BEFORE_CAS: move writePage's HTML write before updatePost's version-checked metadata call in the existing CMS page-editor-save leaf. The new metadata-conflict test must fail because it asserts updatePageHtml was never invoked. Not executed. A second test asserts PageBodyWriteError identity/saved row/reason after an HTML failure. This tests the reused helper; it does not claim the unbuilt controller integrates it.

Remaining cases: untouched authored documents, pending flush, dirty external update and full editor surfaces. No theme or preview-bus files touched. Tovu can consume the new pure rules/preview when its dependent editor binding is ready.

## 8. adm-posts — partial; trash CAS case stopped

Built raw list controller and input rules. Posts view/columns/trash-confirm composition remains outstanding.

Files:
- packages/admin/src/posts/__tests__/y5-post-list.test.tsx (written first)
- packages/admin/src/posts/hooks/use-posts.hooks.ts
- packages/cms/src/react/posts/__tests__/y5-post-editor-input.test.ts (written first)
- packages/cms/src/react/posts/post-editor-input.rules.ts
- packages/admin/package.json
- packages/cms/package.json
- .changeset/y5-adm-posts.md

New paths:
- @jini-ai/admin/posts/hooks/use-posts.hooks: usePosts, PostsController, usePostRowMenuHandleMap, bindPostsHooks
- @jini-ai/cms/react/posts/post-editor-input.rules: readFileAsDataUrl, droppedUri, overridesThemePageFromSelectValue, overridesThemePageSelectValue, toolbarBtnClass, hexOrDefault, ToolbarSelectOption, FONT_FAMILY_OPTIONS, FONT_SIZE_OPTIONS, LINE_HEIGHT_OPTIONS, CODE_LANGUAGE_OPTIONS, handleImageDrop, withTitleNode, titleNodeText, showsCoverImageSlot, showsHideCoverInBodyToggle

Mutation DROP_POST_EXPECTED_VERSION: remove expectedVersion from togglePostPublish's update patch. The explicit version-7 assertion must fail. Not executed. Tests also cover initial/action error distinction, successful cache refresh, create navigation, file rejection, external/internal drop and title attributes.

Exact stopped case: Tovu 48f6802924 use-posts.hooks.ts L214 calls port.deletePost({ id: post.id }); pinned Jini posts-list-port.hooks.ts declares deletePost({ id }) with no expectedVersion input. Adding CAS to trash would change the unchanged-behavior design and its existing port, so that requested case is not implemented. Original removal behavior is preserved. Sorting belongs to the unbuilt view.

Tovu needs required query/cache/mutation/refresh/locale hooks and list/navigation/copy/resource/handle-builder deps. Bind createRoutePath with today's /posts?create=1. Reader uses readFileAsDataUrl({ file, deps: { createReader } }); URL drops use handleImageDrop({ view, event, moved, deps: { insertImageAtDrop } }). The CMS rule is universal, has no React/TipTap value import and never constructs FileReader. CSS class strings/options are unchanged.

## 9. adm-publish-content — partial

Built only the requested public entry for the already-existing report rules. Dialog, ceremony controller and all ceremony tests remain outstanding.

Files:
- packages/cms/package.json
- .changeset/y5-adm-publish-content.md

New universal path: @jini-ai/cms/react/publish-content/hooks/publish-content-confirm.rules, exporting existing overwriteTooltipFor, reportRowNote and reportRowPillClass. No duplicate rules were created. EXECUTE_BEFORE_CONFIRM is not covered or executed. No claim is made for peer discovery/selection, arming, close/switch races, replan or one-execute behavior.

## Current handoff status

PARTIAL. Only adm-shell-lib and adm-shell-hooks have their requested Jini production surfaces built; no sheet is runtime verified. The remaining seven sheets have the partial scope above. The sole source-contract blocker found is the trash CAS mismatch. Other listed missing work is unfinished, not represented as an invented source blocker, OPUS-only ruling, or a completed move.

Tovu was never modified. No retained host path was re-read after a binding edit, so no keep entry and no 37-file reduction claim is valid here. A future Tovu half must finish all bindings/deletions, importer/source-probe updates and literal-copy baseline changes before counting.

Fresh evidence is read-only git status/diff plus source/manifest inspection. No checks or named mutations were run, per the dispatch. Runtime, type and mutation results are INCONCLUSIVE until the coordinator's run.

Architecture review: source value imports stay within core/self plus existing React entry support; no dependency/peer/devDependency edge was added. The new CMS leaves copy isolation rows. Product routes/keys/copy are injected at new boundaries. Review remaining source size/function constraints and all newly added structural contracts during the coordinator's typecheck; these have not been mechanically verified.

Function assessment: codec/privacy, appearance binding, execution binding, storage binding, page rules/preview, post actions/input rules, MCP form/source actions and static export binding are INCONCLUSIVE due to forbidden runtime/type/lint verification. High-risk direct probes are represented by privacy failure ordering, versioned post/MCP updates, metadata-before-HTML and preview identity tests. No coverage number or no-findings disposition is claimed.


## Test inventory

28 new test declarations across 12 requested test files; zero existing tests removed or weakened. All tests were authored before their respective production extraction. No test was run. Missing y5-publish-ceremony.test.tsx remains explicitly outstanding rather than filled with a substitute state-machine-only test.

Mutations directly targeted by added assertions (not executed): DEFER_WITHDRAWAL_UNTIL_WRITE, RETIRE_NEWER_DRAFT, EXTERNAL_MCP_LOST_UPDATE, BODY_WRITE_BEFORE_CAS and DROP_POST_EXPECTED_VERSION. Missing mutations: ADOPT_AFTER_DISPATCH, both security mutations, ACCEPT_STALE_PREVIEW and EXECUTE_BEFORE_CONFIRM.

## Public path inventory for the Tovu coordinator

New paths:
1. @jini-ai/admin/core/settings-tabs
2. @jini-ai/admin/security/host/AccessTokensTab.hooks
3. @jini-ai/admin/screens/storage/storage-screen-bindings
4. @jini-ai/mcp/react/external-mcp/hooks/use-external-mcp.hooks
5. @jini-ai/admin/pages/page-route-rules
6. @jini-ai/admin/pages/PageEditorPreview
7. @jini-ai/cms/routing/public-path
8. @jini-ai/admin/posts/hooks/use-posts.hooks
9. @jini-ai/cms/react/posts/post-editor-input.rules
10. @jini-ai/cms/react/widgets/WidgetConfigFields/MediaContentEditor
11. @jini-ai/cms/react/publish-content/hooks/publish-content-confirm.rules

Extended paths:
- @jini-ai/admin/react/shell/appearance: bindAdminAppearance
- @jini-ai/admin/shell/components/AssistantDock/hooks/execution-config.hooks: bindExecutionConfig
- @jini-ai/admin/shell/components/AssistantDock/hooks/execution-config-refresh: subscribeStoredKeyRefresh
- @jini-ai/admin/screens/email/EmailSenderTab: EmailStatusFacts
- @jini-ai/admin/screens/email/Email.hooks: createEmailNavigate
- @jini-ai/devops/deploy/react/hooks/use-static-export.hooks: bindStaticExport
