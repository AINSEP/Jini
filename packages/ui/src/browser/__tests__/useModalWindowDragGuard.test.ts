// @vitest-environment jsdom
import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MODAL_WINDOW_DRAG_STRIP_HEIGHT,
  eventHitsModalWindowDragStrip,
  useModalWindowDragGuard,
} from '../useModalWindowDragGuard.js';

const BACKDROP_SELECTOR = '.test-modal-backdrop';

function makeBackdrop(): HTMLDivElement {
  const el = document.createElement('div');
  el.className = 'test-modal-backdrop';
  document.body.appendChild(el);
  return el;
}

function dispatchOn(el: Element, type: string, clientY: number) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientY });
  el.dispatchEvent(event);
  return event;
}

describe('eventHitsModalWindowDragStrip', () => {
  it('is true for a target matching the selector inside the strip height', () => {
    const backdrop = makeBackdrop();
    const event = new MouseEvent('mousedown', { clientY: 10 });
    Object.defineProperty(event, 'target', { value: backdrop });
    expect(eventHitsModalWindowDragStrip({ event, backdropSelector: BACKDROP_SELECTOR })).toBe(true);
    backdrop.remove();
  });

  it('is false when clientY is below the strip', () => {
    const backdrop = makeBackdrop();
    const event = new MouseEvent('mousedown', {
      clientY: MODAL_WINDOW_DRAG_STRIP_HEIGHT + 1,
    });
    Object.defineProperty(event, 'target', { value: backdrop });
    expect(eventHitsModalWindowDragStrip({ event, backdropSelector: BACKDROP_SELECTOR })).toBe(false);
    backdrop.remove();
  });

  it('is false when the target does not match the selector', () => {
    const other = document.createElement('div');
    other.className = 'not-a-backdrop';
    const event = new MouseEvent('mousedown', { clientY: 5 });
    Object.defineProperty(event, 'target', { value: other });
    expect(eventHitsModalWindowDragStrip({ event, backdropSelector: BACKDROP_SELECTOR })).toBe(false);
  });
});

describe('useModalWindowDragGuard', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('stops propagation for a click inside the drag strip on a matching backdrop', () => {
    const backdrop = makeBackdrop();
    renderHook(() => useModalWindowDragGuard({ backdropSelector: BACKDROP_SELECTOR }));

    const outerListener = vi.fn();
    document.addEventListener('mousedown', outerListener);

    dispatchOn(backdrop, 'mousedown', 10);

    // The capture-phase guard should have called stopPropagation before the
    // bubble-phase listener on document ever ran.
    expect(outerListener).not.toHaveBeenCalled();

    document.removeEventListener('mousedown', outerListener);
  });

  it('does not stop propagation for a click outside the drag strip region', () => {
    const backdrop = makeBackdrop();
    renderHook(() => useModalWindowDragGuard({ backdropSelector: BACKDROP_SELECTOR }));

    const outerListener = vi.fn();
    document.addEventListener('mousedown', outerListener);

    dispatchOn(backdrop, 'mousedown', MODAL_WINDOW_DRAG_STRIP_HEIGHT + 50);

    expect(outerListener).toHaveBeenCalledTimes(1);

    document.removeEventListener('mousedown', outerListener);
  });

  it('does not stop propagation for a click on a non-matching element', () => {
    renderHook(() => useModalWindowDragGuard({ backdropSelector: BACKDROP_SELECTOR }));

    const other = document.createElement('div');
    document.body.appendChild(other);

    const outerListener = vi.fn();
    document.addEventListener('mousedown', outerListener);

    dispatchOn(other, 'mousedown', 10);

    expect(outerListener).toHaveBeenCalledTimes(1);

    document.removeEventListener('mousedown', outerListener);
  });

  it('does nothing when enabled is false', () => {
    const backdrop = makeBackdrop();
    renderHook(() =>
      useModalWindowDragGuard({ backdropSelector: BACKDROP_SELECTOR, enabled: false }),
    );

    const outerListener = vi.fn();
    document.addEventListener('mousedown', outerListener);

    dispatchOn(backdrop, 'mousedown', 10);

    expect(outerListener).toHaveBeenCalledTimes(1);

    document.removeEventListener('mousedown', outerListener);
  });

  it('removes its listeners on unmount', () => {
    const backdrop = makeBackdrop();
    const { unmount } = renderHook(() =>
      useModalWindowDragGuard({ backdropSelector: BACKDROP_SELECTOR }),
    );

    unmount();

    const outerListener = vi.fn();
    document.addEventListener('mousedown', outerListener);

    dispatchOn(backdrop, 'mousedown', 10);

    expect(outerListener).toHaveBeenCalledTimes(1);

    document.removeEventListener('mousedown', outerListener);
  });
});
