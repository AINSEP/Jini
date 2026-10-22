import type { ReactNode } from 'react';

/** Which side of the target tab receives the dragged item. */
export type TabStripDropEdge = 'before' | 'after';

export interface TabStripDragTarget {
  tabId: string;
  edge: TabStripDropEdge;
}

/** One tab item. The host owns icon/label/meta content; this primitive only lays it out. */
export interface TabStripTab {
  id: string;
  /** Icon + label + meta + badges — anything the host wants inside the tab. */
  content: ReactNode;
  /** Native `title`/tooltip text for the tab element. */
  title?: string;
  /**
   * Whether this tab shows a close button, when an `onClose` handler is
   * also supplied to `TabStrip`/`TabStripItem`. Defaults to `true`. Ignored
   * (forced closed) when `pinned` is true.
   */
  closable?: boolean;
  /**
   * Whether this tab can be dragged to reorder. Defaults to `!pinned`. A
   * host can still opt an unpinned tab out of dragging (e.g.
   * `FileWorkspace.tsx`'s browser-kind tabs, which are never draggable
   * regardless of pin state).
   */
  draggable?: boolean;
  /**
   * A pinned tab can never be dragged or closed and always sorts to the
   * leftmost position: a drop edge that would place another tab before it
   * is coerced to `'after'` instead. Generalizes
   * `WorkspaceTabsBar.tsx`'s single permanent "entry" tab — no source shape
   * in `FileWorkspace.tsx` uses this (all of its tab-strip items are
   * unpinned), so it defaults to `false`/`undefined`.
   */
  pinned?: boolean;
}

export type TabStripReorderTiming = 'live' | 'onDrop';

export interface TabStripElementRect {
  left: number;
  right: number;
  width: number;
}
