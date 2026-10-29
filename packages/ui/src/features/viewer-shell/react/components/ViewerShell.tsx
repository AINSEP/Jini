import type { ReactNode } from 'react';
import { withClassName } from '../../../../utils/class-names.js';

export interface ViewerShellProps {
  /** Modifier appended to the root `viewer` class (e.g. `"image-viewer"`,
   *  `"text-viewer"`) — purely a CSS hook, matches the source component's
   *  per-kind class naming. */
  kindClassName?: string;
  /** Left-aligned toolbar content — typically a file-size/kind meta label. */
  toolbarLeft?: ReactNode;
  /** Right-aligned toolbar content — download/open links, mode tabs,
   *  reload/copy buttons, a viewport switcher, etc. */
  toolbarActions?: ReactNode;
  /** Extra class appended to the body wrapper (e.g. `"image-body"`). */
  bodyClassName?: string;
  children: ReactNode;
}

/**
 * The "viewer-toolbar + viewer-body" chrome independently repeated across
 * 8 media-viewer components in the source file (`BinaryViewer`,
 * `DocumentPreviewViewer`, `ImageViewer`, `SketchViewer`, `VideoViewer`,
 * `AudioViewer`, `SvgViewer`, `TextViewer`) — one shared shell instead of 8
 * near-duplicate toolbar+body layouts. The host supplies the toolbar
 * content and body content per viewer kind; this component only owns the
 * layout wrapper.
 */
export function ViewerShell({ kindClassName, toolbarLeft, toolbarActions, bodyClassName, children }: ViewerShellProps) {
  return (
    <div className={withClassName('viewer', kindClassName)}>
      <div className="viewer-toolbar">
        <div className="viewer-toolbar-left">{toolbarLeft}</div>
        {toolbarActions ? <div className="viewer-toolbar-actions">{toolbarActions}</div> : null}
      </div>
      <div className={withClassName('viewer-body', bodyClassName)}>{children}</div>
    </div>
  );
}

export interface ViewerEmptyStateProps {
  children: ReactNode;
}

/** Trivial "nothing to show" placeholder shared by every viewer body. */
export function ViewerEmptyState({ children }: ViewerEmptyStateProps) {
  return <div className="viewer-empty">{children}</div>;
}
