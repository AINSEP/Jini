import { type ReactNode } from 'react';
import { resolveTone, toneClassName, type ConfirmTone } from '../../types.js';
import { useConfirmDialog } from './ConfirmDialog.hooks.js';

/**
 * @file Shared modal confirmation primitive — the replacement for `window.confirm`, which blocks
 * the whole tab, cannot carry destructive-vs-neutral styling, and reads as a browser artifact
 * rather than part of the product.
 *
 * Built on the native `<dialog>` element (`showModal()`/`close()`) rather than a plain-`<div>`
 * overlay + backdrop idiom: that shape hand-rolls focus trapping, Escape handling, and a backdrop
 * element, all of which the browser's own top layer gives a real `<dialog>` for free, including
 * correct stacking above everything else on the page without a chosen `z-index`. The `showModal`/
 * `close` calls themselves, and the jsdom fallback they need, live in `ConfirmDialog.hooks.tsx` —
 * see that file's doc comment.
 *
 * Unstyled, like everything in this layer: the `.confirm-dialog` / `.btn-secondary` /
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
  /** Injectable seam for the dialog's open/close and focus-management hook. Defaults to the real
   *  {@link useConfirmDialog}; a test can pass a fake here to exercise `ConfirmDialog`'s rendering
   *  without invoking the native `<dialog>` methods or DOM focus calls at all. */
  useDialog?: typeof useConfirmDialog;
}

const DEFAULT_CANCEL_LABEL = 'Cancel';

/**
 * Controlled modal confirm — renders the `<dialog>` markup and delegates its open/close and focus
 * lifecycle to {@link useConfirmDialog} (injectable via the `useDialog` prop, defaulted to the real
 * implementation, so a test can supply a fake without mocking modules).
 *
 * Both actions are plain `type="button"` (no `<form method="dialog">`, no `type="submit"`), so there
 * is no browser-assigned "default button" for Enter to reach for at all; confirm can only ever fire
 * from an explicit click or explicit Tab-then-Enter onto it.
 */
export function ConfirmDialog({ useDialog = useConfirmDialog, ...props }: ConfirmDialogProps) {
  const { titleId, dialogRef, cancelRef, handleNativeCancel, handleBackdropClick } = useDialog(
    props.open,
    props.pending,
    props.onCancel,
  );

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
