import { useCallback, useEffect, useRef, useState } from 'react';
import { ASSET_ID_SELECTOR } from '../../constants.js';
import { cardIdsInBand, snapshotCardRects } from '../../rules.js';
import type { Band, CardRect } from '../../types.js';

export interface UseRubberBandDragParams {
  containerRef: React.RefObject<HTMLElement | null>;
  selectedIds: ReadonlySet<string>;
  setSelectedIds: React.Dispatch<React.SetStateAction<Set<string>>>;
}

export interface UseRubberBandDragResult {
  band: Band | null;
  dragging: boolean;
  onMouseDown: (e: React.MouseEvent) => void;
}

interface DragState {
  startX: number;
  startY: number;
  additive: boolean;
  base: Set<string>;
  moved: boolean;
  rects: CardRect[];
}

/** The band spanned from the drag origin to `point`, and the selection it yields on top of `drag.base`. */
function bandSelection({ drag, point }: { drag: DragState; point: { x: number; y: number } }, _options = {}) {
  const band: Band = {
    x: Math.min(drag.startX, point.x),
    y: Math.min(drag.startY, point.y),
    w: Math.abs(point.x - drag.startX),
    h: Math.abs(point.y - drag.startY),
  };
  const selection = new Set(drag.base);
  for (const id of cardIdsInBand(drag.rects, band)) selection.add(id);
  return { band, selection };
}

interface DragListenerPorts {
  dragRef: React.MutableRefObject<DragState | null>;
  containerRef: React.RefObject<HTMLElement | null>;
  setBand: React.Dispatch<React.SetStateAction<Band | null>>;
  setDragging: React.Dispatch<React.SetStateAction<boolean>>;
  setSelectedIds: React.Dispatch<React.SetStateAction<Set<string>>>;
}

/** Attaches the window listeners that drive an in-flight drag; returns the cleanup that detaches them. */
function attachDragListeners({ dragRef, containerRef, setBand, setDragging, setSelectedIds }: DragListenerPorts): () => void {
  let raf = 0;
  // `dragging` only ever flips true inside `onMouseDown` above, which sets
  // `dragRef.current` synchronously in that same callback before calling
  // `setDragging(true)` — so by the time this effect runs for
  // `dragging === true`, `dragRef.current` is guaranteed non-null. The `!`
  // below satisfies the type checker for a case that cannot occur at
  // runtime, not a defensive fallback.
  let lastX = dragRef.current!.startX;
  let lastY = dragRef.current!.startY;

  const apply = () => {
    raf = 0;
    const d = dragRef.current;
    if (!d) return;
    const { band: nextBand, selection } = bandSelection({ drag: d, point: { x: lastX, y: lastY } });
    setBand(nextBand);
    setSelectedIds(selection);
  };
  const schedule = () => {
    if (!raf) raf = requestAnimationFrame(apply);
  };
  const move = (e: MouseEvent) => {
    const d = dragRef.current;
    if (!d) return;
    d.moved = true;
    lastX = e.clientX;
    lastY = e.clientY;
    schedule();
  };
  const onScroll = () => {
    const d = dragRef.current;
    if (!d) return;
    d.rects = snapshotCardRects(containerRef.current);
    schedule();
  };
  const up = () => {
    const d = dragRef.current;
    // A click on empty space (no drag) clears the selection.
    if (d && !d.moved && !d.additive) setSelectedIds(new Set());
    dragRef.current = null;
    setDragging(false);
    setBand(null);
  };
  window.addEventListener('mousemove', move);
  window.addEventListener('mouseup', up);
  // Capture so a scrolling inner pane (not just the window) re-snapshots.
  window.addEventListener('scroll', onScroll, true);
  const prevUserSelect = document.body.style.userSelect;
  document.body.style.userSelect = 'none';
  return () => {
    if (raf) cancelAnimationFrame(raf);
    window.removeEventListener('mousemove', move);
    window.removeEventListener('mouseup', up);
    window.removeEventListener('scroll', onScroll, true);
    document.body.style.userSelect = prevUserSelect;
  };
}

/**
 * Mouse-driven rubber-band multi-select over the cards rendered under
 * `containerRef`. Operates purely on `HTMLElement` rects and `Set<string>`
 * ids (`snapshotCardRects`/`cardIdsInBand` in `rules.ts`) — the single
 * cleanest generic core ported from `LibrarySection.tsx`.
 */
export function useRubberBandDrag({
  containerRef,
  selectedIds,
  setSelectedIds,
}: UseRubberBandDragParams): UseRubberBandDragResult {
  const [band, setBand] = useState<Band | null>(null);
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<DragState | null>(null);

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0) return;
      const target = e.target as HTMLElement;
      // Starting on a card is a click / preview gesture, not a box select.
      if (target.closest(ASSET_ID_SELECTOR)) return;
      const additive = e.metaKey || e.ctrlKey || e.shiftKey;
      dragRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        additive,
        base: new Set(additive ? selectedIds : []),
        moved: false,
        // Snapshot every card's box ONCE here, while the whole grid is laid
        // out. The move handler then hit-tests these cached rects instead of
        // forcing a querySelectorAll + getBoundingClientRect reflow on every
        // mouse move.
        rects: snapshotCardRects(containerRef.current),
      };
      setBand({ x: e.clientX, y: e.clientY, w: 0, h: 0 });
      setDragging(true);
    },
    [selectedIds, containerRef],
  );

  useEffect(() => {
    if (!dragging) return undefined;
    return attachDragListeners({ dragRef, containerRef, setBand, setDragging, setSelectedIds });
  }, [dragging, containerRef, setSelectedIds]);

  return { band, dragging, onMouseDown };
}
