/**
 * The annotation-canvas slice's dependency on the outside world, expressed
 * as an interface it owns. The slice depends on this port, never on a
 * concrete transport directly; a real binding is supplied by the host (see
 * `dependencies.ts` for this package's own fake/test binding).
 *
 * Deliberately thin: the origin `PreviewDrawOverlay.tsx` dispatches a global
 * `window` `CustomEvent` with a product-specific event name, awaited via a
 * 60s ack-timeout race, and a sibling composer component owns the actual
 * send/draft/queue submission semantics (composed-turn building, staged
 * attachments, run-context metadata) — all of that is product-specific and
 * stays in the consuming product's own adapter. This port only asks a host
 * for the *outcome* of submitting, plus the two optional capture strategies
 * the origin already exposed as plain callback props.
 */
import type { AnnotationSubmitDetail, AnnotationSubmitResult, CaptureFrameRect, PreviewSnapshot } from './types.js';

export interface AnnotationCanvasPort {
  /** Submit the annotation. Resolves with the outcome — never rejects (a host-side failure should resolve `{ok: false, message}`). */
  onSubmit: (detail: AnnotationSubmitDetail) => Promise<AnnotationSubmitResult>;
  /**
   * Capture a full-viewport snapshot (e.g. a host compositor screenshot).
   * When omitted, the canvas has no way to rasterize the artifact behind
   * it — `send()` still submits the note/attachments/strokes-as-vector-data
   * the caller already has, just without a baked screenshot.
   */
  captureSnapshot?: (() => Promise<PreviewSnapshot | null>) | undefined;
  /** The on-screen rect of the content being annotated, used to scale vector marks onto the captured snapshot's pixel dimensions. Falls back to the canvas wrapper's own bounding rect when omitted. */
  captureFrameRect?: (() => CaptureFrameRect | null) | undefined;
}
