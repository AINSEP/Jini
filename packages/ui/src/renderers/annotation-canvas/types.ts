/**
 * Plain types for the annotation-canvas engine — freehand/box/text markup
 * drawn over arbitrary preview content (an artifact iframe, a webview, any
 * `children`), with a send/draft/queue submit-action picker.
 *
 * Origin: `apps/web/src/components/PreviewDrawOverlay.tsx` (the origin
 * project, 2,158 lines). See `../source-map.md` for the full port writeup.
 */
export interface Point {
  x: number;
  y: number;
}

export interface Stroke {
  points: Point[];
}

export interface NormalizedRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A free-floating text label dropped onto the canvas. `x`/`y` are the top-left position normalized to the frame (0..1) so it tracks the frame across resizes. */
export interface TextMark {
  id: number;
  x: number;
  y: number;
  text: string;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type MarkTool = 'box' | 'pen' | 'text';

export type DrawDockLayout = 'floating' | 'docked';
export type DrawDockSide = 'right' | 'left' | 'bottom' | 'top';

/**
 * A minimal, framework-free stand-in for React's `CSSProperties` — just the
 * handful of inline-style keys the dock placement algorithm actually sets.
 * Structurally compatible with `CSSProperties`, so the React layer can pass
 * this straight through to a `style` prop without a cast.
 */
export interface CSSPropertiesLike {
  position?: 'absolute' | 'static' | 'relative' | 'fixed' | 'sticky';
  left?: string;
  top?: string;
  bottom?: string;
  transform?: string;
  maxWidth?: string;
}

export interface DockPlacement {
  layout: DrawDockLayout;
  side: DrawDockSide | null;
  style: CSSPropertiesLike;
}

/** A host-supplied region of interest (e.g. a clicked element) the annotation anchors to. */
export interface CaptureTarget {
  filePath?: string;
  elementId?: string;
  selector?: string;
  label?: string;
  text?: string;
  position: { x: number; y: number; width: number; height: number };
  htmlHint?: string;
}

export interface PreviewSnapshot {
  dataUrl: string;
  w: number;
  h: number;
}

export type CaptureFrameRect = { left: number; top: number; width: number; height: number };

/** Which submit action the split button/menu currently targets. */
export type AnnotationAction = 'draft' | 'queue' | 'send';

/** Toolbar elements a host's analytics hook (`onToolbarClick`) can observe. */
export type DrawToolbarElement =
  | 'rect'
  | 'pen'
  | 'text'
  | 'undo'
  | 'redo'
  | 'attach_image'
  | 'annotation_submit'
  | 'exit';

/** Everything the host needs to actually submit the annotation — deliberately generic; a host's wire protocol/attachments/submission semantics live entirely behind `AnnotationCanvasPort.onSubmit` (see `ports.ts`). */
export interface AnnotationSubmitDetail {
  file: File | null;
  note: string;
  action: AnnotationAction;
  filePath?: string | undefined;
  markKind?: 'click' | 'stroke' | 'click+stroke' | undefined;
  bounds?: { x: number; y: number; width: number; height: number } | undefined;
  target?: CaptureTarget | null | undefined;
  /** Images the user attached in the markup composer to combine with the mark. */
  extraFiles?: File[] | undefined;
}

export interface AnnotationSubmitResult {
  ok: boolean;
  message?: string | undefined;
}
