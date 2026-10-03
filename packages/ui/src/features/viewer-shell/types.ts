/**
 * Generic types for the "viewer-toolbar + viewer-body" shell family.
 *
 * Source: a vendored OD file-viewer component's 9-times-repeated
 * media-viewer shell (image/video/audio/svg/text/binary/document/sketch
 * viewers all wrap the same toolbar+body chrome around a
 * `{name,size,mtime}`-shaped file reference), plus its comment side-panel
 * and markdown split-pane. See `packages/ui/archived provenance ledger`'s
 * `features/viewer-shell/` section for full provenance and what was
 * deliberately dropped.
 *
 * Coverage: this file is `export interface`/`export type` only — zero
 * emitted executable statements (verified via `@vitest/coverage-v8`: 0
 * statements, and its sole reported "function"/"branch" is v8's own
 * synthetic whole-module wrapper, already counted as covered). Excluded
 * from the coverage run rather than padded with a no-op test.
 */

/**
 * The minimal file-reference shape every viewer body needs. A host's real
 * file type (with project ids, artifact status, etc.) is expected to widen
 * this, not replace it.
 */
export interface ViewerFileRef {
  name: string;
  size: number;
  /** Epoch millis of the file's last modification, used for cache-busting. */
  mtime: number;
  mime?: string;
}

/** One entry in a viewport-preset list (desktop/tablet/mobile, or any other
 *  host-defined breakpoint set). `width`/`height` of `null` means "no fixed
 *  frame" (typically the first/default preset). */
export interface ViewportPreset {
  id: string;
  label: string;
  /** Longer text for `title`/`aria-label`; falls back to `label`. */
  title?: string | undefined;
  /** Icon name passed straight to the host's icon renderer (e.g. a
   *  `RemixIcon` name). Optional — a preset with no icon just shows text. */
  icon?: string | undefined;
  width: number | null;
  height: number | null;
}

/** One option in a `SegmentedToggle`. */
export interface SegmentedOption<TValue extends string = string> {
  value: TValue;
  label: string;
  title?: string | undefined;
  icon?: string | undefined;
}

/** Generic file-download/open action pair, resolved by the host (no
 *  project-id/URL-builder coupling — the host hands over final URLs). */
export interface ViewerFileActionUrls {
  downloadUrl?: string;
  openUrl?: string;
  fileName?: string;
}

/** A generic comment attachment — just enough to render a thumbnail/link. */
export interface ViewerCommentAttachment {
  path: string;
  name: string;
}

/** The minimum shape `CommentSidePanel`/`CommentSideDock` require. Real
 *  comment types (with element-target metadata, board-pin conventions,
 *  etc.) are expected to extend this — see the generic type parameter on
 *  `CommentSidePanelProps`. */
export interface ViewerCommentBase {
  id: string;
}

export type CommentSideDropEdge = 'before' | 'after';

export interface CommentSideDragState {
  draggingId: string;
  overId: string | null;
  edge: CommentSideDropEdge | null;
}

export type MarkdownSplitPaneMode = 'source' | 'split' | 'preview';

export type MarkdownScrollPane = 'editor' | 'preview';
