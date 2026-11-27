# y5p-pages — Jini-only worktree delivery

## Commit order
1. `feat(admin): extract page editor view and controller` (adm-pages, the two dispatched files only).
   Tests first: extend `packages/admin/src/pages/__tests__/y5-page-editor.test.tsx` before production edits.
   Source: Tovu `48f6802924`, `apps/admin/src/features/pages/PageEditor.tsx` (L693) and `hooks/use-page-editor.hooks.ts` (L593); both primary anchors match.
   Existing preview, route rules, CMS save helpers, and public-path test are retained.

## Mutations
- Controller: **BODY_WRITE_BEFORE_CAS** — move the HTML request ahead of metadata version validation. The existing conflict test requires zero body writes after refused metadata; the new controller characterization checks the same injected save path.
- View: **DROP_PENDING_HTML_CHANGE** — omit `setHtml(e.target.value)` in the HTML pane. The new view characterization requires the exact edited source to reach both display draft and working HTML setters.
- Mutations and tests are NOT executed: dispatch explicitly forbids tests/builds/installs/typechecks/linters. Opus/cloud must execute them.

## Constraints
No commits, Git metadata writes, Tovu edits, subagents, new dependency edges, theme code moves, or preview-bus moves. Every host/CMS/UI collaborator is required. Existing hook/effect order and deferred reads must remain intact.

## Status
Implementation in progress. Final file list and audit follow at closeout.

## Delivery status and commit contents

One logical commit prepared, uncommitted: `feat(admin): extract page editor view and controller`.
No sheet stopped for an anchor mismatch. Only the dispatched two-file remainder of adm-pages was implemented; the other eight sheets are outside this job. No Tovu completion or counter drop is claimed.

Created:
- `packages/admin/src/pages/PageEditor.tsx`
- `packages/admin/src/pages/PageEditorChrome.tsx`
- `packages/admin/src/pages/PageEditorNotices.tsx`
- `packages/admin/src/pages/PageEditorPane.tsx`
- `packages/admin/src/pages/hooks/use-page-editor.hooks.ts`
- `packages/admin/src/pages/hooks/page-editor-load.hooks.ts`
- `packages/admin/src/pages/hooks/page-editor-workspace.hooks.ts`
- `packages/admin/src/pages/hooks/page-editor-actions.hooks.ts`
- `packages/admin/src/pages/hooks/page-editor-preview.hooks.ts`
- `packages/admin/src/pages/hooks/page-editor-recovery.hooks.ts`

Changed:
- `packages/admin/src/pages/__tests__/y5-page-editor.test.tsx`: three new characterization cases, six total (three pre-existing cases retained). Controller cases cover authored documents, metadata refusal, partial HTML failure, pending canvas flush, and dirty external refresh. View case checks exact HTML propagation to both setters. Existing preview/root-alias cases remain.
- `packages/admin/package.json`: source exports and browser entries for the two new public leaves; no dependency changes.
- `.changeset/y5-adm-pages.md`: extend the existing admin/CMS minor changeset with the editor/controller delivery.
- `packages/admin/src/pages/PageEditorPreview.tsx`: type-only acceptance of explicit `undefined` for the existing optional `bodyJson`, as the moved caller already passes it.
- `packages/cms/src/react/pages/hooks/page-editor-save.ts`: type-only acceptance of explicit `undefined` for `form.nextStatus`, preserving the original `applySavedPage` call under exact optional-property checking.

`COMMIT-PLAN.md` is coordinator scratch and must NOT be committed.

## Required binding inputs

`bindPageEditor({ hooks, kit, deps })` captures:
- hooks: `usePageEditorHook`, `useTabBarKeyboardHook`, `useThemePreviewFrameHook`, `usePreviewEmbedIds`, `useWiredTermPicker`, `useTermListReveal`.
- kit: `Icon`, `ConfirmDialog`, `InteractiveHtmlEditor`, `DevicePreviewFrame`, `DevicePreviewToggle`, `ViewTemplateButton`, `WiredThemePreviewReloadButton`, `TermPicker`, `SuggestInput`, `TemplateSourceModal`, `PageExternalChangeBanner`.
- deps: `siteUrl`, `pagePublicPath`, `pagePickerValue`, `resolveTabBarTabIndex`, `standingDraftRecoveryMessage`, `pageExternalChangeBindings`, `pageEditorSurface`, `videoLink`.
The returned screen retains the original slug and injected-hook override surface. Raw `PageEditor` has required hooks/kit/deps; no live hook defaults.

