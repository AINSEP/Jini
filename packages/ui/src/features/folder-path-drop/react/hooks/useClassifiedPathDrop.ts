import { useState, type DragEvent } from 'react';
import type { ClassifiedPathDrop } from '../../types.js';

/** Required inputs of `useClassifiedPathDrop`. */
export interface UseClassifiedPathDropArgs {
  /** Work is running; a drop is ignored rather than queued, and dragging over does not light the target. */
  readonly busy: boolean;
  /**
   * The host's classification of a drop. Called synchronously inside the drop handler, because a
   * drop's `DataTransfer` is empty once the event returns. Refusal copy is the host's.
   */
  readonly classifyDrop: (input: { dataTransfer: DataTransfer }) => ClassifiedPathDrop;
  /** The host's classification of files its own picker returned (no folder can be among them). */
  readonly classifyFiles: (input: { files: File[] }) => ClassifiedPathDrop;
  readonly onFolder: (required: { path: string }, options?: {}) => void;
  readonly onArchive: (required: { path: string }, options?: {}) => void;
  readonly onRefused: (message: string) => void;
}

/** What `useClassifiedPathDrop` hands back: spread `dropProps` on the target's root element. */
export interface ClassifiedPathDropController {
  readonly dragging: boolean;
  readonly onPicked: (input: { files: File[] }, options?: Record<string, never>) => void;
  readonly dropProps: {
    onDragEnter: (event: DragEvent<HTMLElement>) => void;
    onDragOver: (event: DragEvent<HTMLElement>) => void;
    onDragLeave: (event: DragEvent<HTMLElement>) => void;
    onDropCapture: (event: DragEvent<HTMLElement>) => void;
  };
}

/**
 * A whole-page drop target that routes each drop to exactly one of a folder, an archive or a refusal,
 * as the host's classifiers decide: the drag highlight, and the routing.
 *
 * @param required.busy work is running; a drop is ignored rather than queued.
 * @param required.onFolder,required.onArchive,required.onRefused one of these runs per drop.
 * @returns handlers for the page's root, so a drop anywhere on the page counts, `dragging`, and
 *   `onPicked` for the files a drop zone's own picker returns.
 * @complexity O(1) per drag event; the classifiers' cost per drop.
 */
export function useClassifiedPathDrop(
  { busy, classifyDrop, classifyFiles, onFolder, onArchive, onRefused }: UseClassifiedPathDropArgs,
  _optional: Record<string, never> = {},
): ClassifiedPathDropController {
  const [dragging, setDragging] = useState(false);
  const route = (drop: ClassifiedPathDrop) => {
    if (drop.kind === 'folder') onFolder({ path: drop.path });
    else if (drop.kind === 'archive') onArchive({ path: drop.path });
    else onRefused(drop.message);
  };
  const onDragOver = (event: DragEvent<HTMLElement>) => {
    // Without this Chromium refuses the drop, and a file let go elsewhere would navigate the window.
    event.preventDefault();
    event.dataTransfer.dropEffect = busy ? 'none' : 'copy';
    setDragging(!busy);
  };
  const onDragLeave = (event: DragEvent<HTMLElement>) => {
    // Leaving a child is not leaving the page; `relatedTarget` is where the pointer went.
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
  };
  // Capture phase, and the drop stops here: a shared drop zone inside the page would otherwise
  // expand a dropped folder into every file in it (a site folder holds node_modules) and lose the
  // folder's own path, which is the one thing a folder import needs.
  const onDropCapture = (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setDragging(false);
    if (busy) return;
    route(classifyDrop({ dataTransfer: event.dataTransfer }));
  };
  const onPicked = ({ files }: { files: File[] }, _options: Record<string, never> = {}) => {
    if (!busy) route(classifyFiles({ files }));
  };
  return { dragging, onPicked, dropProps: { onDragEnter: onDragOver, onDragOver, onDragLeave, onDropCapture } };
}
