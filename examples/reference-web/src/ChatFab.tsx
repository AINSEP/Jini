import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * A draggable floating button that opens and closes the chat pane.
 *
 * Drag and click share one pointer gesture, so the two have to be told apart: a press that moves
 * less than {@link DRAG_THRESHOLD_PX} is a click, anything more is a drag and does not toggle.
 * Without that, every drag would also fire the toggle on release.
 *
 * Position is clamped to the viewport on drag and re-clamped on resize, because a button dragged
 * to the right edge of a wide window is off-screen and unreachable in a narrow one.
 */

/** Movement below this is a click, not a drag. Roughly the slop of a deliberate tap. */
const DRAG_THRESHOLD_PX = 4;

/** Keeps the button fully on screen with a small margin. */
const EDGE_MARGIN_PX = 8;

interface Position {
  readonly x: number;
  readonly y: number;
}

export interface ChatFabProps {
  readonly open: boolean;
  readonly onToggle: () => void;
  /** Rendered as the accessible name, and announced as a state change to assistive tech. */
  readonly label?: string;
}

function clampToViewport(position: Position, size: { width: number; height: number }): Position {
  const maxX = Math.max(EDGE_MARGIN_PX, globalThis.innerWidth - size.width - EDGE_MARGIN_PX);
  const maxY = Math.max(EDGE_MARGIN_PX, globalThis.innerHeight - size.height - EDGE_MARGIN_PX);
  return {
    x: Math.min(Math.max(position.x, EDGE_MARGIN_PX), maxX),
    y: Math.min(Math.max(position.y, EDGE_MARGIN_PX), maxY),
  };
}

export function ChatFab({ open, onToggle, label = 'chat' }: ChatFabProps) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  /** `null` until first drag: the button sits wherever CSS puts it, so it stays responsive. */
  const [position, setPosition] = useState<Position | null>(null);
  const drag = useRef<{ pointerId: number; offsetX: number; offsetY: number; moved: boolean } | null>(null);

  useEffect(() => {
    const onResize = () => {
      const element = buttonRef.current;
      if (!element) return;
      setPosition((current) => (current === null
        ? null
        : clampToViewport(current, { width: element.offsetWidth, height: element.offsetHeight })));
    };
    globalThis.addEventListener('resize', onResize);
    return () => globalThis.removeEventListener('resize', onResize);
  }, []);

  const onPointerDown = useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
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

  const onPointerMove = useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    const state = drag.current;
    if (state === null || state.pointerId !== event.pointerId) return;
    const element = event.currentTarget;
    const next = clampToViewport(
      { x: event.clientX - state.offsetX, y: event.clientY - state.offsetY },
      { width: element.offsetWidth, height: element.offsetHeight },
    );
    const rect = element.getBoundingClientRect();
    if (Math.abs(next.x - rect.left) > DRAG_THRESHOLD_PX || Math.abs(next.y - rect.top) > DRAG_THRESHOLD_PX) {
      state.moved = true;
    }
    // Only commit a position once this is genuinely a drag. Setting it on every move meant a
    // click with a pixel of jitter pinned the button to an inline `left`/`top` forever — which
    // silently defeats the CSS default and made the button appear to wander on its own.
    if (state.moved) setPosition(next);
  }, []);

  const endDrag = useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    const state = drag.current;
    if (state === null || state.pointerId !== event.pointerId) return;
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (!state.moved) onToggle();
  }, [onToggle]);

  return (
    <button
      ref={buttonRef}
      type="button"
      className={`chat-fab${open ? ' chat-fab-open' : ''}`}
      // Not `onClick`: the pointer gesture already decides click-versus-drag, and keeping both
      // would fire the toggle twice on a tap.
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onKeyDown={(event) => {
        // Pointer handling bypasses the implicit click, so keyboard activation is wired directly
        // — otherwise the button would be unusable without a mouse.
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onToggle();
        }
      }}
      style={position === null ? undefined : { left: position.x, top: position.y, right: 'auto', bottom: 'auto' }}
      aria-expanded={open}
      aria-label={open ? `Hide ${label}` : `Show ${label}`}
      /*
       * Deliberately NOT tagged with `data-agent-element`. The page driver is scoped to the
       * content `<main>`, so a handle here would be advertised and then never resolve. It is also
       * pointless as a capability: an agent reachable through the chat pane cannot usefully ask
       * to un-hide the pane it is already speaking through.
       */
    >
      <span aria-hidden="true">{open ? '×' : '💬'}</span>
    </button>
  );
}
