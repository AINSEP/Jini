'use client';

import type { CSSProperties, ReactNode, RefObject } from 'react';
import { createPortal } from 'react-dom';
import { CARET_LAYER_PREFERRED_WIDTH } from '../../constants.js';
import type { CaretRect } from '../../types.js';
import { useCaretFloatingLayerPosition } from '../hooks/useCaretFloatingLayerPosition.js';

export interface CaretFloatingLayerProps {
  /** Where to anchor the popover — typically the trigger match's
   *  `anchorRect`, or `null` while no trigger is active. */
  caret: CaretRect | null;
  open: boolean;
  /** Confines the popover's left/right clamp to this element's box instead
   *  of the whole viewport (e.g. a chat panel narrower than the window). */
  boundaryRef?: RefObject<HTMLElement | null> | undefined;
  children: ReactNode;
  className?: string;
}

/** Origin: `apps/web/src/components/composer/CaretFloatingLayer.tsx`. A
 *  portal (`document.body`) positioned against a caret rect — the
 *  mention/command popover renders inside this. No OD-specific surface;
 *  ported verbatim except for the extracted `useCaretFloatingLayerPosition`
 *  hook and generic class/CSS-variable names. */
export function CaretFloatingLayer({
  caret,
  open,
  boundaryRef,
  children,
  className = 'rich-text-caret-floating-layer',
}: CaretFloatingLayerProps) {
  const { pos, layerRef } = useCaretFloatingLayerPosition(caret, open, boundaryRef);

  if (!open || !caret || typeof document === 'undefined') return null;

  const style: CSSProperties = pos
    ? {
        position: 'fixed',
        left: `${pos.left}px`,
        top: `${pos.top}px`,
        width: `${pos.width}px`,
        ['--rich-text-caret-layer-max-height' as string]: `${pos.maxHeight}px`,
      }
    : {
        // Pre-measure off-screen so sizing causes no flash.
        position: 'fixed',
        left: '-9999px',
        top: '0px',
        width: `${CARET_LAYER_PREFERRED_WIDTH}px`,
        visibility: 'hidden',
      };

  return createPortal(
    <div ref={layerRef} className={className} data-placement={pos?.placement ?? 'above'} style={style}>
      {children}
    </div>,
    document.body,
  );
}
