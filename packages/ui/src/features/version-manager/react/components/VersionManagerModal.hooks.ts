import { useCallback, useEffect, useRef } from 'react';

/** Keep the modal open when an inner prompt owns Escape. */
export function useVersionManagerEscape({ onClose }: { onClose: () => void }, _options = {}) {
  // Layered Escape handling: close the modal only when neither popover is
  // consuming the keystroke — each popover owns its own Escape dismissal
  // via `useDismissOnOutsideOrEscape`, so this only needs to know whether
  // to let Escape reach the modal itself. Simplified from the source's
  // single-listener if/else priority chain to two independently-scoped
  // listeners plus this modal-level one; see source-map.md for why this is
  // a disclosed, behavior-preserving-in-practice simplification.
  //
  // `promptOpenRef` is how the modal knows "to let Escape reach the modal
  // itself": `VersionPromptPopover` is mounted once (unconditionally) and
  // registers its own document `keydown` listener only while it holds
  // itself open, so this modal-level listener — added once at mount,
  // always earlier in the document's listener order than any popover
  // listener it later attaches on open — reads the ref synchronously
  // before the popover's own handler has run and closes itself. A plain
  // `event.stopPropagation()` in the popover wouldn't help here since its
  // listener always fires *after* this one for that reason.
  const promptOpenRef = useRef(false);
  const handleEscape = useCallback(
    (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !promptOpenRef.current) onClose();
    },
    [onClose],
  );
  useEffect(() => {
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [handleEscape]);

  return promptOpenRef;
}
