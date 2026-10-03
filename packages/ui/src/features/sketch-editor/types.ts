/**
 * Generic scene/toast/tooltip shapes for embedding an Excalidraw-backed
 * sketch surface. Deliberately excludes any pre-Excalidraw legacy item
 * format — that migration path is a host-product concern, not part of the
 * generic shim. See `packages/ui/archived provenance ledger` for provenance.
 */

/** A serializable Excalidraw scene: elements + sanitized app state + files. */
export interface SketchScene {
  elements: readonly unknown[];
  appState: Record<string, unknown> | null;
  files: Record<string, unknown>;
}

export interface SketchSceneChangeOptions {
  markDirty?: boolean;
}

export interface SketchExportedImageResult {
  fileName: string;
}

export type SketchExportImageResult = boolean | void | SketchExportedImageResult;

export interface SketchToastState {
  message: string;
  details?: string | null;
  tone: 'default' | 'success' | 'error' | 'loading';
  actionFileName?: string;
}

export type SketchTooltipLabelKey =
  | 'mainMenu'
  | 'lock'
  | 'hand'
  | 'selection'
  | 'rectangle'
  | 'diamond'
  | 'ellipse'
  | 'arrow'
  | 'line'
  | 'freedraw'
  | 'text'
  | 'image'
  | 'eraser'
  | 'frame'
  | 'embeddable'
  | 'laser'
  | 'moreTools';

export type SketchTooltipLabels = Record<SketchTooltipLabelKey, string>;

export interface SketchTooltipTarget {
  selector: string;
  target?: 'closest-label';
  label: SketchTooltipLabelKey;
  placement?: 'top' | 'bottom' | 'left' | 'right';
}

/**
 * A locale-keyed table of English third-party-UI strings to their
 * host-supplied translations, applied by walking the embedded editor's own
 * DOM. This is the generic MECHANISM only — a host embedding Excalidraw
 * supplies its own translated table; none of any first-party consumer's
 * actual translated copy ships here (see `dom.ts`'s "Dropped" note in the
 * source-map).
 */
export type SketchDomTextOverrides = Record<string, string>;

/** Minimal shape `useT()`-style translate functions satisfy. */
export type SketchTranslate = (key: string) => string;
