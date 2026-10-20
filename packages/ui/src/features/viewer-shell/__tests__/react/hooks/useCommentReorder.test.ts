import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { DragEvent as ReactDragEvent } from 'react';
import { useCommentReorder } from '../../../react/hooks/useCommentReorder.js';
import { COMMENT_SIDE_DRAG_MIME } from '../../../constants.js';

function makeDataTransfer(initial: Record<string, string> = {}) {
  const store = { ...initial };
  return {
    effectAllowed: '',
    dropEffect: '',
    setData: vi.fn((type: string, value: string) => {
      store[type] = value;
    }),
    getData: vi.fn((type: string) => store[type] ?? ''),
  };
}

function makeDragEvent(overrides: Partial<{ clientY: number; rect: { top: number; height: number }; dataTransfer: ReturnType<typeof makeDataTransfer>; relatedTarget: unknown; contains: (n: unknown) => boolean }> = {}) {
  const rect = overrides.rect ?? { top: 0, height: 100 };
  const dataTransfer = overrides.dataTransfer ?? makeDataTransfer();
  const contains = overrides.contains ?? (() => false);
  return {
    clientY: overrides.clientY ?? 10,
    dataTransfer,
    relatedTarget: overrides.relatedTarget ?? null,
    preventDefault: vi.fn(),
    currentTarget: {
      getBoundingClientRect: () => rect,
      contains,
    },
  } as unknown as ReactDragEvent<HTMLElement>;
}

