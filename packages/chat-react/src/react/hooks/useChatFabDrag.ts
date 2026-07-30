/**
 * @module useChatFabDrag
 *
 * Drag and click share one pointer gesture, so the two have to be told apart: a press that moves
 * less than {@link CHAT_FAB_DRAG_THRESHOLD_PX} is a click, anything more is a drag and does not
 * fire `onClick`. Without that, every drag would also fire the click on release. Position is
 * clamped to the viewport on drag and re-clamped on resize, because a button dragged to the right
 * edge of a wide window is off-screen and unreachable in a narrower one.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent, RefObject } from 'react';

/** Movement below this is a click, not a drag. Roughly the slop of a deliberate tap. */
export const CHAT_FAB_DRAG_THRESHOLD_PX = 4;

/** Keeps the button fully on screen with a small margin. */
export const CHAT_FAB_EDGE_MARGIN_PX = 8;

export interface ChatFabPosition {
  readonly x: number;
  readonly y: number;
}

export interface UseChatFabDragResult {
  buttonRef: RefObject<HTMLButtonElement | null>;
  /** `null` until first drag: the button sits wherever CSS puts it, so it stays responsive. */
  position: ChatFabPosition | null;
  onPointerDown: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onPointerUp: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onPointerCancel: (event: ReactPointerEvent<HTMLButtonElement>) => void;
}

/** Keeps a dragged position fully on screen, re-clamped on drag and on viewport resize. */
export function clampChatFabToViewport(
  position: ChatFabPosition,
  size: { width: number; height: number },
): ChatFabPosition {
  const maxX = Math.max(CHAT_FAB_EDGE_MARGIN_PX, globalThis.innerWidth - size.width - CHAT_FAB_EDGE_MARGIN_PX);
  const maxY = Math.max(CHAT_FAB_EDGE_MARGIN_PX, globalThis.innerHeight - size.height - CHAT_FAB_EDGE_MARGIN_PX);
  return {
    x: Math.min(Math.max(position.x, CHAT_FAB_EDGE_MARGIN_PX), maxX),
    y: Math.min(Math.max(position.y, CHAT_FAB_EDGE_MARGIN_PX), maxY),
  };
}

export function useChatFabDrag(onClick: () => void): UseChatFabDragResult {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [position, setPosition] = useState<ChatFabPosition | null>(null);
  const drag = useRef<{ pointerId: number; offsetX: number; offsetY: number; moved: boolean } | null>(null);

  useEffect(() => {
    const onResize = () => {
      const element = buttonRef.current;
      if (!element) return;
      setPosition((current) => (current === null
        ? null
        : clampChatFabToViewport(current, { width: element.offsetWidth, height: element.offsetHeight })));
    };
    globalThis.addEventListener('resize', onResize);
    return () => globalThis.removeEventListener('resize', onResize);
  }, []);

  const onPointerDown = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    const element = event.currentTarget;
    const rect = element.getBoundingClientRect();
    element.setPointerCapture(event.pointerId);
    drag.current = {
      pointerId: event.pointerId,
      // Offset within the button, so it does not jump to centre itself under the cursor.
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
      moved: false,
    };
  }, []);

  const onPointerMove = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    const state = drag.current;
    if (state === null || state.pointerId !== event.pointerId) return;
    const element = event.currentTarget;
    const next = clampChatFabToViewport(
      { x: event.clientX - state.offsetX, y: event.clientY - state.offsetY },
      { width: element.offsetWidth, height: element.offsetHeight },
    );
    const rect = element.getBoundingClientRect();
    if (Math.abs(next.x - rect.left) > CHAT_FAB_DRAG_THRESHOLD_PX || Math.abs(next.y - rect.top) > CHAT_FAB_DRAG_THRESHOLD_PX) {
      state.moved = true;
    }
    // Only commit a position once this is genuinely a drag. Setting it on every move meant a
    // click with a pixel of jitter pinned the button to an inline `left`/`top` forever — which
    // silently defeats the CSS default and made the button appear to wander on its own.
    if (state.moved) setPosition(next);
  }, []);

  const endDrag = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    const state = drag.current;
    if (state === null || state.pointerId !== event.pointerId) return;
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (!state.moved) onClick();
  }, [onClick]);

  return {
    buttonRef,
    position,
    onPointerDown,
    onPointerMove,
    onPointerUp: endDrag,
    onPointerCancel: endDrag,
  };
}
