import { useEffect, useRef, useState } from 'react';

/**
 * @file `ConfirmButton`'s armed/disarmed state, split out of the component so it can be swapped for
 * a fake via the `useConfirmButton` prop on `ConfirmButtonProps` — see that prop's doc comment in
 * `ConfirmButton.tsx`.
 */

/**
 * Owns `ConfirmButton`'s armed/disarmed state: arms on the first click, disarms on Escape, an
 * outside mousedown, or a blur — all without firing `onConfirm`, so a control armed and then
 * abandoned (a slow screen-reader read-through, a misclick landing elsewhere) cannot later be fired
 * by an unrelated click landing on the same screen position. The second click while armed fires
 * `onConfirm` and disarms immediately.
 *
 * @complexity O(1) per render/interaction. The two document-level listeners are attached only while
 * armed, not for the component's whole mounted lifetime.
 */
export function useConfirmButton(
  { onConfirm, document }: { readonly onConfirm: () => void; readonly document: Pick<Document, 'addEventListener' | 'removeEventListener'> },
  { pending, disabled }: { readonly pending?: boolean | undefined; readonly disabled?: boolean | undefined } = {},
) {
  const [confirming, setConfirming] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // Listeners are scoped to the armed window only — an idle (disarmed) ConfirmButton costs nothing
  // beyond the button element itself, so mounting many of them (one per table row) does not add a
  // standing per-row document listener.
  useEffect(() => {
    if (!confirming) return;
    function disarm() {
      setConfirming(false);
    }
    function onDocMouseDown(e: globalThis.MouseEvent) {
      if (!buttonRef.current?.contains(e.target as Node)) disarm();
    }
    function onKeyDown(e: globalThis.KeyboardEvent) {
      if (e.key === 'Escape') disarm();
    }
    document.addEventListener('mousedown', onDocMouseDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onDocMouseDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [confirming, document]);

  function handleClick() {
    if (pending || disabled) return;
    if (!confirming) {
      setConfirming(true);
      return;
    }
    setConfirming(false);
    onConfirm();
  }

  function handleBlur() {
    setConfirming(false);
  }

  return { confirming, buttonRef, handleClick, handleBlur };
}
