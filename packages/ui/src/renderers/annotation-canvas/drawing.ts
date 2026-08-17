/**
 * Canvas 2D drawing for the annotation-canvas engine — strokes, selection
 * boxes, text-mark rasterization, and the capture-target highlight. Zero
 * React; operates on a `CanvasRenderingContext2D` handed in by the hook
 * layer.
 *
 * Origin: `apps/web/src/components/PreviewDrawOverlay.tsx`. See
 * `../source-map.md`.
 */
import type { CaptureTarget, NormalizedRect, Stroke, TextMark } from './types.js';

export const STROKE_COLOR = '#ff3b30';
export const STROKE_WIDTH = 4;
export const TARGET_COLOR = '#1677ff';
/** Text-annotation glyph height as a fraction of the frame height, so a dropped label reads at a consistent size across differently-sized frames and its on-screen size matches what gets baked into an exported screenshot. */
export const TEXT_FONT_FRACTION = 0.03;
export const TEXT_LINE_HEIGHT = 1.25;
export const TEXT_MIN_FONT_PX = 12;
export const TEXT_FONT_FAMILY = 'system-ui, -apple-system, BlinkMacSystemFont, sans-serif';

export function textFontSizePx(frameHeight: number): number {
  return Math.max(TEXT_MIN_FONT_PX, TEXT_FONT_FRACTION * frameHeight);
}

export function drawNormalizedBox(ctx: CanvasRenderingContext2D, box: NormalizedRect, width: number, height: number): void {
  const left = box.x * width;
  const top = box.y * height;
  const boxWidth = Math.max(1, box.width * width);
  const boxHeight = Math.max(1, box.height * height);
  ctx.save();
  ctx.fillStyle = 'rgba(255, 59, 48, 0.10)';
  ctx.strokeStyle = STROKE_COLOR;
  ctx.lineWidth = Math.max(2, Math.round(Math.min(width, height) * 0.002));
  ctx.setLineDash([10, 6]);
  ctx.fillRect(left, top, boxWidth, boxHeight);
  ctx.strokeRect(left, top, boxWidth, boxHeight);
  ctx.restore();
}

/** Redraws every committed stroke, the in-progress draft stroke, committed selection boxes, and the in-progress box draft. Called on every pointer move (rAF-coalesced by the caller) and on every history mutation. */
export function redrawStrokesAndBoxes(
  ctx: CanvasRenderingContext2D,
  input: {
    strokes: readonly Stroke[];
    drawingStroke: Stroke | null;
    selectionBoxes: readonly NormalizedRect[];
    boxDraft: NormalizedRect | null;
  },
  width: number,
  height: number,
  dpr: number,
): void {
  ctx.clearRect(0, 0, width, height);
  ctx.strokeStyle = STROKE_COLOR;
  ctx.lineWidth = STROKE_WIDTH * dpr;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const all = input.drawingStroke ? [...input.strokes, input.drawingStroke] : input.strokes;
  for (const box of input.selectionBoxes) drawNormalizedBox(ctx, box, width, height);
  if (input.boxDraft) drawNormalizedBox(ctx, input.boxDraft, width, height);
  for (const s of all) {
    const first = s.points[0];
    if (!first) continue;
    ctx.beginPath();
    ctx.moveTo(first.x * width, first.y * height);
    for (let i = 1; i < s.points.length; i++) {
      const p = s.points[i]!;
      ctx.lineTo(p.x * width, p.y * height);
    }
    ctx.stroke();
  }
}

/** Bakes the transparent on-screen text labels into an exported screenshot. Uses the same frame-height-fraction glyph size the DOM textareas use, so what the user typed lands at the same size/position in the captured image. */
export function drawTextMarks(ctx: CanvasRenderingContext2D, marks: readonly TextMark[], width: number, height: number): void {
  const fontPx = textFontSizePx(height);
  const lineHeight = fontPx * TEXT_LINE_HEIGHT;
  const topPad = (lineHeight - fontPx) / 2;
  ctx.save();
  ctx.textBaseline = 'top';
  ctx.font = `600 ${fontPx}px ${TEXT_FONT_FAMILY}`;
  ctx.fillStyle = STROKE_COLOR;
  ctx.shadowColor = 'rgba(255,255,255,0.75)';
  ctx.shadowBlur = Math.max(1, fontPx * 0.14);
  for (const mark of marks) {
    if (mark.text.trim().length === 0) continue;
    const baseX = mark.x * width;
    const baseY = mark.y * height + topPad;
    mark.text.split('\n').forEach((line, index) => {
      ctx.fillText(line, baseX, baseY + index * lineHeight);
    });
  }
  ctx.restore();
}

