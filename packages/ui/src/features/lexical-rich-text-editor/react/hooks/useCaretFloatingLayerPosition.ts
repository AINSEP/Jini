'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import {
  CARET_LAYER_GAP,
  CARET_LAYER_HARD_MAX_HEIGHT,
  CARET_LAYER_MARGIN,
  CARET_LAYER_PREFERRED_WIDTH,
} from '../../constants.js';
import { computeCaretFloatingLayerPosition, type CaretFloatingLayerPosition } from '../../rules.js';
import type { CaretRect } from '../../types.js';

export interface UseCaretFloatingLayerPositionResult {
  pos: CaretFloatingLayerPosition | null;
  layerRef: RefObject<HTMLDivElement | null>;
}

/** Origin: `CaretFloatingLayer.tsx`'s inline `reposition`/effect logic,
 *  extracted into its own hook so the component stays presentational.
 *  Measured pass on open + every caret change (`useLayoutEffect` avoids a
 *  wrong-coordinate flash before paint); pinned + rAF-throttled while open
 *  (repositions rather than closes on scroll, so a small ancestor scroll
 *  doesn't feel broken — `capture: true` catches ancestor scroll too). */
export function useCaretFloatingLayerPosition(
  caret: CaretRect | null,
  open: boolean,
  boundaryRef?: RefObject<HTMLElement | null> | undefined,
): UseCaretFloatingLayerPositionResult {
  const layerRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<CaretFloatingLayerPosition | null>(null);

  const reposition = useCallback(() => {
    if (!caret) return;
    const el = layerRef.current;
    const size = el ? { width: el.offsetWidth, height: el.scrollHeight } : null;
    const boundary = boundaryRef?.current?.getBoundingClientRect() ?? null;
    setPos(
      computeCaretFloatingLayerPosition(caret, size, boundary, {
        gap: CARET_LAYER_GAP,
        margin: CARET_LAYER_MARGIN,
        hardMaxHeight: CARET_LAYER_HARD_MAX_HEIGHT,
        preferredWidth: CARET_LAYER_PREFERRED_WIDTH,
      }),
    );
  }, [boundaryRef, caret]);

  useLayoutEffect(() => {
    if (open && caret) reposition();
  }, [open, caret, reposition]);

  useEffect(() => {
    if (!open) return;
    let raf = 0;
    const onMove = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        reposition();
      });
    };
    window.addEventListener('resize', onMove);
    window.addEventListener('scroll', onMove, true);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener('resize', onMove);
      window.removeEventListener('scroll', onMove, true);
    };
  }, [open, reposition]);

  return { pos, layerRef };
}
