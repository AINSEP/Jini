import { useEffect, useId, useRef, type MouseEvent, type RefObject, type SyntheticEvent } from 'react';

/**
 * @file `ConfirmDialog`'s open/close and focus-management state, split out of the component so it
 * can be swapped for a fake via the `useDialog` prop on `ConfirmDialogProps` — see that prop's doc
 * comment in `ConfirmDialog.tsx`.
 *
 * `dialog.showModal()`/`dialog.close()` are guarded by a `typeof` check rather than called
 * unconditionally: jsdom (this package's React test environment, verified directly rather than
 * assumed) does not implement either method at all — calling them throws `TypeError`. The fallback
 * branch below toggles the plain `open` attribute instead, which no browser shipping a real
 * `<dialog>` ever takes (the `showModal`/`close` branch always wins there), so this only changes
 * behavior under jsdom, where it keeps the dialog mountable and its content queryable.
 */

/**
 * What `ConfirmDialog` needs back from whatever drives its dialog lifecycle: the two refs it
 * attaches and the two handlers it wires, plus the id its `aria-labelledby` points at.
 *
 * Declared as its own interface rather than left to be inferred from {@link useConfirmDialog}'s
 * return object. That inference is what made the injectable `useDialog` prop couple to the concrete
 * implementation: `typeof useConfirmDialog` meant every internal detail of the default hook's shape
 * became part of the component's PUBLIC contract, so adding a field for the default's own
 * convenience would silently break every substitute a consumer had already written. Naming the
 * contract inverts that — the hook now has to satisfy the component, not the other way round.
 */
export interface ConfirmDialogController {
  /** Id for the dialog's `<h2>`, unique per mounted instance — see {@link useConfirmDialog}. */
  titleId: string;
  dialogRef: RefObject<HTMLDialogElement | null>;
  cancelRef: RefObject<HTMLButtonElement | null>;
  handleNativeCancel: (event: SyntheticEvent<HTMLDialogElement>) => void;
  handleBackdropClick: (event: MouseEvent<HTMLDialogElement>) => void;
}

/** The signature `ConfirmDialogProps.useDialog` accepts. Any hook matching this can drive the
 *  component; it does not have to be {@link useConfirmDialog}, or even use React state at all. */
export type UseConfirmDialog = (
  open: boolean,
  pending: boolean | undefined,
  onCancel: () => void,
) => ConfirmDialogController;

/**
 * Owns the `<dialog>` element's open/close lifecycle and focus management for `ConfirmDialog`.
 *
 * The caller keeps `ConfirmDialog` mounted and toggles `open` — it is never conditionally rendered
 * by its parent — so the effect below has a stable `<dialog>` element to call `showModal()`/
 * `close()` on and to restore focus through when it closes.
 *
 * Focus moves to the *cancel* action on open, not confirm — an operator whose first keystroke after
 * a slow read-through is Enter should land on the safe action, not the destructive one.
 *
 * @complexity O(1) per open/close transition — one `showModal`/`close` call and one focus move.
 */
export function useConfirmDialog(
  open: boolean,
  pending: boolean | undefined,
  onCancel: () => void,
): ConfirmDialogController {
  // `useId()`, not a string literal — a hardcoded id breaks the moment a screen mounts two
  // `ConfirmDialog`s at once (a delete-role and a delete-policy confirm on one page, both
  // stay-mounted/toggle-`open` per this hook's own doc comment above): two `<h2>`s share one
  // id, and `aria-labelledby` resolves via `getElementById`, which always returns the FIRST match
  // in document order regardless of which dialog is actually open — a screen reader announcing
  // "Delete role?" while the operator is about to confirm "Delete policy?", on a destructive
  // action. `useId()` gives every mounted instance its own id for free.
  const titleId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  // Captured at the moment `open` flips true, before focus moves into the dialog — the element that
  // had focus then is, by construction, whatever triggered this dialog (a `RowMenu` item's
  // "Delete", a plain trigger button, …). Restored on close rather than left wherever the browser's
  // own modal-focus algorithm happened to land (its default without this is `<body>`, which drops a
  // keyboard user back to the top of the page).
  const triggerRef = useRef<Element | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open) {
      triggerRef.current = document.activeElement;
      if (typeof dialog.showModal === 'function') {
        if (!dialog.open) dialog.showModal();
      } else {
        dialog.setAttribute('open', '');
      }
      cancelRef.current?.focus();
    } else {
      if (typeof dialog.close === 'function') {
        if (dialog.open) dialog.close();
      } else {
        dialog.removeAttribute('open');
      }
      if (triggerRef.current instanceof HTMLElement) triggerRef.current.focus();
    }
  }, [open]);

  function handleNativeCancel(e: SyntheticEvent<HTMLDialogElement>) {
    // Fires on Escape while a real `showModal()`-opened dialog has focus. Always prevented: the
    // effect above is the single source of truth for open/closed (driven by `open`), so
    // letting the browser close the element on its own would desync DOM state from React state.
    // Escape still closes the dialog — it just does so by routing through `onCancel`, same as a
    // Cancel-button click, so the caller's `open` state (and therefore this same effect) is what
    // actually calls `dialog.close()`.
    e.preventDefault();
    if (pending) return;
    onCancel();
  }

  function handleBackdropClick(e: MouseEvent<HTMLDialogElement>) {
    // A `<dialog>` element's own box is sized to its content, not the viewport — a click that lands
    // on the `<dialog>` element itself (as opposed to one of its children) is therefore a click on
    // the backdrop area outside that content box.
    if (pending) return;
    if (e.target === dialogRef.current) onCancel();
  }

  return { titleId, dialogRef, cancelRef, handleNativeCancel, handleBackdropClick };
}
