import { useCallback, useRef, useState } from 'react';
import type { DragEvent, Dispatch, MouseEvent, RefObject, SetStateAction } from 'react';
import { TAB_STRIP_DRAG_HAPTIC_MS, TAB_STRIP_DROP_HAPTIC_MS, TAB_STRIP_ITEM_ID_ATTRIBUTE } from '../../constants.js';
import { noopTabStripHaptics } from '../../ports.js';
import type { TabStripHapticsPort } from '../../ports.js';
import {
  coercePinnedDropTarget,
  dragTargetKey,
  dropEdgeFromPointerX,
  findNearestDropTarget,
  isTabDraggable,
  pinnedTabIdSet,
} from '../../rules.js';
import type { TabStripDragTarget, TabStripDropEdge, TabStripReorderTiming, TabStripTab } from '../../types.js';

export interface UseTabStripDragReorderOptions {
  tabs: TabStripTab[];
  /**
   * Called with the semantic reorder instruction (move `sourceId` to just
   * before/after `targetId`) whenever the drag gesture reports one. The
   * hook never mutates `tabs` itself — tab order is host-owned state (the
   * host applies `reorderTabIds` from `rules.ts`, or its own equivalent,
   * and re-renders with the new `tabs` order), mirroring how neither source
   * component's tab-item-level drag code owned the order array directly.
   */
  onReorder: (sourceId: string, targetId: string, edge: TabStripDropEdge) => void;
  /**
   * `'onDrop'` (default) fires `onReorder` only when the drag is released —
   * `FileWorkspace.tsx`'s `Tab`/`reorderPersistedTab` behavior. `'live'`
   * fires it continuously during `dragover` as the pointer crosses tab
   * boundaries, live-shuffling the strip while dragging —
   * `WorkspaceTabsBar.tsx`'s `handleStripDragOver` behavior. `onReorder`
   * should be cheap/idempotent either way (both source implementations'
   * own reorder functions already are, via the same-order no-op check).
   */
  reorderTiming?: TabStripReorderTiming | undefined;
  /** Defaults to a no-op — opt in with `createBrowserTabStripHaptics()`. */
  haptics?: TabStripHapticsPort | undefined;
}

export interface TabStripItemDragProps {
  draggable: boolean;
  onDragStart: (event: DragEvent<HTMLElement>) => void;
  onDragEnd: () => void;
  /** Wire onto the item's `onClick` (or call before invoking `onActivate`)
   *  to suppress the spurious click a drag-and-drop gesture can produce —
   *  ported from `WorkspaceTabsBar.tsx`'s `dragSuppressClickRef`. */
  onClickCapture: (event: MouseEvent<HTMLElement>) => void;
}

export interface UseTabStripDragReorderResult {
  draggingTabId: string | null;
  dragOverTarget: TabStripDragTarget | null;
  stripRef: RefObject<HTMLDivElement | null>;
  stripDragProps: {
    onDragOver: (event: DragEvent<HTMLElement>) => void;
    onDrop: (event: DragEvent<HTMLElement>) => void;
    onDragLeave: (event: DragEvent<HTMLElement>) => void;
  };
  getItemDragProps: (tabId: string) => TabStripItemDragProps;
}

type TabIdRef = { current: string | null };
type FlagRef = { current: boolean };

/** The tab under the pointer, as a drop target (edge from pointer X); null when the pointer isn't over another tab. */
function targetFromHoveredItem(
  strip: HTMLElement,
  event: { clientX: number; target: EventTarget | null },
  sourceId: string,
): TabStripDragTarget | null {
  const eventTarget = event.target;
  if (!(eventTarget instanceof HTMLElement)) return null;
  const itemElement = eventTarget.closest<HTMLElement>(`[${TAB_STRIP_ITEM_ID_ATTRIBUTE}]`);
  if (!itemElement || !strip.contains(itemElement)) return null;
  const tabId = itemElement.getAttribute(TAB_STRIP_ITEM_ID_ATTRIBUTE);
  if (!tabId || tabId === sourceId) return null;
  const edge = dropEdgeFromPointerX(event.clientX, itemElement.getBoundingClientRect());
  return { tabId, edge };
}

