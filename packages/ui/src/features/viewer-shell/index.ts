export type {
  ViewerFileRef,
  ViewportPreset,
  SegmentedOption,
  ViewerFileActionUrls,
  ViewerCommentAttachment,
  ViewerCommentBase,
  CommentSideDropEdge,
  CommentSideDragState,
  MarkdownSplitPaneMode,
  MarkdownScrollPane,
} from './types.js';

export { DEFAULT_VIEWPORT_PRESETS, COMMENT_SIDE_DRAG_MIME, COPY_FEEDBACK_RESET_MS } from './constants.js';

export * from './rules.js';

export type { ViewerClipboardPort, ViewerShellDependencies } from './ports.js';
export { createBrowserViewerClipboard, createDefaultViewerShellDependencies } from './dependencies.js';

export { useCopyToClipboard, useWiredCopyToClipboard } from './react/hooks/useCopyToClipboard.js';
export type { UseCopyToClipboardResult } from './react/hooks/useCopyToClipboard.js';
export { useCommentReorder } from './react/hooks/useCommentReorder.js';
export type { UseCommentReorderResult } from './react/hooks/useCommentReorder.js';
export { useMarkdownScrollSync } from './react/hooks/useMarkdownScrollSync.js';
export type { UseMarkdownScrollSyncOptions, UseMarkdownScrollSyncResult } from './react/hooks/useMarkdownScrollSync.js';

export { ViewerShell, ViewerEmptyState } from './react/components/ViewerShell.js';
export type { ViewerShellProps, ViewerEmptyStateProps } from './react/components/ViewerShell.js';
export { ViewerFileActions } from './react/components/ViewerFileActions.js';
export type { ViewerFileActionsProps } from './react/components/ViewerFileActions.js';
export { SegmentedToggle } from './react/components/SegmentedToggle.js';
export type { SegmentedToggleProps } from './react/components/SegmentedToggle.js';
export { ViewportSwitcher } from './react/components/ViewportSwitcher.js';
export type { ViewportSwitcherProps } from './react/components/ViewportSwitcher.js';
export { ViewportToggleGroup } from './react/components/ViewportToggleGroup.js';
export type { ViewportToggleGroupProps } from './react/components/ViewportToggleGroup.js';
export { CodeWithLines } from './react/components/CodeWithLines.js';
export type { CodeWithLinesProps } from './react/components/CodeWithLines.js';
export { CodeWrapToggle } from './react/components/CodeWrapToggle.js';
export type { CodeWrapToggleProps } from './react/components/CodeWrapToggle.js';
export { useCodeWrap } from './react/hooks/useCodeWrap.js';
export type { CodeWrapController } from './react/hooks/useCodeWrap.js';
export { JsonPanel } from './react/components/JsonPanel.js';
export type { JsonPanelProps } from './react/components/JsonPanel.js';
export { ImageViewerBody } from './react/components/ImageViewerBody.js';
export type { ImageViewerBodyProps } from './react/components/ImageViewerBody.js';
export { VideoViewerBody } from './react/components/VideoViewerBody.js';
export type { VideoViewerBodyProps } from './react/components/VideoViewerBody.js';
export { AudioViewerBody } from './react/components/AudioViewerBody.js';
export type { AudioViewerBodyProps } from './react/components/AudioViewerBody.js';
export { SvgSourcePane } from './react/components/SvgSourcePane.js';
export type { SvgSourcePaneProps, SvgViewerMode } from './react/components/SvgSourcePane.js';
export { CommentSidePanel } from './react/components/CommentSidePanel.js';
export type { CommentSidePanelProps } from './react/components/CommentSidePanel.js';
export { CommentSideDock } from './react/components/CommentSideDock.js';
export type { CommentSideDockProps } from './react/components/CommentSideDock.js';
export { MarkdownSplitPane } from './react/components/MarkdownSplitPane.js';
export type { MarkdownSplitPaneProps } from './react/components/MarkdownSplitPane.js';
