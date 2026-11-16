# size-jini-ui — PARTIAL (stopped at tool-call budget)

Branch: refactor/size-jini-ui (from origin/integ/wave-b). Every DONE function now passes eslint with no
size/complexity warning (max-lines-per-function 50), tsc adds no errors, and the tests beside the file pass.

## DONE (all now <= 50 lines; commit)
- InfoTip.hooks.tsx useInfoTip — 3617d55a
- AssetGrid.hooks.tsx useAssetGridView — 63d82642
- AssetGridToolbar.tsx AssetGridToolbar — ccb040e8
- useAssetGridLiveUpdates.ts useAssetGridLiveUpdates (+ useEffect callback#4) — 5f83326e
- useRubberBandDrag.ts useRubberBandDrag — f70168fd
- AssetTreeFileRow.tsx AssetTreeFileRow — ac218b6e
- useConnectorAuthorization.ts useConnectorAuthorization — cc02f618
- ListDetailPanel.tsx ListDetailPanel — 12959e28
- ResourceBoard.tsx ResourceBoard — 062dbc3f
- MarkdownSplitPane.tsx MarkdownSplitPane — d9c136a4
- useFileDropzone.ts useFileDropzone — 192e9e02
- html-editor/css.ts prettifyCss — 1ed15528
- useSketchSaveWorkflow.ts useSketchSaveWorkflow — 0b3afeea

## SKIPPED
- use-execution-credential.hooks.ts useExecutionCredential: viewed; heavily coupled closures (serial write lane,
  settlement generations) need a careful design split — left for a fresh run.

## NOT REACHED
Everything else in jini-ui.txt, in list order after useFileDropzone/prettifyCss: useExecutionTab,
useInteractiveHtmlEditor (+effect), useMediaProvidersTab, memory/* (all 9), useMentionAutocomplete,
project-locations (2), ResourceBoardToolbar, useResourceBoard, useResourceRowList, SketchEditor, useSkillsTab,
useSourceConfigList, tab-launcher-menu (2), useTabStripDragReorder, version-manager (3), CommentSidePanel (2),
useMarkdownScrollSync, OnboardingDropdown, TooltipLayer (2), useResizableSplitPane, AnnotationDock,
useAnnotationCanvas (739), usePreviewModalShell.

## size-debt entries now removable (scripts/size-debt.json; not edited here)
The 13 functions above (file + function keys for max-lines-per-function). Also any complexity entries for them.
`node scripts/check-size.mjs` prints "Remove stale debt entry" for each; I only confirmed it for useInfoTip.

## Pre-existing failures (identical on base)
- `tsc --noEmit` in packages/ui: 8 errors in __tests__ and fake-ui-kit.tsx (so `pnpm --filter @jini-ai/ui build` fails).
- admin-widgets Select.unit / Select.portal tests: 52 failures, same count with my change stashed.


---

# Continuation run (2026-11-16) — PARTIAL (stopped at tool-call / context budget)

Branch: refactor/size-jini-ui. Every function below now passes eslint with no size/complexity warning
(max-lines-per-function 50), `tsc --noEmit` in packages/ui adds no errors (only the 8 pre-existing ones in
__tests__/fake-ui-kit), and the tests beside each file pass (or fail identically on the unmodified tree — see
"Pre-existing failures"). One commit per file; last pushed commit is listed in the final message.

## DONE (commit)
- useMentionAutocomplete.ts useMentionAutocomplete — 1ad5867f
- ResourceBoardToolbar.tsx ResourceBoardToolbar — 1e5e6fc7
- useResourceRowList.ts useResourceRowList — 92a7cde2
- TabLauncherMenu.tsx TabLauncherMenu — f3a8cdea
- useTabLauncherMenu.ts useTabLauncherMenu — eb239aad
- ProjectLocationsTab.tsx ProjectLocationsTab — d7fc2db1
- useProjectLocationsTab.ts useProjectLocationsTab — 4d0079ce
- useSourceConfigList.ts useSourceConfigList — 7496d43a
- useTabStripDragReorder.ts useTabStripDragReorder — 342f038d
- VersionSidebar.tsx VersionSidebar — 0532324f
- VersionManagerModal.tsx VersionManagerModal — f0ae08be
- useVersionManager.ts useVersionManager (+ new sibling useVersionManager.state.ts) — 78f11590
- CommentSidePanel.tsx CommentSidePanel + CommentSideItem — bbd7db29
- useMarkdownScrollSync.ts useMarkdownScrollSync — 5ee8579e
- OnboardingDropdown.tsx useOnboardingDropdown — f0bbf596
- TooltipLayer.tsx useTooltipLayer (+ useEffect callback#3) — f0cf32b2
- useResizableSplitPane.ts useResizableSplitPane — c98c09b9
- AnnotationCanvas.tsx AnnotationDock — 46db0fd2
- usePreviewModalShell.ts usePreviewModalShell — 129598a8
- SketchEditor.tsx SketchEditor — c5bb3446
- memory/dependencies.ts createMemoryHttpPorts — bd85bfaa
- MemoryAdvancedModal.tsx MemoryAdvancedModal — ac3f1aed (footer prop-type fix landed in 0c0275b8)
- MemoryManualEditor.tsx MemoryManualEditor — 0c0275b8
- MemoryConnectedPanel.tsx MemoryConnectedPanel — 93d7c8a8
- useMemoryConfig.hooks.ts useMemoryConfig — 64c8821a
- useMemoryConnectors.hooks.ts useMemoryConnectors (+ new sibling useMemoryConnectors.parts.hooks.ts;
  `saveSelectedConnectorSuggestions` moved there and re-exported by name from the original file so the public
  import path is unchanged) — 8157e8e5
- useMemoryEntries.hooks.ts useMemoryEntries — 1a08ad8b
- useMemoryExtractions.hooks.ts useMemoryExtractions — ed38fe99
- useMemoryExtractions.store.ts createExtractionHistoryStore (closure state -> explicit StoreState + module
  functions) — 497010f9
- useResourceBoard.ts useResourceBoard — f6642729
- useExecutionTab.ts useExecutionTab — 924cdd65

## SKIPPED
- use-execution-credential.hooks.ts useExecutionCredential (130 lines): still left from the previous run; same
  reason (serial write lane / settlement generations closures need a careful design split).

## NOT REACHED (still > 80 lines per a package-wide eslint pass at the end of this run)
- useInteractiveHtmlEditor.ts useInteractiveHtmlEditor (122) + its useEffect callback (106)
- useMediaProvidersTab.ts useMediaProvidersTab (168)
- useSkillsTab.ts useSkillsTab (260)
- useAnnotationCanvas.ts useAnnotationCanvas (739; closure-heavy: strokes/boxes/text-mark refs shared by pointer,
  keyboard, capture and submit flows — needs a ref-bundle + several sub-hooks)
- use-execution-credential.hooks.ts useExecutionCredential (see SKIPPED)
Other >=80-line functions the lint still reports (Select, mountChart, ConnectorDetailDrawer, mcp-ui scripts,
useSettingsSlice, useStandingDraftAutosave, CustomSelect, ...) are not in jini-ui.txt and were left alone.

## size-debt entries now removable (scripts/size-debt.json; NOT edited here)
Every function in the DONE list above (file + function keys for max-lines-per-function), plus any complexity
entries for them. Functions that were between 50 and 80 lines and are not in the list (e.g.
OnboardingDropdown, CommentSideCreateForm, MemorySuggestionPanel, TextMarkItem, SubmitPicker) still emit the
50-line warning and keep their entries.

## Notes for reviewers
- Behaviour-preserving splits only; where a first split broke a test it was fixed before commit (e.g. a duplicated
  load effect in useResourceBoard, a missing prop in MemoryConnectedPanel, a footer prop type in
  MemoryAdvancedModal).
- No new eslint-disable, no exported name / public signature changes. File sizes: useResizableSplitPane.ts 490
  lines, useMemoryEntries.hooks.ts 476; CommentSidePanel.tsx and useMemoryConnectors.hooks.ts were already >500
  before this run.

## Pre-existing failures (identical on the unmodified tree)
- `tsc --noEmit` in packages/ui: 8 errors in __tests__ and fake-ui-kit.tsx (so `pnpm --filter @jini-ai/ui build`
  fails).
- admin-widgets Select tests: 52 failures (from the previous run).
- features/source-config-list: 118 failing tests (SourceConfigList.test.tsx, Select-backed) — same count with my
  change stashed.
- features/execution: 141 failing tests across ByokProviderForm / ExecutionTab / LocalCliAgentCard /
  SearchableModelSelect tests — same 141 with my change stashed (hook tests pass).