describe('useCommentReorder', () => {
  it('reports canReorder false with fewer than 2 ids or no onReorder', () => {
    const { result: noCallback } = renderHook(() => useCommentReorder(['a', 'b'], undefined));
    expect(noCallback.current.canReorder).toBe(false);

    const onReorder = vi.fn();
    const { result: tooFew } = renderHook(() => useCommentReorder(['a'], onReorder));
    expect(tooFew.current.canReorder).toBe(false);

    const { result: ok } = renderHook(() => useCommentReorder(['a', 'b'], onReorder));
    expect(ok.current.canReorder).toBe(true);
  });

  it('drives a full drag/dragover/drop reorder', () => {
    const onReorder = vi.fn();
    const { result } = renderHook(() => useCommentReorder(['a', 'b', 'c'], onReorder));

    const dataTransfer = makeDataTransfer();

    act(() => {
      result.current.onDragStart(makeDragEvent({ dataTransfer }), 'c');
    });
    expect(result.current.dragState).toEqual({ draggingId: 'c', overId: 'c', edge: null });
    expect(dataTransfer.setData).toHaveBeenCalledWith(COMMENT_SIDE_DRAG_MIME, 'c');

    act(() => {
      // clientY 10 with rect {top:0,height:100} -> midpoint 50 -> 'before'
      result.current.onDragOver(makeDragEvent({ dataTransfer, clientY: 10 }), 'a');
    });
    expect(result.current.dragState).toEqual({ draggingId: 'c', overId: 'a', edge: 'before' });

    act(() => {
      result.current.onDrop(makeDragEvent({ dataTransfer, clientY: 10 }), 'a');
    });
    expect(onReorder).toHaveBeenCalledWith(['c', 'a', 'b']);
    expect(result.current.dragState).toBeNull();
  });

  it('does nothing when reordering is disabled', () => {
    const { result } = renderHook(() => useCommentReorder(['a'], undefined));
    act(() => {
      result.current.onDragStart(makeDragEvent(), 'a');
    });
    expect(result.current.dragState).toBeNull();
  });

  it('onDragOver and onDrop are no-ops when reordering is disabled', () => {
    const { result } = renderHook(() => useCommentReorder(['a'], undefined));
    act(() => {
      result.current.onDragOver(makeDragEvent(), 'a');
    });
    expect(result.current.dragState).toBeNull();
    act(() => {
      result.current.onDrop(makeDragEvent(), 'a');
    });
    expect(result.current.dragState).toBeNull();
  });

  it('no-ops a drop onto the same id', () => {
    const onReorder = vi.fn();
    const { result } = renderHook(() => useCommentReorder(['a', 'b'], onReorder));
    act(() => {
      result.current.onDragStart(makeDragEvent(), 'a');
    });
    act(() => {
      result.current.onDrop(makeDragEvent(), 'a');
    });
    expect(onReorder).not.toHaveBeenCalled();
    expect(result.current.dragState).toBeNull();
  });

  it('clears drag state on drag-leave once outside the container', () => {
    const onReorder = vi.fn();
    const { result } = renderHook(() => useCommentReorder(['a', 'b'], onReorder));
    act(() => {
      result.current.onDragStart(makeDragEvent(), 'a');
    });
    const outsideNode = document.createElement('div');
    act(() => {
      result.current.onDragLeaveContainer(makeDragEvent({ relatedTarget: outsideNode, contains: () => false }));
    });
    expect(result.current.dragState).toBeNull();
  });

  it('keeps drag state when drag-leave lands on a child of the container', () => {
    const onReorder = vi.fn();
    const { result } = renderHook(() => useCommentReorder(['a', 'b'], onReorder));
    act(() => {
      result.current.onDragStart(makeDragEvent(), 'a');
    });
    const childNode = document.createElement('div');
    act(() => {
      result.current.onDragLeaveContainer(makeDragEvent({ relatedTarget: childNode, contains: () => true }));
    });
    expect(result.current.dragState).not.toBeNull();
  });

  it('clear() resets drag state directly', () => {
    const onReorder = vi.fn();
    const { result } = renderHook(() => useCommentReorder(['a', 'b'], onReorder));
    act(() => {
      result.current.onDragStart(makeDragEvent(), 'a');
    });
    act(() => {
      result.current.clear();
    });
    expect(result.current.dragState).toBeNull();
  });

  it('onDragOver no-ops when neither dragState nor the DOM dataTransfer carries a dragging id', () => {
    const onReorder = vi.fn();
    const { result } = renderHook(() => useCommentReorder(['a', 'b'], onReorder));
    act(() => {
      result.current.onDragOver(makeDragEvent({ dataTransfer: makeDataTransfer() }), 'a');
    });
    expect(result.current.dragState).toBeNull();
  });

  it('onDragOver hovering back over the dragged item itself clears any edge and updates overId', () => {
    const onReorder = vi.fn();
    const { result } = renderHook(() => useCommentReorder(['a', 'b', 'c'], onReorder));
    const dataTransfer = makeDataTransfer();
    act(() => {
      result.current.onDragStart(makeDragEvent({ dataTransfer }), 'a');
    });
    // First move it over a different target to pick up a non-null edge...
    act(() => {
      result.current.onDragOver(makeDragEvent({ dataTransfer, clientY: 10 }), 'b');
    });
    expect(result.current.dragState).toEqual({ draggingId: 'a', overId: 'b', edge: 'before' });
    // ...then drag back over itself: draggingId === targetId branch, edge resets to null.
    act(() => {
      result.current.onDragOver(makeDragEvent({ dataTransfer }), 'a');
    });
    expect(result.current.dragState).toEqual({ draggingId: 'a', overId: 'a', edge: null });
  });

  it('onDragOver hovering over the dragged item again is a no-op once already {overId, edge:null}', () => {
    const onReorder = vi.fn();
    const { result } = renderHook(() => useCommentReorder(['a', 'b'], onReorder));
    const dataTransfer = makeDataTransfer();
    act(() => {
      result.current.onDragStart(makeDragEvent({ dataTransfer }), 'a');
    });
    const before = result.current.dragState;
    act(() => {
      // Same target as the drag start (already {overId:'a', edge:null}) - condition is false, no state churn.
      result.current.onDragOver(makeDragEvent({ dataTransfer }), 'a');
    });
    expect(result.current.dragState).toBe(before);
  });

  it('onDrop recovers a missing dragState from the DOM dataTransfer (mime type then text/plain fallback)', () => {
    const onReorder = vi.fn();
    const { result } = renderHook(() => useCommentReorder(['a', 'b', 'c'], onReorder));

    const mimeTransfer = makeDataTransfer({ [COMMENT_SIDE_DRAG_MIME]: 'a' });
    act(() => {
      result.current.onDrop(makeDragEvent({ dataTransfer: mimeTransfer, clientY: 10 }), 'c');
    });
    // clientY 10 with rect {top:0,height:100} -> midpoint 50 -> 'before'
    expect(onReorder).toHaveBeenCalledWith(['b', 'a', 'c']);

    onReorder.mockClear();
    const textOnlyTransfer = makeDataTransfer({ 'text/plain': 'a' });
    act(() => {
      result.current.onDrop(makeDragEvent({ dataTransfer: textOnlyTransfer, clientY: 10 }), 'c');
    });
    expect(onReorder).toHaveBeenCalledWith(['b', 'a', 'c']);
  });

  it('onDragOver hovering the same non-self target with an unchanged edge does not churn state', () => {
    const onReorder = vi.fn();
    const { result } = renderHook(() => useCommentReorder(['a', 'b', 'c'], onReorder));
    const dataTransfer = makeDataTransfer();
    act(() => {
      result.current.onDragStart(makeDragEvent({ dataTransfer }), 'a');
    });
    act(() => {
      result.current.onDragOver(makeDragEvent({ dataTransfer, clientY: 10 }), 'b');
    });
    const afterFirstMove = result.current.dragState;
    expect(afterFirstMove).toEqual({ draggingId: 'a', overId: 'b', edge: 'before' });
    act(() => {
      // Identical target and clientY -> same edge -> the update condition is
      // false, so the hook must not call setDragState again.
      result.current.onDragOver(makeDragEvent({ dataTransfer, clientY: 10 }), 'b');
    });
    expect(result.current.dragState).toBe(afterFirstMove);
  });

  it('onDrop recomputes the edge from the pointer position when the cached dragState is over a different target', () => {
    const onReorder = vi.fn();
    const { result } = renderHook(() => useCommentReorder(['a', 'b', 'c'], onReorder));
    const dataTransfer = makeDataTransfer();
    act(() => {
      result.current.onDragStart(makeDragEvent({ dataTransfer }), 'a');
    });
    // dragState.overId is still 'a' (from onDragStart), never updated to 'c' via onDragOver,
    // so onDrop must fall back to dropEdgeForClientY instead of reusing a stale cached edge.
    act(() => {
      // clientY 90 with rect {top:0,height:100} -> midpoint 50 -> 'after'
      result.current.onDrop(makeDragEvent({ dataTransfer, clientY: 90 }), 'c');
    });
    expect(onReorder).toHaveBeenCalledWith(['b', 'c', 'a']);
  });
  it('onDrop reuses the cached edge when the drop lands on the hovered target', () => {
    const onReorder = vi.fn();
    const { result } = renderHook(() => useCommentReorder(['a', 'b', 'c'], onReorder));
    const dataTransfer = makeDataTransfer();
    act(() => {
      result.current.onDragStart(makeDragEvent({ dataTransfer }), 'c');
    });
    act(() => {
      result.current.onDragOver(makeDragEvent({ dataTransfer, clientY: 10 }), 'b');
    });
    act(() => {
      // Pointer says 'after', but the cached hover edge ('before') wins.
      result.current.onDrop(makeDragEvent({ dataTransfer, clientY: 90 }), 'b');
    });
    expect(onReorder).toHaveBeenCalledWith(['a', 'c', 'b']);
  });

  it('onDrop skips onReorder when the resulting order is unchanged, but still clears drag state', () => {
    const onReorder = vi.fn();
    const { result } = renderHook(() => useCommentReorder(['a', 'b', 'c'], onReorder));
    const dataTransfer = makeDataTransfer();
    act(() => {
      result.current.onDragStart(makeDragEvent({ dataTransfer }), 'a');
    });
    act(() => {
      result.current.onDrop(makeDragEvent({ dataTransfer, clientY: 10 }), 'b');
    });
    expect(onReorder).not.toHaveBeenCalled();
    expect(result.current.dragState).toBeNull();
  });

  it('onDrop with no dragging id anywhere clears drag state without reordering', () => {
    const onReorder = vi.fn();
    const { result } = renderHook(() => useCommentReorder(['a', 'b'], onReorder));
    const event = makeDragEvent({ dataTransfer: makeDataTransfer() });
    act(() => {
      result.current.onDrop(event, 'a');
    });
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(onReorder).not.toHaveBeenCalled();
    expect(result.current.dragState).toBeNull();
  });

  it('onDragOver recovers the dragging id from the mime type and marks the drop as a move', () => {
    const onReorder = vi.fn();
    const { result } = renderHook(() => useCommentReorder(['a', 'b'], onReorder));
    const dataTransfer = makeDataTransfer({ [COMMENT_SIDE_DRAG_MIME]: 'a', 'text/plain': 'b' });
    const event = makeDragEvent({ dataTransfer, clientY: 90 });
    act(() => {
      result.current.onDragOver(event, 'b');
    });
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(dataTransfer.dropEffect).toBe('move');
    expect(result.current.dragState).toEqual({ draggingId: 'a', overId: 'b', edge: 'after' });
  });

  it('onDragOver ignores a text/plain-only payload (only the mime type identifies a comment drag)', () => {
    const onReorder = vi.fn();
    const { result } = renderHook(() => useCommentReorder(['a', 'b'], onReorder));
    const event = makeDragEvent({ dataTransfer: makeDataTransfer({ 'text/plain': 'a' }) });
    act(() => {
      result.current.onDragOver(event, 'b');
    });
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(result.current.dragState).toBeNull();
  });

  it('onDragOver updates the edge when the pointer crosses the midpoint of the same target', () => {
    const onReorder = vi.fn();
    const { result } = renderHook(() => useCommentReorder(['a', 'b'], onReorder));
    const dataTransfer = makeDataTransfer();
    act(() => {
      result.current.onDragStart(makeDragEvent({ dataTransfer }), 'a');
    });
    act(() => {
      result.current.onDragOver(makeDragEvent({ dataTransfer, clientY: 10 }), 'b');
    });
    act(() => {
      result.current.onDragOver(makeDragEvent({ dataTransfer, clientY: 90 }), 'b');
    });
    expect(result.current.dragState).toEqual({ draggingId: 'a', overId: 'b', edge: 'after' });
  });
});
