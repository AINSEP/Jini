// @vitest-environment jsdom
import { renderHook } from '@testing-library/react';
import type { RefObject } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { useDismissOnOutsideOrEscape } from '../useDismissOnOutsideOrEscape.js';

// jsdom's PointerEvent support is incomplete/absent depending on version;
// the hook only relies on `target`, which a plain MouseEvent-based polyfill
// covers fine for these tests (same polyfill as components/TooltipLayer.test.tsx).
beforeAll(() => {
  if (typeof globalThis.PointerEvent === 'undefined') {
    class PointerEventPolyfill extends MouseEvent {
      constructor(type: string, params: MouseEventInit = {}) {
        super(type, params);
      }
    }
    // @ts-expect-error -- test-environment polyfill
    globalThis.PointerEvent = PointerEventPolyfill;
  }
});

function refTo(node: HTMLElement | null): RefObject<HTMLElement | null> {
  return { current: node };
}

describe('useDismissOnOutsideOrEscape', () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it('calls onDismiss on a pointerdown outside the container', () => {
    const container = document.createElement('div');
    const outside = document.createElement('button');
    document.body.append(container, outside);
    const onDismiss = vi.fn();

    renderHook(() => useDismissOnOutsideOrEscape({ onDismiss }, { containerRef: refTo(container) }));

    outside.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('does not call onDismiss on a pointerdown inside the container', () => {
    const container = document.createElement('div');
    const inside = document.createElement('button');
    container.append(inside);
    document.body.append(container);
    const onDismiss = vi.fn();

    renderHook(() => useDismissOnOutsideOrEscape({ onDismiss }, { containerRef: refTo(container) }));

    inside.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('calls onDismiss on Escape regardless of target', () => {
    const container = document.createElement('div');
    document.body.append(container);
    const onDismiss = vi.fn();

    renderHook(() => useDismissOnOutsideOrEscape({ onDismiss }, { containerRef: refTo(container) }));

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(onDismiss).toHaveBeenCalledTimes(1);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('without a containerRef, only Escape dismisses (no outside-click listener at all)', () => {
    const outside = document.createElement('button');
    document.body.append(outside);
    const onDismiss = vi.fn();

    renderHook(() => useDismissOnOutsideOrEscape({ onDismiss }));

    outside.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    expect(onDismiss).not.toHaveBeenCalled();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('attaches no listeners while enabled is false', () => {
    const addSpy = vi.spyOn(document, 'addEventListener');
    const onDismiss = vi.fn();

    renderHook(() => useDismissOnOutsideOrEscape({ onDismiss }, { enabled: false, containerRef: refTo(null) }));

    expect(addSpy).not.toHaveBeenCalled();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(onDismiss).not.toHaveBeenCalled();
    addSpy.mockRestore();
  });

  it('removes listeners on unmount', () => {
    const outside = document.createElement('button');
    document.body.append(outside);
    const container = document.createElement('div');
    document.body.append(container);
    const onDismiss = vi.fn();

    const { unmount } = renderHook(() => useDismissOnOutsideOrEscape({ onDismiss }, { containerRef: refTo(container) }));
    unmount();

    outside.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('always calls the latest onDismiss without requiring the caller to memoize it', () => {
    const container = document.createElement('div');
    document.body.append(container);
    const first = vi.fn();
    const second = vi.fn();

    const { rerender } = renderHook(
      ({ onDismiss }) => useDismissOnOutsideOrEscape({ onDismiss }, { containerRef: refTo(container) }),
      { initialProps: { onDismiss: first } },
    );
    rerender({ onDismiss: second });

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });
});
