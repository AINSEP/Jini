import { useEffect, useRef, type MouseEvent, type SyntheticEvent } from "react";

/**
 * Isolate native dialog lifecycle in an injectable hook so rendering can use a fake controller.
 * showModal/close are synchronous browser APIs: no async port or disposed-after-unmount guard
 * is needed. Separate helpers keep each fallback branch shallow rather than nesting in the effect.
 */
/** Idempotent native open; the attribute fallback supports DOM environments without showModal. */
function openDialog(dialog: HTMLDialogElement): void {
  if (typeof dialog.showModal === "function") {
    if (!dialog.open) dialog.showModal();
    return;
  }
  dialog.setAttribute("open", "");
}

/** Mirror the attribute fallback where a DOM environment has no native close method. */
function closeDialog(dialog: HTMLDialogElement): void {
  if (typeof dialog.close === "function") {
    if (dialog.open) dialog.close();
    return;
  }
  dialog.removeAttribute("open");
}

export interface ImagePreviewModalController {
  dialogRef: React.RefObject<HTMLDialogElement | null>;
  /** Prevent native Escape-close and route through onClose; the open prop/effect owns lifecycle. */
  handleNativeCancel: (e: SyntheticEvent<HTMLDialogElement>) => void;
  /** The dialog box is content-sized: a target on the dialog itself, rather than a child, is backdrop. */
  handleBackdropClick: (e: MouseEvent<HTMLDialogElement>) => void;
}

export function useImagePreviewModal({ open, onClose }: { open: boolean; onClose: () => void }): ImagePreviewModalController {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open) openDialog(dialog);
    else closeDialog(dialog);
  }, [open]);

  function handleNativeCancel(e: SyntheticEvent<HTMLDialogElement>) {
    e.preventDefault();
    onClose();
  }

  function handleBackdropClick(e: MouseEvent<HTMLDialogElement>) {
    if (e.target === dialogRef.current) onClose();
  }

  return { dialogRef, handleNativeCancel, handleBackdropClick };
}
