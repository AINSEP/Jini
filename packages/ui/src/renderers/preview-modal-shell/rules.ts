/**
 * Pure logic for the preview-modal shell — no React, no DOM. Generic over a
 * minimal view shape (`PreviewModalViewLike`) so the React layer's richer
 * `PreviewModalView` (which also carries a `ReactNode` `custom` stage) can
 * flow straight through without this file importing 'react'.
 *
 * Origin: `apps/web/src/components/PreviewModal.tsx`'s inline derivations
 * (the `initial` viewId ternary, `activeView`/`scale`/`scalerStyle` memos).
 * See `../source-map.md`.
 */
import type { PreviewModalContentStatus, PreviewModalScalerStyle, PreviewModalUnavailable } from './types.js';

export interface PreviewModalViewLike {
  id: string;
}

export interface PreviewModalContentViewLike {
  custom?: unknown;
  html?: string | null | undefined;
  error?: string | null | undefined;
  unavailable?: PreviewModalUnavailable | null | undefined;
}

/** Mirrors the origin's `initial` ternary: prefer `initialViewId` when it names a real view, else fall back to the first view, else `''` (no views at all). */
export function resolveInitialViewId<V extends PreviewModalViewLike>(
  views: readonly V[],
  initialViewId: string | undefined,
): string {
  if (initialViewId && views.some((v) => v.id === initialViewId)) return initialViewId;
  return views[0]?.id ?? '';
}

/** Look up the active view by id, falling back to the first view (mirrors the origin's `views.find(...) ?? views[0]`). */
export function findActiveView<V extends PreviewModalViewLike>(
  views: readonly V[],
  activeId: string,
): V | undefined {
  return views.find((v) => v.id === activeId) ?? views[0];
}

/** Fit-to-width scale: 1 until the stage has been measured at least once (avoids a flash of an unscaled/oversized iframe on first paint). */
export function computeStageScale(stageWidth: number, designWidth: number): number {
  return stageWidth > 0 ? stageWidth / designWidth : 1;
}

/**
 * The iframe-scaler's inline style: renders at the fixed logical
 * `designWidth`/height-for-that-width, then visually scaled to fit the
 * measured stage. Before the first measurement, fills the stage at 100%
 * with no transform so nothing flashes at the wrong size.
 */
export function computeScalerStyle(
  stageSize: { w: number; h: number },
  designWidth: number,
  scale: number,
): PreviewModalScalerStyle {
  if (stageSize.w === 0) {
    return { width: '100%', height: '100%', transform: 'none' };
  }
  return {
    width: designWidth,
    height: stageSize.h / scale,
    transform: `scale(${scale})`,
  };
}

/**
 * Which content-stage state a view is in. Order matters and mirrors the
 * origin's if/else-if chain: a `custom` stage wins over everything else
 * (the caller opted out of the built-in states entirely), then unavailable,
 * then error, then loading (html not yet fetched), then ready.
 */
export function deriveContentStatus(view: PreviewModalContentViewLike | undefined): PreviewModalContentStatus {
  if (!view) return 'loading';
  if (view.custom !== null && view.custom !== undefined) return 'custom';
  if (view.unavailable != null) return 'unavailable';
  if (view.error != null) return 'error';
  if (view.html === null || view.html === undefined) return 'loading';
  return 'ready';
}
