// @jini-ai/ui — generic, product-neutral UI primitives.
// See packages/ui/README.md for scope and packages/ui/source-map.md for
// provenance (multiple porting tasks land content here in parallel; see
// that file's per-section breakdown).
//
// Two feature domains with a heavy npm dependency are deliberately not re-exported here
// (2026-07-29): `sketch-editor` (`@excalidraw/excalidraw`, ~47MB — removed from this barrel,
// previously exported here and the reason any `@jini-ai/ui` import dragged Excalidraw in) and
// `lexical-rich-text-editor` (`lexical`/`@lexical/react`/`@lexical/utils` — never wired into this
// barrel at all, so it was actually unreachable dead code from outside this package until now).
// Both get their own `@jini-ai/ui/sketch-editor` / `@jini-ai/ui/lexical-rich-text-editor` entry
// points instead, so a consumer wanting e.g. `WorkingDirPicker`/`AgentIcon` never drags either
// in — import the specific subpath when you actually want that editor.

export * from './features/i18n/index.js';
export * from './features/observability/index.js';
export * from './features/connectors/index.js';
export * from './features/progress-card/index.js';
export * from './features/browser-chrome/index.js';
export * from './features/asset-grid/index.js';
export * from './features/asset-tree-browser/index.js';
export * from './features/viewer-shell/index.js';
export * from './features/version-manager/index.js';
export * from './features/html-viewer/index.js';
export * from './features/settings/dialog/index.js';
export * from './features/appearance/index.js';
export * from './features/notifications/index.js';
export * from './features/language/index.js';
export * from './features/instructions/index.js';
export * from './features/privacy/index.js';
export * from './features/integrations/index.js';
export * from './features/execution/index.js';
export * from './features/skills/index.js';
export * from './features/project-locations/index.js';
export * from './features/about/index.js';
export * from './features/media-providers/index.js';
export * from './features/list-detail-panel/index.js';
export * from './features/schedule-picker/index.js';
export * from './features/mention-autocomplete/index.js';
export * from './features/memory/index.js';
export * from './features/source-config-list/index.js';
export * from './features/external-mcp/index.js';
export * from './features/resource-dashboard/index.js';
export * from './features/iframe-pool/index.js';
export * from './features/command-palette/index.js';
export * from './features/tab-launcher-menu/index.js';
export * from './features/revision-review/index.js';
export * from './features/file-dropzone/index.js';
export * from './utils/index.js';
export * from './utils/timezone.js';
export * from './utils/zip.js';
export * from './utils/sse.js';
export * from './utils/copy-to-clipboard.js';
export * from './utils/appearance.js';
export * from './utils/dom-subscriptions.js';
export * from './utils/auto-open-file.js';
export * from './utils/localized-url.js';
export * from './utils/markdown-scroll-sync.js';
export * from './utils/polygon-selection.js';
export * from './utils/scroll-tabs-with-wheel.js';
export * from './utils/color-math.js';
export * from './utils/design-md.js';

export * from './react/hooks/useInView.js';
export * from './react/hooks/useCoalescedCallback.js';
export * from './react/hooks/useStableHandler.js';
export * from './react/hooks/useDebouncedValue.js';
export * from './react/hooks/useResizableSplitPane.js';
export * from './react/hooks/useBrandFonts.js';
export * from './react/hooks/useEdgeAutoScroll.js';

export * from './browser/useModalWindowDragGuard.js';

export * from './browser/index.js';

export * from './react/components/Icon.js';
export * from './react/components/RemixIcon.js';
export * from './react/components/AgentIcon.js';
export * from './react/components/Toast.js';
export * from './react/components/Loading.js';
export * from './react/components/TooltipLayer.js';
export * from './react/components/CustomSelect.js';
export * from './react/components/KitErrorBoundary.js';
export * from './react/components/LanguageMenu.js';
export * from './react/components/WorkingDirPicker.js';
export * from './react/components/AppChromeHeader.js';
export * from './react/components/ExportDiagnosticsButton.js';
export * from './react/components/PaletteTweaks.js';
export * from './react/components/OptionCards.js';
export * from './react/components/CompactToggle.js';
export * from './react/components/ToggleRow.js';
export * from './react/components/StatCard.js';
export * from './react/components/Notice.js';
export * from './react/components/ImportChoice.js';
export * from './react/components/FileImportPanel.js';
export * from './react/components/OnboardingPanelHeader.js';
export * from './react/components/OnboardingChipField.js';
export * from './react/components/OnboardingDropdown.js';
export * from './react/components/BrandLogo.js';
export * from './react/components/HeaderActionsMenu.js';
export * from './react/components/EdgeScrollZones.js';
export * from './react/components/PillButton.js';
export * from './react/components/PopoverMenu.js';
export * from './react/components/PopoverItem.js';
export * from './react/components/EditorIcon.js';
export * from './react/components/TokenChip.js';
export * from './react/components/ValueChip.js';
export * from './react/components/ComponentKitPreview.js';
