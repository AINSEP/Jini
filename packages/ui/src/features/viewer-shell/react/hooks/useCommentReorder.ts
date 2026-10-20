import { useState, type DragEvent as ReactDragEvent } from 'react';
import { COMMENT_SIDE_DRAG_MIME } from '../../constants.js';
import { dropEdgeForClientY, reorderCommentIds } from '../../rules.js';
import type { CommentSideDragState, CommentSideDropEdge } from '../../types.js';

export interface UseCommentReorderResult {
  dragState: CommentSideDragState | null;
  canReorder: boolean;
  onDragStart: (event: ReactDragEvent<HTMLElement>, id: string) => void;
  onDragOver: (event: ReactDragEvent<HTMLElement>, targetId: string) => void;
  onDrop: (event: ReactDragEvent<HTMLElement>, targetId: string) => void;
  onDragLeaveContainer: (event: ReactDragEvent<HTMLElement>) => void;
  clear: () => void;
}

/**
 * Drag-and-drop reorder state machine for `CommentSidePanel`'s comment
 * list — extracted out of the presentational component so the (fiddly,
 * worth-testing-in-isolation) drag/dragover/drop bookkeeping isn't tangled
 * with JSX.
 */
export function useCommentReorder(
  orderedIds: string[],
  onReorder: ((orderedIds: string[]) => void) | undefined,
): UseCommentReorderResult {
  const [dragState, setDragState] = useState<CommentSideDragState | null>(null);
  const canReorder = Boolean(onReorder && orderedIds.length > 1);

  function onDragStart(event: ReactDragEvent<HTMLElement>, id: string) {
    if (!canReorder) return;
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData(COMMENT_SIDE_DRAG_MIME, id);
    event.dataTransfer.setData('text/plain', id);
    setDragState({ draggingId: id, overId: id, edge: null });
  }

  function onDragOver(event: ReactDragEvent<HTMLElement>, targetId: string) {
    if (!canReorder) return;
    const draggingId = dragState?.draggingId || event.dataTransfer.getData(COMMENT_SIDE_DRAG_MIME);
    if (!draggingId) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    // Hovering back over the dragged item itself shows no drop edge.
    const edge = draggingId === targetId ? null : pointerDropEdge(event);
    const next = { draggingId, overId: targetId, edge };
    if (!isSameDragState(dragState, next)) setDragState(next);
  }

  function onDrop(event: ReactDragEvent<HTMLElement>, targetId: string) {
    if (!canReorder) return;
    event.preventDefault();
    const draggingId = dragState?.draggingId || draggingIdFromTransfer(event.dataTransfer);
    if (!draggingId || draggingId === targetId) {
      setDragState(null);
      return;
    }
    const edge = cachedDropEdge(dragState, targetId) ?? pointerDropEdge(event);
    const nextIds = reorderCommentIds(orderedIds, draggingId, targetId, edge);
    if (nextIds.join('\0') !== orderedIds.join('\0')) {
      onReorder?.(nextIds);
    }
    setDragState(null);
  }

  function onDragLeaveContainer(event: ReactDragEvent<HTMLElement>) {
    const related = event.relatedTarget;
    if (related instanceof Node && event.currentTarget.contains(related)) return;
    setDragState(null);
  }

  function clear() {
    setDragState(null);
  }

  return { dragState, canReorder, onDragStart, onDragOver, onDrop, onDragLeaveContainer, clear };
}

function pointerDropEdge(event: ReactDragEvent<HTMLElement>): CommentSideDropEdge {
  return dropEdgeForClientY(event.clientY, event.currentTarget.getBoundingClientRect());
}

/** Dragging id carried by the DOM payload: the comment mime type, then the
 *  `text/plain` copy `onDragStart` also writes. */
function draggingIdFromTransfer(dataTransfer: DataTransfer): string {
  return dataTransfer.getData(COMMENT_SIDE_DRAG_MIME) || dataTransfer.getData('text/plain');
}

/** The edge already shown while hovering `targetId`, if any. */
function cachedDropEdge(dragState: CommentSideDragState | null, targetId: string): CommentSideDropEdge | null {
  return dragState?.overId === targetId ? dragState.edge : null;
}

function isSameDragState(current: CommentSideDragState | null, next: CommentSideDragState): boolean {
  return current?.draggingId === next.draggingId && current.overId === next.overId && current.edge === next.edge;
}
