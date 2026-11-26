import type { AdminMedia } from "@jini-ai/core/contracts/site/cms-admin-media";
import { agentHandle } from "@jini-ai/core/agent-handles";
import type { useEditMediaModal } from "./hooks/use-edit-media-modal.hooks.js";
import type { MediaProps } from "./Media.js";
import { EditMediaPanel } from "./MediaEditPanel.js";

/** Stable id for `EditMediaModal`'s own accessible name — a static constant, not a generated one,
 *  since exactly one instance is ever mounted at a time (see this component's own doc comment,
 *  same reasoning `ThemePageDetailsModal.tsx`'s `TITLE_ID` documents for its own single instance). */
const EDIT_MEDIA_MODAL_TITLE_ID = "media-edit-modal-title";

interface EditMediaModalProps {
  useEditMediaPanelHook: MediaProps["hooks"]["useEditMediaPanelHook"];
  /** The item currently being edited, or `null` while closed — mirrors
   *  `ThemePageDetailsModalProps.row`'s null-is-closed convention. */
  item: AdminMedia | null;
  onSaved: () => void;
  onCancel: () => void;
  /**
   * Dependency injection seam for tests — the same convention `Posts.tsx`'s `usePostsHook` uses.
   * Defaulted to the real hook, so production callers pass nothing and behave exactly as before.
   */
  useEditMediaModalHook: typeof useEditMediaModal;
  /** Host kit values hook (injected so tests can supply the native-dialog helpers). */
  useAdminKitValuesHook: MediaProps["hooks"]["useAdminKitValuesHook"];
  /** Translator closure — see `Media()`'s own `t`; forwarded to the `EditMediaPanel` this wraps. */
  t: (key: string) => string;
}

/**
 * Single shared `<dialog>` wrapping `EditMediaPanel` — owner ask (2026-09-07): reach the metadata
 * edit form from an eye icon on the card, as a modal, instead of an inline panel pushing the grid
 * down. Same "controlled, never conditionally unmounted" shape as `MediaLightbox`/`ConfirmDialog`
 * (`MediaLibraryPanel` below renders exactly one `<EditMediaModal>`, toggling only its `item` prop),
 * and the same native-`<dialog>` foundation/lifecycle as `ThemePageDetailsModal.tsx` — see
 * `use-edit-media-modal.hooks.ts`'s own header for why that lifecycle hook is a local copy rather
 * than a shared import.
 *
 * `EditMediaPanel` itself still gets `key={item.id}` here, not on the `<dialog>` — the dialog BOX
 * stays mounted across an edit-target switch (so its own open/close transition is never disturbed
 * by which item is inside it), but the form content must still remount and reseed its draft from
 * the new item, preserving the 2026-08-12 audit fix (`MediaLibraryPanel`'s own comment on this same
 * `key` has the full incident writeup).
 */
export function EditMediaModal({ item, onSaved, onCancel, useEditMediaPanelHook, useEditMediaModalHook, useAdminKitValuesHook, t }: EditMediaModalProps, _optional = {}) {
  // The Jini hook takes the native-dialog helpers as required args; bind them from the host kit here.
  const { openLightboxDialog, closeLightboxDialog } = useAdminKitValuesHook();
  const { dialogRef, handleNativeCancel, handleBackdropClick } = useEditMediaModalHook({
    open: item !== null, onClose: onCancel, openLightboxDialog, closeLightboxDialog,
  });

  return (
    <dialog
      ref={dialogRef}
      className="media-edit-dialog"
      aria-labelledby={item ? EDIT_MEDIA_MODAL_TITLE_ID : undefined}
      onCancel={handleNativeCancel}
      onClick={handleBackdropClick}
      {...agentHandle({ handle: "media-edit-dialog" }, { role: "region", label: "Edit this asset's metadata, presented as a modal" })}
    >
      {item ? (
        <EditMediaPanel useEditMediaPanelHook={useEditMediaPanelHook} key={item.id} item={item} onSaved={onSaved} onCancel={onCancel} t={t} titleId={EDIT_MEDIA_MODAL_TITLE_ID} />
      ) : null}
    </dialog>
  );
}