`bindPageEditorHooks({ hooks, deps })` returns `usePageEditor` and `useWiredPageEditor`:
- hooks: cache/mutation/invalidation, locale, device/width, dirty guard, settlement generation, screen context, external refresh, content refresh, standing drafts, wired interactive flush, wired HTML jump, theme canvas styling.
- deps: page/theme-canvas ports, navigation/translation, root handle/resource/admin path, canvas-template resolution, marker readers, CMS `writePage`/`applySavedPage`/`applySaveFailure`, the actual CMS `PageBodyWriteError` class, conflict/error classifiers, browser timers/document/window.
The returned raw hook retains `{ routeSlug, deps: { port, themeCanvasPort, navigate, t, locale } }` for the theme characterization fixture. Locale is called only by the wired hook. Pass the existing one-expression navigation adapter from the host.

## Tovu half still required

New public imports:
- `@jini-ai/admin/pages/PageEditor` (`PageEditor`, `PageEditorProps`, `bindPageEditor`).
- `@jini-ai/admin/pages/hooks/use-page-editor.hooks` (`usePageEditor`, `PageEditorController`, `PageEditorDependencies`, `bindPageEditorHooks`).

Bind the two host files with their original collaborators; preserve the theme test's injected surface. Repoint the content-refresh source probe to `../node_modules/@jini-ai/admin/src/pages/hooks/page-editor-recovery.hooks.ts`, where the actual subscription now lives. Review the two host bindings against G3, then append their exact anchored paths inside the Keep rules fence in `plans/count-1125/y5-adm-keeps.md`. This Jini-only work does not change Tovu, host importers, source probes, keep rules, or counters.

## Validation and integrity

- Source syntax parsed for the ten new production leaves and the characterization test. No parse diagnostics.
- `git diff --check`: clean. Manifest inspection confirms both source exports and browser classes and unchanged dependency maps.
- No tests, mutation runs, typechecks, lint, install, build, browser session, commits, pushes, or Git metadata writes were performed. Opus/cloud must execute the six cases and the two named mutations. Mutation sensitivity is designed, not proven.
- Ordering disclosure: controller characterizations were added before controller production code. The HTML-pane view case was completed after its production move; strict tests-first order was not achieved for that new view case. No RED/GREEN evidence is claimed.
- Source-only architecture audit: production imports are React, core, and same-package leaves; CMS/UI/host values are required injection inputs. The real CMS error class is retained; no replacement error class, dependency edge, theme implementation, preview bus, CSS, or persisted key was introduced.
- Function review: moved workflows retain original state/effect order, save settlement, deferred reads, timers, and error paths. Split functions use existing load/workspace/actions/preview/recovery and chrome/notices/pane seams. New files are below 500 lines; source function review stays below 50 non-comment/nonblank lines. Runtime/type validation remains INCONCLUSIVE by dispatch restriction.
- Resource behavior: unchanged initial page/presentation reads, one/two save requests, one refresh read, and one trailing 500ms preview timer. No additional polling or retained stores.
- Scope note: the two existing-leaf annotation changes above are type-only integration repairs. Original product references in moved comments were neutralized to satisfy the prohibition on product text in Jini.
- Diff cleanup deletions: removed unused generated imports/prop pads, a temporary private pane type alias, duplicate generated JSX injection attributes, and added projection null guards. No tracked source path or existing test was deleted; no assertion was weakened.

## Opus follow-up

Run tests and mutations, then the coordinator's normal type validation. The pre-existing preview utility `pages/lib/page-preview-youtube.ts` declares optional `bodyJson` without explicit `undefined`, while the existing preview calls it with that value; this older strict-optional typing mismatch is left unchanged outside the two-file extraction.
