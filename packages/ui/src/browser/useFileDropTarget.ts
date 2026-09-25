import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react';
import { FILE_SYSTEM_READ_ERROR_MESSAGE, isFileSystemReadError } from '../utils/file-system-errors.js';
import { filesFromDataTransfer } from '../utils/file-transfer.js';

export interface UseFileDropTargetResult {
  draggingFiles: boolean;
  dropReadError: string | null;
  clearDropReadError: () => void;
  onDragEnter: (event: DragEvent<Element>) => void;
  onDragOver: (event: DragEvent<Element>) => void;
  onDragLeave: (event: DragEvent<Element>) => void;
  onDrop: (event: DragEvent<Element>) => void;
}

/**
 * A generic drop target: nesting-depth-tracked drag-over state (`dragenter`/
 * `dragleave` fire for every descendant element, so a naive boolean would
 * flicker off while dragging over a child element — `dragDepthRef` is what
 * avoids that), and a drop handler that recursively expands dropped folders
 * via `utils/file-transfer.ts`'s `filesFromDataTransfer`.
 *
 * Promoted (2026-07-18) from `features/asset-tree-browser`'s
 * `useAssetTreeDragUpload` (itself already fully generic — no asset-tree
 * types) once `features/file-dropzone/` needed the identical shape, so a
 * second feature reuses one hook instead of a near-duplicate copy.
 * `useAssetTreeDragUpload` re-exports this under its original name.
 */
export function useFileDropTarget(onUploadFiles: (files: File[]) => void): UseFileDropTargetResult {
  const [draggingFiles, setDraggingFiles] = useState(false);
  const [dropReadError, setDropReadError] = useState<string | null>(null);
  const dragDepthRef = useRef(0);
  const onUploadFilesRef = useRef(onUploadFiles);
  onUploadFilesRef.current = onUploadFiles;

  const clearDropReadError = useCallback(() => setDropReadError(null), []);

  // This target's own `onDrop`/`onDragLeave` are not guaranteed to run when a drag ends: a host that
  // handles a drop itself in the capture phase and stops propagation (a host's folder-drop-to-path) or a
  // drag that ends elsewhere leaves the drag-over state stuck on. Window-capture listeners run before
  // any element handler, so no `stopPropagation` can skip them. Registered only while dragging.
  useEffect(() => {
    if (!draggingFiles) return undefined;
    const reset = () => {
      dragDepthRef.current = 0;
      setDraggingFiles(false);
    };
    window.addEventListener('drop', reset, true);
    window.addEventListener('dragend', reset, true);
    return () => {
      window.removeEventListener('drop', reset, true);
      window.removeEventListener('dragend', reset, true);
    };
  }, [draggingFiles]);

  const onDragEnter = useCallback((event: DragEvent<Element>) => {
    event.preventDefault();
    dragDepthRef.current += 1;
    setDraggingFiles(true);
  }, []);

  const onDragOver = useCallback((event: DragEvent<Element>) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  }, []);

  const onDragLeave = useCallback((event: DragEvent<Element>) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
      dragDepthRef.current = 0;
      setDraggingFiles(false);
      return;
    }
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setDraggingFiles(false);
  }, []);

  const onDrop = useCallback((event: DragEvent<Element>) => {
    event.preventDefault();
    dragDepthRef.current = 0;
    setDraggingFiles(false);
    setDropReadError(null);
    const dataTransfer = event.dataTransfer;
    void (async () => {
      try {
        const dropped = await filesFromDataTransfer(dataTransfer);
        if (dropped.length > 0) onUploadFilesRef.current(dropped);
      } catch (error) {
        if (!isFileSystemReadError(error)) throw error;
        setDropReadError(FILE_SYSTEM_READ_ERROR_MESSAGE);
      }
    })();
  }, []);

  return { draggingFiles, dropReadError, clearDropReadError, onDragEnter, onDragOver, onDragLeave, onDrop };
}
