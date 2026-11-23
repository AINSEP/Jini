import { useState, type DragEvent } from "react";

/**
 * Drag-over highlight and drop handling for {@link ZipDropZone}. Shared by every "Add a …" tab that
 * takes one dropped package (Agent Plugins, Plugins), so the highlight and the `preventDefault`
 * that stops the browser from opening the dropped file live in one place.
 *
 * @param required.onDropFiles - Receives every dropped file; the caller decides what "one .zip" means.
 * @param required.isLocked - True while an upload is in flight: a drop is then ignored, not queued.
 */
export function useZipDrop(
  required: { onDropFiles: (required: { files: File[] }, optional?: Record<string, never>) => void; isLocked: () => boolean },
  _optional: Record<string, never> = {},
) {
  const [dragging, setDragging] = useState(false);
  return {
    dragging,
    onDragOver: (event: DragEvent<HTMLElement>) => {
      event.preventDefault();
      if (!required.isLocked()) setDragging(true);
    },
    onDragLeave: () => setDragging(false),
    onDrop: (event: DragEvent<HTMLElement>) => {
      event.preventDefault();
      setDragging(false);
      if (required.isLocked()) return;
      required.onDropFiles({ files: Array.from(event.dataTransfer.files ?? []) });
    },
  };
}

export type ZipDropController = ReturnType<typeof useZipDrop>;
