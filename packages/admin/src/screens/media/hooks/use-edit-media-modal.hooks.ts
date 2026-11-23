import { useAdminKitValues } from "../../../react/kit.js";
import { useEffect, useRef, type MouseEvent, type SyntheticEvent } from "react";

/**
 * @file `EditMediaModal`'s native `<dialog>` lifecycle — the metadata edit form used to render as
 * a full-width `.card` pushing the grid down (`Media.tsx`'s own header comment has the history);
 * owner ask (2026-09-07): reach it from an eye icon on the card instead, as a modal. This hook owns
 * exactly the open/close/backdrop/Escape mechanics, same shape as the host's `features/pages/ThemePageDetailsModal.hooks.tsx`'s
 * `useThemePageDetailsModal` and `shell/components/AssistantDock/MessageOverflowModal.hooks.tsx` — copied rather than
 * imported, same reasoning those two give each other: a future media-specific tweak (e.g. warning
 * on unsaved changes before backdrop-dismiss) should never silently change an unrelated table's
 * modal, and vice versa.
 *
 * The dialog helpers come from the host's `AdminKitValues` (`openLightboxDialog`/`closeLightboxDialog`),
 * the same kit seam `MessageOverflowModal.hooks.tsx` reads.
 *
 * Only one instance is ever mounted — the host `Media.tsx`'s `MediaLibraryPanel` renders exactly one
 * `<EditMediaModal>`, toggling only its `item` prop as the selection changes (`editingId`/
 * `editingItem` in `use-media.hooks.ts`), the same "controlled, never conditionally unmounted"
 * shape `ConfirmDialog`/`MediaLightbox`/`ThemePageDetailsModal` all use. The actual form content
 * (`EditMediaPanel`) still gets a `key={item.id}` from its caller so switching the edit target
 * remounts it and reseeds its draft — this hook has no opinion on that; it only opens and closes
 * the `<dialog>` box around whatever is currently keyed inside it.
 */
export interface EditMediaModalController {
  dialogRef: React.RefObject<HTMLDialogElement | null>;
  /** Fires on the dialog's native `cancel` event (Escape). Prevented and routed through `onClose`
   *  rather than left to the browser's own close — the lifecycle effect below is the single source
   *  of truth for open/closed, driven by `open`. */
  handleNativeCancel: (e: SyntheticEvent<HTMLDialogElement>) => void;
  /** A `<dialog>`'s own box is sized to its content, not the viewport — a click landing on the
   *  `<dialog>` element itself (not one of its children) is a click on the backdrop area. */
  handleBackdropClick: (e: MouseEvent<HTMLDialogElement>) => void;
}

/**
 * Owns `EditMediaModal`'s native `<dialog>` open/close lifecycle and its two dismiss paths
 * (Escape, backdrop click) — Save/Cancel stay plain `onClick` handlers inside `EditMediaPanel`
 * itself, since they need no dialog-level state.
 *
 * @param open - Whether the dialog should be showing (`editingItem !== null` at the call site).
 * @param onClose - Called on any dismiss path (Cancel, Save, backdrop click, Escape) — the caller
 *   clears `editingId` the same way it already did for the old inline panel's `onCancel`.
 * @returns `dialogRef` to attach to the `<dialog>` element, plus its `cancel`/backdrop-click
 *   handlers.
 * @complexity Time/space: O(1) per open/close transition — one `showModal`/`close` call, no other
 *   state.
 */
export function useEditMediaModal(open: boolean, onClose: () => void): EditMediaModalController {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const { openLightboxDialog, closeLightboxDialog } = useAdminKitValues();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open) openLightboxDialog(dialog);
    else closeLightboxDialog(dialog);
  }, [open, openLightboxDialog, closeLightboxDialog]);

  function handleNativeCancel(e: SyntheticEvent<HTMLDialogElement>) {
    e.preventDefault();
    onClose();
  }

  function handleBackdropClick(e: MouseEvent<HTMLDialogElement>) {
    if (e.target === dialogRef.current) onClose();
  }

  return { dialogRef, handleNativeCancel, handleBackdropClick };
}
