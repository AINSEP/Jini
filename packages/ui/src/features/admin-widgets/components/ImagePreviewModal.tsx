import { agentHandle } from "@jini-ai/agentic";

import { useImagePreviewModal } from "./ImagePreviewModal.hooks.js";

export interface ImagePreviewModalProps {
  open: boolean;
  src: string;
  alt: string;
  onClose: () => void;
  /** A fake controller can exercise rendering without a real native-dialog lifecycle. */
  useModal?: typeof useImagePreviewModal | undefined;
  /** Optional tagging preserves existing untagged renders when no agent handle is supplied. */
  agentHandle?: string | undefined;
  /** No locale is owned here; a translated caller must pass its own accessible close label. */
  closeLabel?: string | undefined;
}

// Native dialog supplies focus trapping, Escape and a backdrop through the browser's top layer,
// avoiding a hand-built overlay and z-index policy. A confirm/cancel dialog's two-action contract
// does not fit a read-only image with one close affordance. The injectable hook owns lifecycle
// and DOM-environment fallbacks so this component stays focused on rendering.
/** Controlled native-dialog lightbox. The host supplies image copy and a translated close label. */
export function ImagePreviewModal({
  open,
  src,
  alt,
  onClose,
  useModal = useImagePreviewModal,
  agentHandle: handle,
  closeLabel = "Close preview",
}: ImagePreviewModalProps) {
  const { dialogRef, handleNativeCancel, handleBackdropClick } = useModal({ open, onClose });

  return (
    <dialog
      ref={dialogRef}
      className="image-preview-modal"
      aria-label={alt}
      onCancel={handleNativeCancel}
      onClick={handleBackdropClick}
    >
      <button
        type="button"
        className="image-preview-modal-close"
        onClick={onClose}
        aria-label={closeLabel}
        {...(handle ? agentHandle({ handle: handle }, { role: "button", label: closeLabel }) : {})}
      >
        ×
      </button>
      <img src={src} alt={alt} />
    </dialog>
  );
}
