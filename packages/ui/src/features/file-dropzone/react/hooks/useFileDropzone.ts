import { useEffect, useRef, type ChangeEvent, type DragEvent, type RefObject } from 'react';
import { useFileDropTarget } from '../../../../browser/useFileDropTarget.js';
import { filesFromClipboardData, shouldIgnoreClipboardFilePaste } from '../../../../utils/file-transfer.js';
import { FILE_DROPZONE_PROCESSING_BYTES_THRESHOLD, FILE_DROPZONE_PROCESSING_FILE_COUNT_THRESHOLD, FILE_DROPZONE_PROCESSING_MIN_VISIBLE_MS } from '../../constants.js';
import { fileDropzoneShouldShowProcessing } from '../../rules.js';
import { useFileDialogTracking } from './useFileDialogTracking.js';

export interface UseFileDropzoneParams {
  /** Resolved files ready to stage — always the fully directory-expanded flat list, whether they arrived via drag/drop, click-to-browse, or paste. */
  onFiles: (files: File[]) => void;
  /** Fires on a native click on the zone. Drag/drop and paste don't trigger it. */
  onZoneClick?: (() => void) | undefined;
  /** Surfaces a read error (e.g. a dropped folder failed to enumerate), or clears it (`null`) right before a successful staging. */
  onError?: ((message: string | null) => void) | undefined;
  /**
   * Wraps staging of a large selection (see `FILE_DROPZONE_PROCESSING_FILE_COUNT_THRESHOLD`
   * / `_BYTES_THRESHOLD`) so a host can show a loading affordance while it
   * resolves; returns the "finish" callback. Also drives the file-dialog
   * cancel-vs-still-loading detection heuristic for click-to-browse. Omit
   * for a zone that never needs a loading affordance (small selections
   * stage synchronously regardless).
   */
  onProcessingStart?: (() => () => void) | undefined;
  /** Listens for a page-wide clipboard paste (ignoring one that lands on a text-entry target) and stages any pasted files directly — bypasses the processing-affordance heuristic, matching the origin (a paste is never a directory, so it's never large enough to need one). */
  enablePaste?: boolean | undefined;
}

export interface UseFileDropzoneResult {
  inputRef: RefObject<HTMLInputElement | null>;
  dragOver: boolean;
  dropReadError: string | null;
  openPicker: () => void;
  onZoneDragEnter: (event: DragEvent<Element>) => void;
  onZoneDragOver: (event: DragEvent<Element>) => void;
  onZoneDragLeave: (event: DragEvent<Element>) => void;
  onZoneDrop: (event: DragEvent<Element>) => void;
  onInputChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onInputClick: () => void;
}

function runAfterNextPaint(callback: () => void): void {
  if (typeof window.requestAnimationFrame === 'function') {
    window.requestAnimationFrame(() => window.setTimeout(callback, 0));
    return;
  }
  window.setTimeout(callback, 0);
}

/**
 * Consolidates the two independent OD file-staging zones'
 * behavior into one hook: native drag/drop (directory-aware, via
 * `browser/useFileDropTarget`), click-to-browse (with the file-dialog
 * cancel-vs-still-loading detection heuristic, via `useFileDialogTracking`),
 * an optional page-wide clipboard-paste listener, and the shared
 * large-selection loading-affordance heuristic that gates all of the above
 * except paste. See `packages/ui/archived provenance ledger` for the full consolidation
 * writeup and which origin file contributed which piece.
 */
