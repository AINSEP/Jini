/**
 * Small, generic inline-SVG icon set for the annotation-canvas toolbar.
 * Not a port of the origin's icon library (`Icon`/`RemixIcon`, both
 * product-specific icon sets not in scope for this package) — these are
 * new, minimal stroke icons so the toolbar renders something legible out of
 * the box. A host can override every icon via `AnnotationCanvasProps.icons`.
 */
import type { ReactElement, SVGProps } from 'react';

export type AnnotationCanvasIconName =
  | 'box'
  | 'pen'
  | 'text'
  | 'undo'
  | 'redo'
  | 'attach'
  | 'send'
  | 'draft'
  | 'queue'
  | 'chevron-down'
  | 'chevron-up'
  | 'check'
  | 'close'
  | 'spinner';

function Svg(props: SVGProps<SVGSVGElement>) {
  return <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden {...props} />;
}

export const DEFAULT_ANNOTATION_CANVAS_ICONS: Record<AnnotationCanvasIconName, () => ReactElement> = {
  box: () => (
    <Svg>
      <rect x="4" y="4" width="16" height="16" rx="1" />
    </Svg>
  ),
  pen: () => (
    <Svg>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </Svg>
  ),
  text: () => (
    <Svg>
      <path d="M4 6h16" />
      <path d="M12 6v14" />
      <path d="M9 20h6" />
    </Svg>
  ),
  undo: () => (
    <Svg>
      <path d="M9 14 4 9l5-5" />
      <path d="M4 9h10a6 6 0 0 1 0 12h-1" />
    </Svg>
  ),
  redo: () => (
    <Svg>
      <path d="m15 14 5-5-5-5" />
      <path d="M20 9H10a6 6 0 0 0 0 12h1" />
    </Svg>
  ),
  attach: () => (
    <Svg>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <circle cx="8.5" cy="10.5" r="1.5" />
      <path d="m21 15-5-5L5 21" />
    </Svg>
  ),
  send: () => (
    <Svg>
      <path d="M22 2 11 13" />
      <path d="M22 2 15 22l-4-9-9-4Z" />
    </Svg>
  ),
  draft: () => (
    <Svg>
      <rect x="3" y="8" width="18" height="8" rx="1" />
      <path d="M7 12h4" />
    </Svg>
  ),
  queue: () => (
    <Svg>
      <path d="m4 7 2 2 4-4" />
      <path d="M12 6h8" />
      <path d="m4 15 2 2 4-4" />
      <path d="M12 16h8" />
    </Svg>
  ),
  'chevron-down': () => (
    <Svg>
      <path d="m6 9 6 6 6-6" />
    </Svg>
  ),
  'chevron-up': () => (
    <Svg>
      <path d="m18 15-6-6-6 6" />
    </Svg>
  ),
  check: () => (
    <Svg>
      <path d="M20 6 9 17l-5-5" />
    </Svg>
  ),
  close: () => (
    <Svg>
      <path d="M18 6 6 18" />
      <path d="M6 6l12 12" />
    </Svg>
  ),
  spinner: () => (
    <Svg style={{ animation: 'jini-annotation-canvas-spin 0.8s linear infinite' }}>
      <path d="M21 12a9 9 0 1 1-9-9" />
    </Svg>
  ),
};
