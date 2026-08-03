import { act, render } from '@testing-library/react';
import { forwardRef, useImperativeHandle } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  CHAT_FAB_EDGE_MARGIN_PX,
  clampChatFabToViewport,
  useChatFabDrag,
  type ChatFabPosition,
} from '../useChatFabDrag.js';

// jsdom's PointerEvent support is incomplete/absent depending on version (matching
// ui/src/react/__tests__/components/TooltipLayer.test.tsx's pattern); setPointerCapture/
// releasePointerCapture/hasPointerCapture aren't implemented in jsdom at all.
beforeAll(() => {
  if (typeof globalThis.PointerEvent === 'undefined') {
    class PointerEventPolyfill extends MouseEvent {
      pointerId: number;
      constructor(type: string, params: MouseEventInit & { pointerId?: number } = {}) {
        super(type, params);
        this.pointerId = params.pointerId ?? 1;
      }
    }
    // @ts-expect-error -- test-environment polyfill
    globalThis.PointerEvent = PointerEventPolyfill;
  }
  if (!('setPointerCapture' in Element.prototype)) {
    // @ts-expect-error -- test-environment polyfill
    Element.prototype.setPointerCapture = () => {};
  }
  if (!('releasePointerCapture' in Element.prototype)) {
    // @ts-expect-error -- test-environment polyfill
    Element.prototype.releasePointerCapture = () => {};
  }
  if (!('hasPointerCapture' in Element.prototype)) {
    // @ts-expect-error -- test-environment polyfill
    Element.prototype.hasPointerCapture = () => false;
  }
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('clampChatFabToViewport', () => {
  it('clamps a position above/left of the margin up to the margin', () => {
    const result = clampChatFabToViewport({ x: -50, y: -50 }, { width: 40, height: 40 });
    expect(result).toEqual({ x: CHAT_FAB_EDGE_MARGIN_PX, y: CHAT_FAB_EDGE_MARGIN_PX });
  });

  it('clamps a position beyond the viewport down to the far edge minus the margin', () => {
    vi.stubGlobal('innerWidth', 200);
    vi.stubGlobal('innerHeight', 150);
    const result = clampChatFabToViewport({ x: 1000, y: 1000 }, { width: 40, height: 40 });
    expect(result).toEqual({ x: 200 - 40 - CHAT_FAB_EDGE_MARGIN_PX, y: 150 - 40 - CHAT_FAB_EDGE_MARGIN_PX });
  });

  it('leaves an already-in-bounds position unchanged', () => {
    vi.stubGlobal('innerWidth', 1024);
    vi.stubGlobal('innerHeight', 768);
    const result = clampChatFabToViewport({ x: 300, y: 400 }, { width: 40, height: 40 });
    expect(result).toEqual({ x: 300, y: 400 });
  });

  it('falls back to the margin when the element is larger than the viewport', () => {
    vi.stubGlobal('innerWidth', 100);
    vi.stubGlobal('innerHeight', 100);
    const result = clampChatFabToViewport({ x: 50, y: 50 }, { width: 500, height: 500 });
    expect(result).toEqual({ x: CHAT_FAB_EDGE_MARGIN_PX, y: CHAT_FAB_EDGE_MARGIN_PX });
  });
});

interface HarnessHandle {
  position: ChatFabPosition | null;
}

const Harness = forwardRef<HarnessHandle, { onClick: () => void; mountButton?: boolean }>(
  function Harness({ onClick, mountButton = true }, ref) {
    const drag = useChatFabDrag(onClick);
    useImperativeHandle(ref, () => ({ position: drag.position }), [drag.position]);
    if (!mountButton) return null;
    return (
      <button
        data-testid="fab"
        ref={drag.buttonRef}
        onPointerDown={drag.onPointerDown}
        onPointerMove={drag.onPointerMove}
        onPointerUp={drag.onPointerUp}
        onPointerCancel={drag.onPointerCancel}
      />
    );
  },
);

/** Stubs the button's geometry so drag math is deterministic regardless of jsdom's default (all-zero) layout. */
function stubGeometry(button: HTMLElement, rect: { left: number; top: number }, size: { width: number; height: number }) {
  button.getBoundingClientRect = () => ({
    left: rect.left,
    top: rect.top,
    width: size.width,
    height: size.height,
    right: rect.left + size.width,
    bottom: rect.top + size.height,
    x: rect.left,
    y: rect.top,
    toJSON: () => ({}),
  }) as DOMRect;
  Object.defineProperty(button, 'offsetWidth', { configurable: true, value: size.width });
  Object.defineProperty(button, 'offsetHeight', { configurable: true, value: size.height });
}

describe('useChatFabDrag', () => {
  it('calls onClick on a plain press-and-release with no movement', () => {
    const onClick = vi.fn();
    const ref = { current: null as HarnessHandle | null };
    const { getByTestId } = render(<Harness ref={ref} onClick={onClick} />);
    const fab = getByTestId('fab');
    stubGeometry(fab, { left: 100, top: 200 }, { width: 50, height: 40 });
    vi.spyOn(fab, 'hasPointerCapture').mockReturnValue(false);
    const releaseSpy = vi.spyOn(fab, 'releasePointerCapture');

    act(() => fab.dispatchEvent(new PointerEvent('pointerdown', { clientX: 120, clientY: 210, pointerId: 1, bubbles: true })));
    act(() => fab.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, bubbles: true })));

    expect(onClick).toHaveBeenCalledTimes(1);
    expect(releaseSpy).not.toHaveBeenCalled();
    expect(ref.current?.position).toBeNull();
  });

  it('does not call onClick once movement exceeds the drag threshold, and commits a clamped position', () => {
    const onClick = vi.fn();
    const ref = { current: null as HarnessHandle | null };
    const { getByTestId } = render(<Harness ref={ref} onClick={onClick} />);
    const fab = getByTestId('fab');
    stubGeometry(fab, { left: 100, top: 200 }, { width: 50, height: 40 });
    vi.stubGlobal('innerWidth', 1024);
    vi.stubGlobal('innerHeight', 768);
    vi.spyOn(fab, 'hasPointerCapture').mockReturnValue(true);
    const releaseSpy = vi.spyOn(fab, 'releasePointerCapture');

    act(() => fab.dispatchEvent(new PointerEvent('pointerdown', { clientX: 120, clientY: 210, pointerId: 1, bubbles: true })));
    act(() => fab.dispatchEvent(new PointerEvent('pointermove', { clientX: 140, clientY: 215, pointerId: 1, bubbles: true })));
    act(() => fab.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, bubbles: true })));

    expect(onClick).not.toHaveBeenCalled();
    expect(releaseSpy).toHaveBeenCalledWith(1);
    expect(ref.current?.position).toEqual({ x: 120, y: 205 });
  });

  it('ignores a pointermove for a pointerId other than the one that started the drag', () => {
    const onClick = vi.fn();
    const ref = { current: null as HarnessHandle | null };
    const { getByTestId } = render(<Harness ref={ref} onClick={onClick} />);
    const fab = getByTestId('fab');
    stubGeometry(fab, { left: 100, top: 200 }, { width: 50, height: 40 });

    act(() => fab.dispatchEvent(new PointerEvent('pointerdown', { clientX: 120, clientY: 210, pointerId: 1, bubbles: true })));
    act(() => fab.dispatchEvent(new PointerEvent('pointermove', { clientX: 300, clientY: 300, pointerId: 2, bubbles: true })));
    expect(ref.current?.position).toBeNull();

    // The original drag is untouched by the foreign pointerId, so releasing pointer 1 still
    // resolves as a click (no real movement was ever recorded for it).
    act(() => fab.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, bubbles: true })));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('does not treat sub-threshold jitter as a drag', () => {
    const onClick = vi.fn();
    const ref = { current: null as HarnessHandle | null };
    const { getByTestId } = render(<Harness ref={ref} onClick={onClick} />);
    const fab = getByTestId('fab');
    stubGeometry(fab, { left: 100, top: 200 }, { width: 50, height: 40 });

    act(() => fab.dispatchEvent(new PointerEvent('pointerdown', { clientX: 120, clientY: 210, pointerId: 1, bubbles: true })));
    // 1px of movement on both axes — well under CHAT_FAB_DRAG_THRESHOLD_PX.
    act(() => fab.dispatchEvent(new PointerEvent('pointermove', { clientX: 121, clientY: 211, pointerId: 1, bubbles: true })));
    expect(ref.current?.position).toBeNull();
    act(() => fab.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, bubbles: true })));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('marks a move as a drag when only the y-axis exceeds the threshold', () => {
    const onClick = vi.fn();
    const ref = { current: null as HarnessHandle | null };
    const { getByTestId } = render(<Harness ref={ref} onClick={onClick} />);
    const fab = getByTestId('fab');
    stubGeometry(fab, { left: 100, top: 200 }, { width: 50, height: 40 });
    vi.stubGlobal('innerWidth', 1024);
    vi.stubGlobal('innerHeight', 768);

    act(() => fab.dispatchEvent(new PointerEvent('pointerdown', { clientX: 120, clientY: 210, pointerId: 1, bubbles: true })));
    // x stays put (0px), y moves 20px — only the second half of the OR should trip.
    act(() => fab.dispatchEvent(new PointerEvent('pointermove', { clientX: 120, clientY: 230, pointerId: 1, bubbles: true })));
    act(() => fab.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, bubbles: true })));

    expect(onClick).not.toHaveBeenCalled();
    expect(ref.current?.position).toEqual({ x: 100, y: 220 });
  });

  it('ignores a pointerup/pointercancel for a pointerId other than the active drag, and when no drag is active', () => {
    const onClick = vi.fn();
    const ref = { current: null as HarnessHandle | null };
    const { getByTestId } = render(<Harness ref={ref} onClick={onClick} />);
    const fab = getByTestId('fab');
    stubGeometry(fab, { left: 100, top: 200 }, { width: 50, height: 40 });

    // No active drag at all — both handlers should no-op rather than throw.
    expect(() => act(() => fab.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, bubbles: true })))).not.toThrow();
    expect(() => act(() => fab.dispatchEvent(new PointerEvent('pointercancel', { pointerId: 1, bubbles: true })))).not.toThrow();
    expect(onClick).not.toHaveBeenCalled();

    act(() => fab.dispatchEvent(new PointerEvent('pointerdown', { clientX: 120, clientY: 210, pointerId: 1, bubbles: true })));
    // A cancel for a foreign pointerId must not clear the real drag.
    act(() => fab.dispatchEvent(new PointerEvent('pointercancel', { pointerId: 99, bubbles: true })));
    act(() => fab.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, bubbles: true })));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('leaves position at null on a viewport resize before any drag has happened', () => {
    const ref = { current: null as HarnessHandle | null };
    render(<Harness ref={ref} onClick={vi.fn()} />);
    expect(() => act(() => globalThis.dispatchEvent(new Event('resize')))).not.toThrow();
    expect(ref.current?.position).toBeNull();
  });

  it('re-clamps a committed position on viewport resize', () => {
    const onClick = vi.fn();
    const ref = { current: null as HarnessHandle | null };
    const { getByTestId } = render(<Harness ref={ref} onClick={onClick} />);
    const fab = getByTestId('fab');
    stubGeometry(fab, { left: 100, top: 200 }, { width: 50, height: 40 });
    vi.stubGlobal('innerWidth', 1024);
    vi.stubGlobal('innerHeight', 768);

    act(() => fab.dispatchEvent(new PointerEvent('pointerdown', { clientX: 120, clientY: 210, pointerId: 1, bubbles: true })));
    act(() => fab.dispatchEvent(new PointerEvent('pointermove', { clientX: 140, clientY: 215, pointerId: 1, bubbles: true })));
    act(() => fab.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, bubbles: true })));
    expect(ref.current?.position).toEqual({ x: 120, y: 205 });

    // Shrink the viewport well below the committed position and confirm resize re-clamps it,
    // proving the resize handler recomputes rather than just re-applying the same value.
    vi.stubGlobal('innerWidth', 100);
    act(() => globalThis.dispatchEvent(new Event('resize')));
    expect(ref.current?.position).toEqual({ x: 100 - 50 - CHAT_FAB_EDGE_MARGIN_PX, y: 205 });
  });

  it('ignores a resize once the button has unmounted', () => {
    const ref = { current: null as HarnessHandle | null };
    const { rerender } = render(<Harness ref={ref} onClick={vi.fn()} />);
    rerender(<Harness ref={ref} onClick={vi.fn()} mountButton={false} />);
    expect(() => act(() => globalThis.dispatchEvent(new Event('resize')))).not.toThrow();
  });
});
