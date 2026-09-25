import { act, renderHook } from '@testing-library/react';
import type { DragEvent } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useFileDropTarget } from '../useFileDropTarget.js';

/**
 * Pins that a drop target's drag-over state (the chat composer's dashed "drop here" outline, among
 * others) can never stay on after the drag is over. Each case below is a way the drag ends; the first
 * two used to leave `draggingFiles` stuck at `true`, because only this target's own `onDrop` and
 * `onDragLeave` ever cleared it — and a host that handles a drop itself in the capture phase (a host's
 * folder-drop-to-path, which stops propagation) means this target's `onDrop` never runs.
 */

/** Only the fields `useFileDropTarget`'s drag handlers read. */
function dragEvent(currentTarget: Element, relatedTarget: EventTarget | null = null): DragEvent<Element> {
  return {
    preventDefault: vi.fn(),
    dataTransfer: { dropEffect: 'none' },
    currentTarget,
    relatedTarget,
  } as unknown as DragEvent<Element>;
}

/** A zone with one nested child, already dragged over (`draggingFiles === true`). */
function renderDraggingTarget() {
  const zone = document.createElement('div');
  const child = zone.appendChild(document.createElement('span'));
  document.body.appendChild(zone);
  const hook = renderHook(() => useFileDropTarget(vi.fn()));
  act(() => hook.result.current.onDragEnter(dragEvent(zone)));
  expect(hook.result.current.draggingFiles).toBe(true);
  return { hook, zone, child };
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('useFileDropTarget clears its drag-over state whenever the drag ends', () => {
  it('after a drop that never reaches this target (a host stopped its propagation)', () => {
    const { hook } = renderDraggingTarget();
    act(() => {
      window.dispatchEvent(new Event('drop'));
    });
    expect(hook.result.current.draggingFiles).toBe(false);
  });

  it('after the drag ends at the window (dragend)', () => {
    const { hook } = renderDraggingTarget();
    act(() => {
      window.dispatchEvent(new Event('dragend'));
    });
    expect(hook.result.current.draggingFiles).toBe(false);
  });

  it('after dragleave out of the zone — but not while moving onto a nested child', () => {
    const { hook, zone, child } = renderDraggingTarget();
    act(() => hook.result.current.onDragEnter(dragEvent(zone)));
    act(() => hook.result.current.onDragLeave(dragEvent(zone, child)));
    expect(hook.result.current.draggingFiles).toBe(true);
    act(() => hook.result.current.onDragLeave(dragEvent(zone, document.body)));
    expect(hook.result.current.draggingFiles).toBe(false);
  });

  it('a later drag re-arms it after a window-level reset', () => {
    const { hook, zone } = renderDraggingTarget();
    act(() => {
      window.dispatchEvent(new Event('drop'));
    });
    act(() => hook.result.current.onDragEnter(dragEvent(zone)));
    expect(hook.result.current.draggingFiles).toBe(true);
  });
});
