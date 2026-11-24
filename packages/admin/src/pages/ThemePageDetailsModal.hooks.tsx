import { useEffect, useRef, type MouseEvent, type SyntheticEvent } from "react";

import { useAdminKitValues } from "../react/kit.js";

/**
 * @file `ThemePageDetailsModal`'s `<dialog>` lifecycle — same native `<dialog>` foundation and the
 * same open/close/backdrop/Escape handling as the host's assistant-dock message-overflow modal hook (real
 * focus trapping and Escape-as-close courtesy of the browser's own top layer, focus returned to
 * whichever `RowMenu` "Details" trigger opened this once it closes). Owned locally rather than
 * imported from that file — same reasoning that file's own header gives for not reusing
 * `@jini-ai/ui`'s admin-widgets `ImagePreviewModal.hooks.tsx`: a future chat-pane-specific tweak to that hook should never
 * silently change this unrelated admin-table modal's behavior too, and vice versa.
 *
 * Only one instance of this modal is ever mounted at a time — the host's `ThemePagesTab` keeps a single
 * `detailPageId` state and renders exactly one `<ThemePageDetailsModal>`, never one per row — so
 * there is no risk of the double-mount shape a per-row modal would have needed to avoid.
 */
export interface ThemePageDetailsModalController {
  dialogRef: React.RefObject<HTMLDialogElement | null>;
  /** Fires on the dialog's native `cancel` event (Escape). Prevented and routed through `onClose`
   *  rather than left to the browser's own close — the lifecycle effect is the single source of
   *  truth for open/closed, driven by `open`. */
  handleNativeCancel: (e: SyntheticEvent<HTMLDialogElement>) => void;
  /** A `<dialog>`'s own box is sized to its content, not the viewport — a click landing on the
   *  `<dialog>` element itself (not one of its children) is a click on the backdrop area. */
  handleBackdropClick: (e: MouseEvent<HTMLDialogElement>) => void;
}

/**
 * Owns `ThemePageDetailsModal`'s native `<dialog>` open/close lifecycle and its two dismiss paths
 * (Escape, backdrop click) — the close button itself stays a plain `onClick={onClose}` in the
 * component, since it needs no state of its own.
 *
 * @param required.open - Whether the dialog should be showing.
 * @param required.onClose - Called on any dismiss path (close button, backdrop click, Escape).
 * @returns `dialogRef` to attach to the `<dialog>` element, plus its `cancel`/backdrop-click
 *   handlers.
 * @complexity Time/space: O(1) per open/close transition — one `showModal`/`close` call, no other
 *   state.
 */
export function useThemePageDetailsModal({ open, onClose }: { open: boolean; onClose: () => void }, _options = {}): ThemePageDetailsModalController {
  const { openLightboxDialog, closeLightboxDialog } = useAdminKitValues();
  const dialogRef = useRef<HTMLDialogElement>(null);

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
