import { useAgentHandle } from '../../../react/hooks/useAgentHandle.js';
import { agentHandle } from "@jini-ai/agentic";

import { Lightbox } from "./Lightbox/Lightbox.js";
import type { useLightbox } from "./Lightbox/Lightbox.hooks.js";

export interface ImagePreviewModalProps {
  open: boolean;
  src: string;
  alt: string;
  onClose: () => void;
  /** A fake controller can exercise rendering without a real native-dialog lifecycle. */
  useModal?: typeof useLightbox | undefined;
  /** Explicit names override automatic addressing; false excludes the close control. */
  agentHandle?: string | false | undefined;
  /** No locale is owned here; a translated caller must pass its own accessible close label. */
  closeLabel?: string | undefined;
}

/** One image in the shared `Lightbox`; the alt text doubles as its title. Kept as a named
 *  single-image entry point so callers need not assemble the lightbox for the common case. */
export function ImagePreviewModal({
  open,
  src,
  alt,
  onClose,
  useModal,
  agentHandle: suppliedHandle,
  closeLabel = "Close preview",
}: ImagePreviewModalProps) {
  const handle = useAgentHandle({ agentHandle: suppliedHandle });
  return (
    <Lightbox
      open={open}
      title={alt}
      onClose={onClose}
      className="image-preview-modal"
      labels={{ close: closeLabel }}
      useLightboxHook={useModal}
      partAttrs={handle ? { close: { ...agentHandle({ handle: handle }, { role: "button", label: closeLabel }) } } : undefined}
    >
      <img src={src} alt={alt} />
    </Lightbox>
  );
}