export function useFileDropzone({
  onFiles,
  onZoneClick,
  onError,
  onProcessingStart,
  enablePaste = false,
}: UseFileDropzoneParams): UseFileDropzoneResult {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const onFilesRef = useRef(onFiles);
  onFilesRef.current = onFiles;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  const dialogTracking = useFileDialogTracking(onProcessingStart);
  const dialogTrackingRef = useRef(dialogTracking);
  dialogTrackingRef.current = dialogTracking;

  function finishProcessingLater(finish: (() => void) | undefined) {
    if (!finish) return;
    window.setTimeout(finish, FILE_DROPZONE_PROCESSING_MIN_VISIBLE_MS);
  }

  // Every caller (processSelectedFiles' two staging branches, and the paste
  // listener) already guards a non-empty selection before reaching here, so
  // this has no empty-array case to handle.
  function stageFiles(nextFiles: File[]) {
    onErrorRef.current?.(null);
    onFilesRef.current(nextFiles);
  }

  function processSelectedFiles(nextFiles: File[], activeFinish?: () => void) {
    if (nextFiles.length === 0) {
      finishProcessingLater(activeFinish);
      return;
    }
    if (!fileDropzoneShouldShowProcessing(nextFiles, FILE_DROPZONE_PROCESSING_FILE_COUNT_THRESHOLD, FILE_DROPZONE_PROCESSING_BYTES_THRESHOLD) || !onProcessingStart) {
      stageFiles(nextFiles);
      finishProcessingLater(activeFinish);
      return;
    }
    const finish = activeFinish ?? onProcessingStart();
    runAfterNextPaint(() => {
      try {
        stageFiles(nextFiles);
      } finally {
        finishProcessingLater(finish);
      }
    });
  }

  const dragTarget = useFileDropTarget((droppedFiles) => processSelectedFiles(droppedFiles));

  // Mirrors the drag-target's own read-error state into the `onError` prop
  // so a host that already has a single error-display slot (matching the
  // origin `DropZone`'s `onError` contract) doesn't need a second one just
  // for drops; `dragTarget.dropReadError` remains available directly too
  // for a host that prefers to render its own inline banner instead.
  useEffect(() => {
    if (dragTarget.dropReadError) onErrorRef.current?.(dragTarget.dropReadError);
  }, [dragTarget.dropReadError]);

  function openPicker() {
    inputRef.current?.click();
  }

  function onInputClick() {
    onZoneClick?.();
    dialogTrackingRef.current.prepareTracking();
  }

  function onInputChange(event: ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(event.currentTarget.files ?? []);
    event.currentTarget.value = '';
    const finish = dialogTrackingRef.current.completeTracking();
    processSelectedFiles(picked, finish);
  }

  // The native `cancel` event on `<input type=file>` has no React synthetic
  // equivalent, so it's wired imperatively — mirroring the origin, which
  // only attaches this (and the window `focus` listener now owned by
  // `useFileDialogTracking`) while a processing affordance is configured.
  useEffect(() => {
    if (!onProcessingStart) return undefined;
    // Non-null: this effect runs post-mount, and the consumer always
    // renders the ref'd `<input>` unconditionally (see `FileDropzone.tsx`),
    // so `inputRef.current` is never null once an effect body executes.
    const input = inputRef.current!;
    function handleCancel() {
      dialogTrackingRef.current.handleDialogCancelled();
    }
    input.addEventListener('cancel', handleCancel);
    return () => input.removeEventListener('cancel', handleCancel);
  }, [onProcessingStart]);

  useEffect(() => {
    if (!enablePaste) return undefined;
    function onPaste(event: ClipboardEvent) {
      if (shouldIgnoreClipboardFilePaste(event.target) || shouldIgnoreClipboardFilePaste(document.activeElement)) {
        return;
      }
      const pasted = filesFromClipboardData(event.clipboardData);
      if (pasted.length === 0) return;
      event.preventDefault();
      stageFiles(pasted);
    }
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enablePaste]);

  return {
    inputRef,
    dragOver: dragTarget.draggingFiles,
    dropReadError: dragTarget.dropReadError,
    openPicker,
    onZoneDragEnter: dragTarget.onDragEnter,
    onZoneDragOver: dragTarget.onDragOver,
    onZoneDragLeave: dragTarget.onDragLeave,
    onZoneDrop: dragTarget.onDrop,
    onInputChange,
    onInputClick,
  };
}
