import { useEffect, useId, useRef, type MouseEvent, type ReactNode, type SyntheticEvent } from 'react';
import { resolveTone, toneClassName, type ConfirmTone } from './confirm-tone.js';

/**
 * @file Shared modal confirmation primitive — the replacement for `window.confirm`, which blocks
 * the whole tab, cannot carry destructive-vs-neutral styling, and reads as a browser artifact
 * rather than part of the product.
 *
 * Built on the native `<dialog>` element (`showModal()`/`close()`) rather than a plain-`<div>`
 * overlay + backdrop idiom: that shape hand-rolls focus trapping, Escape handling, and a backdrop
 * element, all of which the browser's own top layer gives a real `<dialog>` for free, including
 * correct stacking above everything else on the page without a chosen `z-index`.
 *
 * `dialog.showModal()`/`dialog.close()` are guarded by a `typeof` check rather than called
 * unconditionally: jsdom (this package's React test environment, verified directly rather than
 * assumed) does not implement either method at all — calling them throws `TypeError`. The fallback
 * branch below toggles the plain `open` attribute instead, which no browser shipping a real
 * `<dialog>` ever takes (the `showModal`/`close` branch always wins there), so this only changes
 * behavior under jsdom, where it keeps the dialog mountable and its content queryable.
 *
 * Unstyled, like the rest of this flat-component set: the `.confirm-dialog` / `.btn-secondary` /
 * `.btn-danger` / `.btn-warning` class names are emitted for the host stylesheet to define.
 */

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  body: ReactNode;
  confirmLabel: string;
  /** @default "Cancel" */
  cancelLabel?: string;
  /** Applies `.btn-warning`/`.btn-danger` to the confirm action. Defaults to `"default"` (no class,
   *  the plain primary button). Wins over `destructive` below when both are passed. */
  tone?: ConfirmTone;
  /** @deprecated Use `tone: "danger"` instead — this only ever expressed the danger tier, and the
   *  vocabulary has a second one (`"warning"`) this boolean cannot reach. Kept working (mapped to
   *  `tone: "danger"` when `tone` is not set) for existing callers rather than a breaking rename. */
  destructive?: boolean;
  /** External in-flight flag. Disables both actions and blocks Escape/backdrop dismissal so a
   *  request already underway cannot be raced by a second dismiss. */
  pending?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

const DEFAULT_CANCEL_LABEL = 'Cancel';

/**
 * Opens `dialog` modally, falling back to the plain `open` attribute where `showModal` is absent.
 * See the file header for why that fallback exists (jsdom implements neither method).
 *
 * `if (!dialog.open)` guards against calling `showModal()` on an already-open dialog, which throws
 * `InvalidStateError` — reachable whenever the effect below re-runs while `open` stays true.
 */
function showDialog(dialog: HTMLDialogElement): void {
  if (typeof dialog.showModal !== 'function') {
    dialog.setAttribute('open', '');
    return;
  }
  if (!dialog.open) dialog.showModal();
}

/** The mirror of {@link showDialog}: closes `dialog`, or clears the attribute under the fallback. */
function hideDialog(dialog: HTMLDialogElement): void {
  if (typeof dialog.close !== 'function') {
    dialog.removeAttribute('open');
    return;
  }
  if (dialog.open) dialog.close();
}

/**
 * Controlled modal confirm. The caller keeps this mounted and toggles `open` — it is never
 * conditionally rendered by its parent — so the effect below has a stable `<dialog>` element to
 * call `showModal()`/`close()` on and to restore focus through when it closes.
 *
 * Focus moves to the *cancel* action on open, not confirm — an operator whose first keystroke after
 * a slow read-through is Enter should land on the safe action, not the destructive one. Both
 * actions are plain `type="button"` (no `<form method="dialog">`, no `type="submit"`), so there is
 * no browser-assigned "default button" for Enter to reach for at all; confirm can only ever fire
 * from an explicit click or explicit Tab-then-Enter onto it.
 *
 * @complexity O(1) per open/close transition — one `showModal`/`close` call and one focus move.
 */
export function ConfirmDialog(props: ConfirmDialogProps) {
  // `useId()`, not a string literal — a hardcoded id breaks the moment a screen mounts two
  // `ConfirmDialog`s at once (a delete-role and a delete-policy confirm on one page, both
  // stay-mounted/toggle-`open` per this component's own doc comment above): two `<h2>`s share one
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
    if (props.open) {
      triggerRef.current = document.activeElement;
      showDialog(dialog);
      cancelRef.current?.focus();
      return;
    }
    hideDialog(dialog);
    if (triggerRef.current instanceof HTMLElement) triggerRef.current.focus();
  }, [props.open]);

  function handleNativeCancel(e: SyntheticEvent<HTMLDialogElement>) {
    // Fires on Escape while a real `showModal()`-opened dialog has focus. Always prevented: the
    // effect above is the single source of truth for open/closed (driven by `props.open`), so
    // letting the browser close the element on its own would desync DOM state from React state.
    // Escape still closes the dialog — it just does so by routing through `onCancel`, same as a
    // Cancel-button click, so the caller's `open` state (and therefore this same effect) is what
    // actually calls `dialog.close()`.
    e.preventDefault();
    if (props.pending) return;
    props.onCancel();
  }

  function handleBackdropClick(e: MouseEvent<HTMLDialogElement>) {
    // A `<dialog>` element's own box is sized to its content, not the viewport — a click that lands
    // on the `<dialog>` element itself (as opposed to one of its children) is therefore a click on
    // the backdrop area outside that content box.
    if (props.pending) return;
    if (e.target === dialogRef.current) props.onCancel();
  }

  return (
    <dialog
      ref={dialogRef}
      className="confirm-dialog"
      aria-labelledby={titleId}
      onCancel={handleNativeCancel}
      onClick={handleBackdropClick}
    >
      <h2 id={titleId}>{props.title}</h2>
      <div className="confirm-dialog-body">{props.body}</div>
      <div className="confirm-dialog-actions">
        <button
          ref={cancelRef}
          type="button"
          className="btn-secondary"
          disabled={props.pending}
          onClick={props.onCancel}
        >
          {props.cancelLabel ?? DEFAULT_CANCEL_LABEL}
        </button>
        <button
          type="button"
          className={toneClassName(resolveTone(props))}
          disabled={props.pending}
          onClick={props.onConfirm}
        >
          {props.confirmLabel}
        </button>
      </div>
    </dialog>
  );
}
