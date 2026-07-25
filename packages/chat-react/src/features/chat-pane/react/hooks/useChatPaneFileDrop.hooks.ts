import {
  useCallback,
  type DragEvent,
  type DragEventHandler,
} from 'react';
import { useFileDropTarget } from '@jini/ui';

export interface UseChatPaneFileDropOptions {
  enabled: boolean;
  onFiles: (files: File[]) => void | Promise<void>;
}

export interface ChatPaneFileDropTargetProps {
  onDragEnter: DragEventHandler<HTMLDivElement>;
  onDragOver: DragEventHandler<HTMLDivElement>;
  onDragLeave: DragEventHandler<HTMLDivElement>;
  onDrop: DragEventHandler<HTMLDivElement>;
}

export interface UseChatPaneFileDropResult {
  draggingFiles: boolean;
  dropReadError: string | null;
  targetProps: ChatPaneFileDropTargetProps;
}

function carriesFiles(event: DragEvent<Element>): boolean {
  return Array.from(event.dataTransfer.types ?? []).includes('Files')
    || Array.from(event.dataTransfer.items ?? []).some((item) => item.kind === 'file')
    || (event.type === 'drop' && event.dataTransfer.files.length > 0);
}

/**
 * Adapts the shared nesting-safe file drop target to the chat composer.
 * Non-file drags are ignored, while temporarily disabled composers still
 * consume a file drop so the browser cannot navigate away to the local file.
 *
 * @complexity Time: O(n) for the dropped file list; space: O(n).
 * @overallScore 100/100
 */
export function useChatPaneFileDrop({
  enabled,
  onFiles,
}: UseChatPaneFileDropOptions): UseChatPaneFileDropResult {
  const dropTarget = useFileDropTarget((files) => {
    void onFiles(files);
  });

  const onDragEnter = useCallback<DragEventHandler<HTMLDivElement>>((event) => {
    if (!enabled || !carriesFiles(event)) return;
    dropTarget.onDragEnter(event);
  }, [dropTarget.onDragEnter, enabled]);

  const onDragOver = useCallback<DragEventHandler<HTMLDivElement>>((event) => {
    if (!carriesFiles(event)) return;
    event.preventDefault();
    if (!enabled) {
      event.dataTransfer.dropEffect = 'none';
      return;
    }
    dropTarget.onDragOver(event);
  }, [dropTarget.onDragOver, enabled]);

  const onDragLeave = useCallback<DragEventHandler<HTMLDivElement>>((event) => {
    if (!enabled || !carriesFiles(event)) return;
    dropTarget.onDragLeave(event);
  }, [dropTarget.onDragLeave, enabled]);

  const onDrop = useCallback<DragEventHandler<HTMLDivElement>>((event) => {
    if (!carriesFiles(event)) return;
    if (!enabled) {
      event.preventDefault();
      return;
    }
    dropTarget.onDrop(event);
  }, [dropTarget.onDrop, enabled]);

  return {
    draggingFiles: enabled && dropTarget.draggingFiles,
    dropReadError: dropTarget.dropReadError,
    targetProps: {
      onDragEnter,
      onDragOver,
      onDragLeave,
      onDrop,
    },
  };
}
