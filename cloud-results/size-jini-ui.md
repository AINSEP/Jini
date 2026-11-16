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