/** Draws the host-supplied capture target's highlight box + label onto a composited export canvas. */
export function drawCaptureTarget(
  ctx: CanvasRenderingContext2D,
  scaleX: number,
  scaleY: number,
  target: CaptureTarget | null,
): void {
  if (!target) return;
  const { x, y, width, height } = target.position;
  if (![x, y, width, height].every(Number.isFinite)) return;
  if (width <= 0 || height <= 0) return;
  const left = x * scaleX;
  const top = y * scaleY;
  const boxWidth = Math.max(1, width * scaleX);
  const boxHeight = Math.max(1, height * scaleY);
  ctx.save();
  ctx.fillStyle = 'rgba(22, 119, 255, 0.12)';
  ctx.strokeStyle = TARGET_COLOR;
  ctx.lineWidth = Math.max(2, Math.round(Math.max(scaleX, scaleY) * 2));
  ctx.setLineDash([Math.max(8, 8 * scaleX), Math.max(4, 4 * scaleX)]);
  ctx.fillRect(left, top, boxWidth, boxHeight);
  ctx.strokeRect(left, top, boxWidth, boxHeight);
  const label = (target.label || target.elementId || '').trim();
  if (label) {
    const fontSize = Math.max(12, Math.round(12 * Math.max(scaleX, scaleY)));
    ctx.font = `600 ${fontSize}px ${TEXT_FONT_FAMILY}`;
    const text = label.length > 42 ? `${label.slice(0, 39)}...` : label;
    const metrics = ctx.measureText(text);
    const padX = Math.max(6, Math.round(6 * scaleX));
    const padY = Math.max(4, Math.round(4 * scaleY));
    const labelWidth = metrics.width + padX * 2;
    const labelHeight = fontSize + padY * 2;
    const labelTop = Math.max(0, top - labelHeight - Math.max(4, 4 * scaleY));
    ctx.setLineDash([]);
    ctx.fillStyle = TARGET_COLOR;
    ctx.fillRect(left, labelTop, labelWidth, labelHeight);
    ctx.fillStyle = '#fff';
    ctx.fillText(text, left + padX, labelTop + padY + fontSize * 0.82);
  }
  ctx.restore();
}

/** Composites the current marks (capture-target highlight, selection boxes, strokes, text labels) onto an already-drawn background image at export resolution. */
export function compositeMarksOntoCanvas(
  ctx: CanvasRenderingContext2D,
  input: {
    target: CaptureTarget | null;
    selectionBoxes: readonly NormalizedRect[];
    strokes: readonly Stroke[];
    textMarks: readonly TextMark[];
  },
  outputWidth: number,
  outputHeight: number,
  scaleX: number,
  scaleY: number,
): void {
  drawCaptureTarget(ctx, scaleX, scaleY, input.target);
  for (const box of input.selectionBoxes) drawNormalizedBox(ctx, box, outputWidth, outputHeight);
  ctx.strokeStyle = STROKE_COLOR;
  ctx.lineWidth = STROKE_WIDTH * Math.max(scaleX, scaleY);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const s of input.strokes) {
    const first = s.points[0];
    if (!first) continue;
    ctx.beginPath();
    ctx.moveTo(first.x * outputWidth, first.y * outputHeight);
    for (let i = 1; i < s.points.length; i++) {
      const p = s.points[i]!;
      ctx.lineTo(p.x * outputWidth, p.y * outputHeight);
    }
    ctx.stroke();
  }
  drawTextMarks(ctx, input.textMarks, outputWidth, outputHeight);
}