/** Hit-test the strip: the hovered tab first, else the nearest tab edge (covers the gap after the last tab). */
function locateDropTarget(
  strip: HTMLElement,
  tabs: TabStripTab[],
  event: { clientX: number; target: EventTarget | null },
  sourceId: string,
): TabStripDragTarget | null {
  const pinnedIds = pinnedTabIdSet(tabs);
  const hovered = targetFromHoveredItem(strip, event, sourceId);
  if (hovered) return coercePinnedDropTarget(hovered, pinnedIds);

  const elements = Array.from(
    strip.querySelectorAll<HTMLElement>(`[${TAB_STRIP_ITEM_ID_ATTRIBUTE}]`),
  ).map((element) => ({
    // Non-null: every scanned element was matched BY this exact
    // attribute selector, so it's always present — not a speculative
    // fallback.
    id: element.getAttribute(TAB_STRIP_ITEM_ID_ATTRIBUTE)!,
    rect: element.getBoundingClientRect(),
  }));
  const fallback = findNearestDropTarget(event.clientX, elements, sourceId);
  return fallback ? coercePinnedDropTarget(fallback, pinnedIds) : null;
}

interface ItemDragDeps {
  tabs: TabStripTab[];
  haptics: TabStripHapticsPort;
  draggingTabIdRef: TabIdRef;
  dragHapticTargetRef: TabIdRef;
  suppressClickRef: FlagRef;
  setDraggingTabId: (id: string | null) => void;
  setDragOverTarget: (target: TabStripDragTarget | null) => void;
  clearDragState: () => void;
}

/** Per-item drag props: start (records the source + pulses), end, and the post-drag click suppression. */
function useItemDragProps({
  tabs,
  haptics,
  draggingTabIdRef,
  dragHapticTargetRef,
  suppressClickRef,
  setDraggingTabId,
  setDragOverTarget,
  clearDragState,
}: ItemDragDeps) {
  return useCallback(
    (tabId: string): TabStripItemDragProps => {
      const tab = tabs.find((candidate) => candidate.id === tabId);
      const draggable = tab ? isTabDraggable(tab, tabs) : false;
      return {
        draggable,
        onDragStart: (event) => {
          if (!draggable) {
            event.preventDefault();
            return;
          }
          suppressClickRef.current = true;
          draggingTabIdRef.current = tabId;
          dragHapticTargetRef.current = `${tabId}:self`;
          setDragOverTarget(null);
          setDraggingTabId(tabId);
          event.dataTransfer.effectAllowed = 'move';
          event.dataTransfer.setData('text/plain', tabId);
          haptics.pulse(TAB_STRIP_DRAG_HAPTIC_MS);
        },
        onDragEnd: clearDragState,
        onClickCapture: (event) => {
          if (suppressClickRef.current) {
            suppressClickRef.current = false;
            event.preventDefault();
            event.stopPropagation();
          }
        },
      };
    },
    [tabs, clearDragState, haptics, draggingTabIdRef, dragHapticTargetRef, suppressClickRef, setDraggingTabId, setDragOverTarget],
  );
}

/** Pulse haptics only when the drop target actually changed. */
function pulseIfNewTarget(
  { dragHapticTargetRef, haptics, target }: { dragHapticTargetRef: TabIdRef; haptics: TabStripHapticsPort; target: TabStripDragTarget },
) {
  const key = dragTargetKey(target);
  if (dragHapticTargetRef.current !== key) {
    dragHapticTargetRef.current = key;
    haptics.pulse(TAB_STRIP_DRAG_HAPTIC_MS);
  }
}

/** Keep the existing target object when the key is unchanged, avoiding a re-render. */
function keepIfSameTarget(current: TabStripDragTarget | null, next: TabStripDragTarget) {
  return current && dragTargetKey(current) === dragTargetKey(next) ? current : next;
}

