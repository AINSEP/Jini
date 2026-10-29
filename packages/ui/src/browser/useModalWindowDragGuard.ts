import { useEffect } from 'react';

/**
 * Height (px) of the "drag strip" at the top of a modal's backdrop that a
 * host treats as a window-drag handle rather than a dismiss target.
 */
export const MODAL_WINDOW_DRAG_STRIP_HEIGHT = 56;

/**
 * True if `event` landed inside the drag-strip region (the top
 * `MODAL_WINDOW_DRAG_STRIP_HEIGHT` px) of an element matching
 * `backdropSelector`.
 */
export function eventHitsModalWindowDragStrip(
  event: MouseEvent | PointerEvent,
  backdropSelector: string,
): boolean {
  const target = event.target;
  return (
    event.clientY >= 0 &&
    event.clientY <= MODAL_WINDOW_DRAG_STRIP_HEIGHT &&
    target instanceof Element &&
    target.matches(backdropSelector)
  );
}

export interface UseModalWindowDragGuardOptions {
  /**
   * CSS selector matching the backdrop element(s) whose top drag strip
   * should be protected. Pass a comma-joined list to cover several modal
   * backdrop classes at once (e.g. `'.my-modal-backdrop, .other-backdrop'`).
   */
  backdropSelector: string;
  /** Disable the guard without unmounting it. Defaults to `true`. */
  enabled?: boolean;
}

/**
 * Stops a pointerdown/mousedown/click inside a modal backdrop's drag strip
 * from propagating further up the DOM tree. Intended for hosts that let
 * users drag the surrounding window (e.g. a frameless desktop shell) via a
 * strip at the top of a modal's backdrop: without this guard, that same
 * click also reaches an ancestor's outside-click-to-dismiss listener and
 * closes the modal the drag strip sits on top of.
 *
 * Listens in the capture phase on `document` for the lifetime of the
 * component, matching pointer/mouse events against `eventHitsModalWindowDragStrip`
 * and calling `event.stopPropagation()` on a hit.
 */
export function useModalWindowDragGuard(options: UseModalWindowDragGuardOptions): void {
  const { backdropSelector, enabled = true } = options;

  useEffect(() => {
    if (!enabled) return undefined;

    const stopBackdropDismissInDragStrip = (event: MouseEvent | PointerEvent) => {
      if (eventHitsModalWindowDragStrip(event, backdropSelector)) {
        event.stopPropagation();
      }
    };

    document.addEventListener('pointerdown', stopBackdropDismissInDragStrip, true);
    document.addEventListener('mousedown', stopBackdropDismissInDragStrip, true);
    document.addEventListener('click', stopBackdropDismissInDragStrip, true);
    return () => {
      document.removeEventListener('pointerdown', stopBackdropDismissInDragStrip, true);
      document.removeEventListener('mousedown', stopBackdropDismissInDragStrip, true);
      document.removeEventListener('click', stopBackdropDismissInDragStrip, true);
    };
  }, [backdropSelector, enabled]);
}
