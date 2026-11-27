# M26SI — Jini sheets 6 and 7

Working tree delivery only; the coordinator commits. No installs, builds, tests, typechecks, linters or guard runs are authorized here. Regression tests are written before production edits; RED/GREEN and mutation execution are deferred to Opus.

## 1. Sheet 6 — editor view dependency injection

Status: implemented; static diff review complete. Runtime/typecheck/guard acceptance is deferred to Opus.

Files: packages/admin/src/pages/{PageEditor.tsx,PageEditorChrome.tsx,PageEditorNotices.tsx,PageEditorPane.tsx,PageEditorPreview.tsx,page-route-rules.ts,__tests__/y5-page-editor.test.tsx}; packages/admin/src/screens/email/{EmailTemplateEditor.tsx,__tests__/EmailTemplateEditor.unit.test.tsx}.

Tests first: supplied picker sentinel, picker conversion, conflict/stale messages, preview video lookup and sandbox in both branches, page preview widths and protected-element function, and email frame/toggle/width/sandbox. Existing binder/mount fixtures supply the original implementations.

Named mutations: replace each injected view dependency with its previous direct import; specifically set PagePreviewFrame's POST or GET sandbox back to PAGE_PREVIEW_IFRAME_SANDBOX, call imported pagePreviewYoutubeIds instead of deps.pagePreviewYoutubeIds, use the imported sentinel in pagePickerValue, call imported pickerValueToChoice or notice-message functions, use imported DEVICE_PREVIEW_WIDTHS/isProtectedEmbedElement in the page pane, or render imported Email DevicePreviewFrame/Toggle or use imported widths/sandbox. The corresponding injected-call/output assertions must turn red.

## 2. Sheet 7 — page editor hook dependency injection

Status: implemented; static diff review complete. Runtime/typecheck/guard acceptance is deferred to Opus.

Files: packages/admin/src/pages/hooks/{use-page-editor.hooks.ts,page-editor-recovery.hooks.ts,page-editor-workspace.hooks.ts,page-editor-load.hooks.ts,page-editor-preview.hooks.ts,page-editor-actions.hooks.ts}; packages/admin/src/pages/__tests__/y5-page-editor.test.tsx.

Tests first: host load/template/redirect/editable rules, memoized describer, display-only formatting on HTML entry, dirty-body rule, preview target, autosave builder, recovery/refresh rules, save-plan/success/unchanged/partial messages, external refresh formatting and restored-draft formatting. Fixture uses real implementations, with spies at the injected seams.

Named mutations: bypass any required hook dependency using its old direct import; in particular use imported prettifyHtml for tab entry or restored drafts, pageEditableHtml for hydration/external refresh, or pageSaveSuccessMessage/pageUnchangedSaveMessage/pagePartialSaveMessage in save-result handlers. Injected-call and display/working-copy assertions must turn red.

## Scope and review

Only sheets 6 and 7 are assigned. Sheets 1–5 and 8–12 are outside this dispatch; sheet 11 explicitly belongs to the build coordinator. No .git writes, guard/config/theme edits, re-export shells or implementation moves were made. No new public subpaths/exports are needed.

Final diff review deletions: removed only superseded value imports (or converted retained type dependencies to type-only imports) in the named consumers. No behavior, why-comments, tests or unrelated code deleted. Removed extra blank lines left by those import removals. No new helpers, wrappers, interfaces, named types or exports.

Static architecture audit: source wiring matches the approved sheets. The targeted hook modules retain only type references to the previous rule owners. Both applyLoadedPage callers pass the required object, and usePageEditorPreview passes pageAcceptsHtmlBody into computeContentDirty. Existing effect/callback statements, save-result handler order, memoized describer/live pluginEmbeds ref, iframe keys, form fields and theme behavior are retained. No guard/isolation files changed. This is source review, not an executed guard result.

Tests declared: y5-page-editor.test.tsx 6 -> 9; EmailTemplateEditor.unit.test.tsx 1 -> 1 (existing cases extended). Three tests added, none deleted/skipped; 10 total declared in the two touched files. No tests/mutations or runtime/quality commands executed, as dispatched. Test completion requires the coordinator's run.

## Host handoff — existing public subpaths only

- bindPageEditor deps: pickerValueToChoice, THEME_DEFAULT_SENTINEL, pageAutosaveStaleBasisMessage, pageVersionConflictMessage and previewIframeSandbox (PAGE_PREVIEW_IFRAME_SANDBOX) from @jini-ai/admin/pages/page-editor-rules; devicePreviewWidths (DEVICE_PREVIEW_WIDTHS) from @jini-ai/admin/shell/components/DevicePreview/DevicePreview.hooks; isProtectedEmbedElement from @jini-ai/admin/pages/lib/embed-placeholder; pagePreviewYoutubeIds from @jini-ai/admin/pages/lib/page-preview-youtube.
- createPageRouteRules deps: THEME_DEFAULT_SENTINEL from the same page-editor-rules subpath. Direct PagePreview mounts require deps.{videoLink,pagePreviewYoutubeIds,previewIframeSandbox}.
- EmailTemplateEditor kit: DevicePreviewFrame and DevicePreviewToggle from @jini-ai/admin/shell/components/DevicePreview/{DevicePreviewFrame,DevicePreviewToggle}; deps: devicePreviewWidths and previewIframeSandbox from the same original sources as Pages. Keep all existing hook and translator bindings.
- bindPageEditorHooks deps: pageDirtyGuardBaseline, pageRefreshMayHaveUnsavedEdits, pageEditableHtml, pageAcceptsHtmlBody, pagePreviewFormTarget, buildPageAutosaveDraft, buildPageSavePlan, pagePartialSaveMessage, pageSaveSuccessMessage and pageUnchangedSaveMessage from @jini-ai/admin/pages/page-editor-rules; prettifyHtml from @jini-ai/admin/pages/lib/prettify-html; createEmbedPlaceholderDescriber from @jini-ai/admin/pages/lib/embed-placeholder; unchangedSaveHandlers, slugRedirectPath and editorTemplateOptions from @jini-ai/admin/shell/lib/{unchanged-save-warning,slug-redirect-path,editor-template-options.rules}. Pass the bound hook as hooks.usePageEditorHook as before.

No sheet blocked or stopped. All other sheets remain with their assigned dispatches.
