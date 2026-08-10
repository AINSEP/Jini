/**
 * Public barrel for the annotation-canvas slice. Consumers import ONLY from
 * here — never from an internal file directly.
 */
export type {
  AnnotationAction,
  AnnotationSubmitDetail,
  AnnotationSubmitResult,
  CaptureFrameRect,
  CaptureTarget,
  DockPlacement,
  DrawDockLayout,
  DrawDockSide,
  DrawToolbarElement,
  MarkTool,
  NormalizedRect,
  Point,
  PreviewSnapshot,
  Rect,
  Stroke,
  TextMark,
} from './types.js';

export type { AnnotationCanvasPort } from './ports.js';
export { createFakeAnnotationCanvasPort } from './dependencies.js';

export {
  clamp,
  clamp01,
  rectsOverlap,
  normalizedRectFromPoints,
  dockPlacementEquals,
  computeDockPlacement,
  mergeBounds,
  mergeRects,
  deriveMarkKind,
  buildSubmitOptionRules,
  MARK_TOOL_OPTION_RULES,
  DRAW_DOCK_GAP,
  DRAW_DOCK_MARGIN,
  DRAW_DOCK_MIN_WIDTH,
  DRAW_DOCK_MIN_HEIGHT,
  type DockPlacementInput,
  type SubmitOptionRule,
  type MarkToolOptionRule,
} from './rules.js';

export {
  STROKE_COLOR,
  STROKE_WIDTH,
  TARGET_COLOR,
  drawNormalizedBox,
  redrawStrokesAndBoxes,
  drawTextMarks,
  drawCaptureTarget,
  compositeMarksOntoCanvas,
  textFontSizePx,
} from './drawing.js';

export {
  useAnnotationCanvas,
  type AnnotationCanvasController,
  type UseAnnotationCanvasOptions,
  type SubmitOptionController,
  type MarkToolOptionController,
  type TextMarkController,
} from './react/hooks/useAnnotationCanvas.js';

export { AnnotationCanvas, type AnnotationCanvasProps } from './react/components/AnnotationCanvas.js';
export { DEFAULT_ANNOTATION_CANVAS_ICONS, type AnnotationCanvasIconName } from './react/components/icons.js';