interface StripDragDeps {
  stripRef: RefObject<HTMLDivElement | null>;
  tabs: TabStripTab[];
  onReorder: UseTabStripDragReorderOptions['onReorder'];
  reorderTiming: TabStripReorderTiming;
  haptics: TabStripHapticsPort;
  draggingTabIdRef: TabIdRef;
  dragHapticTargetRef: TabIdRef;
  setDragOverTarget: Dispatch<SetStateAction<TabStripDragTarget | null>>;
  clearDragState: () => void;
}

/** Strip-level `dragover`/`drop`/`dragleave` handlers — hit-testing is centralized here, not per item. */
function useStripDragProps({
  stripRef,
  tabs,
  onReorder,
  reorderTiming,
  haptics,
  draggingTabIdRef,
  dragHapticTargetRef,
  setDragOverTarget,
  clearDragState,
}: StripDragDeps): UseTabStripDragReorderResult['stripDragProps'] {
  const findDropTarget = (event: { clientX: number; target: EventTarget | null }, sourceId: string) => {
    const strip = stripRef.current;
    return strip ? locateDropTarget(strip, tabs, event, sourceId) : null;
  };

  return {
    onDragOver: (event) => {
      const sourceId = draggingTabIdRef.current ?? event.dataTransfer.getData('text/plain');
      if (!sourceId) return;
      const target = findDropTarget(event, sourceId);
      if (!target) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      setDragOverTarget((current) => keepIfSameTarget(current, target));
      pulseIfNewTarget({ dragHapticTargetRef, haptics, target });
      if (reorderTiming === 'live') {
        onReorder(sourceId, target.tabId, target.edge);
      }
    },
    onDrop: (event) => {
      const sourceId = draggingTabIdRef.current ?? event.dataTransfer.getData('text/plain');
      if (sourceId) event.preventDefault();
      const target = sourceId ? findDropTarget(event, sourceId) : null;
      if (sourceId && target) {
        onReorder(sourceId, target.tabId, target.edge);
        haptics.pulse(TAB_STRIP_DROP_HAPTIC_MS);
      }
      clearDragState();
    },
    onDragLeave: (event) => {
      const nextTarget = event.relatedTarget;
      if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) return;
      setDragOverTarget(null);
    },
  };
}

/**
 * Owns the drag-to-reorder gesture for a `TabStrip`. Hit-testing is
 * centralized on the strip container (one `onDragOver`/`onDrop`, scanning
 * `[data-tab-strip-item-id]` descendants) rather than wired per-item —
 * `WorkspaceTabsBar.tsx`'s approach, adopted here as the single mechanism
 * because it strictly generalizes `FileWorkspace.tsx`'s per-item
 * `onDragOver` (which only ever fires while directly over a tab element and
 * misses the gap after the last tab); every source-shape drag interaction
 * still verified working through this one path in the dual-shape test.
 */
export function useTabStripDragReorder({
  tabs,
  onReorder,
  reorderTiming = 'onDrop',
  haptics = noopTabStripHaptics,
}: UseTabStripDragReorderOptions): UseTabStripDragReorderResult {
  const stripRef = useRef<HTMLDivElement | null>(null);
  const draggingTabIdRef = useRef<string | null>(null);
  const dragHapticTargetRef = useRef<string | null>(null);
  const suppressClickRef = useRef(false);
  const [draggingTabId, setDraggingTabId] = useState<string | null>(null);
  const [dragOverTarget, setDragOverTarget] = useState<TabStripDragTarget | null>(null);

  const clearDragState = useCallback(() => {
    draggingTabIdRef.current = null;
    dragHapticTargetRef.current = null;
    setDragOverTarget(null);
    setDraggingTabId(null);
    window.setTimeout(() => {
      suppressClickRef.current = false;
    }, 0);
  }, []);

  const refs = { draggingTabIdRef, dragHapticTargetRef };
  const getItemDragProps = useItemDragProps({
    tabs, haptics, ...refs, suppressClickRef, setDraggingTabId, setDragOverTarget, clearDragState,
  });
  const stripDragProps = useStripDragProps({
    stripRef, tabs, onReorder, reorderTiming, haptics, ...refs, setDragOverTarget, clearDragState,
  });

  return { draggingTabId, dragOverTarget, stripRef, stripDragProps, getItemDragProps };
}
