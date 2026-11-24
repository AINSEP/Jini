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
 * The dialog helpers (`openLightboxDialog`/`closeLightboxDialog`) are required args: the host binds
 * them at its call site from its `AdminKitValues`, the same kit seam `MessageOverflowModal.hooks.tsx`
 * reads — this hook never reaches into the kit itself.
 *
 * Only one instance is ever mounted — the host `Media.tsx`'s `MediaLibraryPanel` renders exactly one
 * `<EditMediaModal>`, toggling only its `item` prop as the selection changes (`editingId`/
 * `editingItem` in `use-media.hooks.ts`), the same "controlled, never conditionally unmounted"
 * shape `ConfirmDialog`/`MediaLightbox`/`ThemePageDetailsModal` all use. The actual form content
 * (`EditMediaPanel`) still gets a `key={item.id}` from its caller so switching the edit target
 * remounts it and reseeds its draft — this hook has no opinion on that; it only opens and closes
 * the `<dialog>` box around whatever is currently keyed inside it.
 */
/** Native `<dialog>` open/close helpers the host binds from its kit (`AdminKitValues`). */
export type EditMediaDialogHelper = (dialog: HTMLDialogElement) => void;

/** Required args of {@link useEditMediaModal}. */
export interface EditMediaModalArgs {
  /** Whether the dialog should be showing (`editingItem !== null` at the call site). */
  open: boolean;
  /** Called on any dismiss path (Cancel, Save, backdrop click, Escape). */
  onClose: () => void;
  /** Presents the dialog modally (the host kit's `openLightboxDialog`). */
  openLightboxDialog: EditMediaDialogHelper;
  /** Closes the dialog (the host kit's `closeLightboxDialog`). */
  closeLightboxDialog: EditMediaDialogHelper;
}

/** Reserved optional args of {@link useEditMediaModal}; none yet. */
export type EditMediaModalOptional = Record<string, never>;

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
 * @param args - `open`: whether the dialog should be showing (`editingItem !== null` at the call
 *   site). `onClose`: called on any dismiss path (Cancel, Save, backdrop click, Escape) — the caller
 *   clears `editingId` the same way it already did for the old inline panel's `onCancel`.
 *   `openLightboxDialog`/`closeLightboxDialog`: the host kit's dialog helpers.
 * @param _optional - Reserved for future optional args.
 * @returns `dialogRef` to attach to the `<dialog>` element, plus its `cancel`/backdrop-click
 *   handlers.
 * @complexity Time/space: O(1) per open/close transition — one `showModal`/`close` call, no other
 *   state.
 */
export function useEditMediaModal(
  { open, onClose, openLightboxDialog, closeLightboxDialog }: EditMediaModalArgs,
  _optional: EditMediaModalOptional = {},
): EditMediaModalController {
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
