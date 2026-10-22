/**
 * @module @jini-ai/ui — product-neutral UI primitives and feature surfaces.
 *
 * Presentation and ownership:
 * - Progress-card copy is host-supplied because job kinds and branded messages
 *   belong to the product. Neutral status defaults and accessibility labels are
 *   translated; dynamic item labels are already host content and are not.
 * - Progress supports determinate and indeterminate work. Adapters return full
 *   lists; display caps belong to the component so source data stays complete.
 *   Structural adapter inputs avoid a dependency on any product's DTO package.
 * - ProgressCard and ListDetailPanel are presentational: hosts supply data,
 *   selection, renderers, loading slots and visual styling. Transport ports
 *   would have no behavior to abstract. Product analytics, filtering and actions
 *   stay with the host. File-operation adapters classify tool names; shell-command
 *   parsing is a separate concern, not part of the progress display.
 * - Browser history has a real, SSR-safe storage default. Bridge registration
 *   defaults to a no-op because only a host can define its external bridge.
 *   Navigation-stack configuration is local state, so it needs no port wirer.
 *   Outside-click/Escape subscriptions belong to the shared browser hooks.
 * - Asset-tree root listings intentionally include nested files alongside
 *   drill-down folders; non-root listings contain only the current directory.
 *   This asymmetry is part of the existing tree contract, not an accidental
 *   omission of root filtering.
 * - Memory is a settings/data-management surface, not chat. Connector catalog
 *   reconciliation and connector types belong to features/connectors; memory
 *   adds only its own pending-authorization and single-item conveniences.
 * - FileDropzone owns native browse/drop/paste interactions and their display
 *   variants. Directory walking and file-transfer logic live in utils/file-transfer
 *   so dropzones and asset trees share one implementation.
 *
 * Rendering contracts:
 * - Hosts opt into real sandbox behavior for version-manager previews through
 *   resolvePreviewDocument. Its identity fake is a dependency default, not a
 *   claim that the renderer core is missing. Viewport toggles reuse viewer-shell.
 * - sandboxed-document and srcdoc/build have distinct builder and bridge
 *   contracts. The canonical splice helpers come from srcdoc/build and can fall
 *   back to DOMParser; the StringOnly aliases preserve html-utils' prepend/append
 *   fallback. Choosing one fallback for both would change public behavior.
 *
 * Heavy editors use dedicated @jini-ai/ui/sketch-editor and
 * @jini-ai/ui/lexical-rich-text-editor entries so ordinary root imports do not
 * load their editor dependencies. See packages/ui/README.md for package scope.
 */
export * from './features/i18n/index.js';
export * from './features/admin-widgets/index.js';
export * from './features/panel-kit/index.js';
export * from './features/observability/index.js';
export * from './features/connectors/index.js';
export * from './features/progress-card/index.js';
export * from './features/browser-chrome/index.js';
export * from './features/asset-grid/index.js';
export * from './features/asset-tree-browser/index.js';
export * from './features/viewer-shell/index.js';
export * from './features/version-manager/index.js';
export * from './features/html-viewer/index.js';
export * from './features/tabbed-dialog/index.js';
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
export * from './features/folder-path-drop/index.js';
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
// Promoted to the public barrel 2026-08-03: previously package-internal only, reached by
// `useFileDropTarget.js` (also exported below) and by three in-package features via relative
// import. `@jini-ai/chat`'s `./react` subpath needs `FILE_SYSTEM_READ_ERROR_MESSAGE` for a test
// assertion now that it's an external package rather than living inside `ui`.
export * from './utils/file-system-errors.js';

export * from './react/hooks/useInView.js';
export * from './react/hooks/useCoalescedCallback.js';
export * from './react/hooks/useStableHandler.js';
export * from './react/hooks/useDebouncedValue.js';
export * from './react/hooks/useResizableSplitPane.js';
export * from './react/hooks/useBrandFonts.js';
export * from './react/hooks/useEdgeAutoScroll.js';

export * from './browser/useModalWindowDragGuard.js';

export * from './browser/index.js';

// Named (not `export *`): Icon.tsx also exports `ICON_RENDERERS`, a test
// seam for asserting the name -> renderer lookup table directly. It must
// not reach this published package's public surface.
export { Icon, ICON_PATH_DATA, type IconName } from './react/components/Icon.js';
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
