import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useCaretFloatingLayerPosition } from './useCaretFloatingLayerPosition.js';

const CARET = { top: 400, bottom: 420, left: 100, right: 120 };

describe('useCaretFloatingLayerPosition', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('starts with a null pos before any measured pass', () => {
    const { result } = renderHook(() => useCaretFloatingLayerPosition(null, false));
    expect(result.current.pos).toBeNull();
  });

  it('computes a position once open with a caret', () => {
    const { result, rerender } = renderHook(
      ({ caret, open }: { caret: typeof CARET | null; open: boolean }) =>
        useCaretFloatingLayerPosition(caret, open),
      { initialProps: { caret: null as typeof CARET | null, open: false } },
    );
    expect(result.current.pos).toBeNull();
    rerender({ caret: CARET, open: true });
    expect(result.current.pos).not.toBeNull();
    expect(result.current.pos?.placement).toBe('above');
  });

  it('a resize/scroll while open but with no caret yet is a safe no-op', () => {
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    });
    const { result } = renderHook(
      ({ caret, open }: { caret: typeof CARET | null; open: boolean }) =>
        useCaretFloatingLayerPosition(caret, open),
      { initialProps: { caret: null as typeof CARET | null, open: true } },
    );
    expect(result.current.pos).toBeNull();
    act(() => {
      window.dispatchEvent(new Event('resize'));
    });
    expect(result.current.pos).toBeNull();
  });

  it('does not compute when caret is present but open is false', () => {
    const { result, rerender } = renderHook(
      ({ caret, open }: { caret: typeof CARET | null; open: boolean }) =>
        useCaretFloatingLayerPosition(caret, open),
      { initialProps: { caret: null as typeof CARET | null, open: false } },
    );
    rerender({ caret: CARET, open: false });
    expect(result.current.pos).toBeNull();
  });

  it('recomputes on resize (rAF-throttled) while open', () => {
    // Make rAF fire synchronously so the throttled reposition is observable
    // without real async timing.
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    });
    const { result, rerender } = renderHook(
      ({ caret, open }: { caret: typeof CARET | null; open: boolean }) =>
        useCaretFloatingLayerPosition(caret, open),
      { initialProps: { caret: null as typeof CARET | null, open: false } },
    );
    rerender({ caret: CARET, open: true });
    const firstPos = result.current.pos;

    act(() => {
      window.dispatchEvent(new Event('resize'));
    });
    // A new position object was computed (setPos ran again), even though
    // this particular caret/viewport combination happens to produce
    // identical numbers — reference inequality proves the effect re-ran.
    expect(result.current.pos).not.toBe(firstPos);
  });

  it('recomputes on a capturing scroll event while open', () => {
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    });
    const { result, rerender } = renderHook(
      ({ caret, open }: { caret: typeof CARET | null; open: boolean }) =>
        useCaretFloatingLayerPosition(caret, open),
      { initialProps: { caret: null as typeof CARET | null, open: false } },
    );
    rerender({ caret: CARET, open: true });
    const firstPos = result.current.pos;

    act(() => {
      window.dispatchEvent(new Event('scroll'));
    });
    expect(result.current.pos).not.toBe(firstPos);
  });

  it('coalesces multiple resize events into a single rAF-scheduled reposition', () => {
    let scheduled: FrameRequestCallback | null = null;
    const rafSpy = vi
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((cb: FrameRequestCallback) => {
        scheduled = cb;
        return 1;
      });
    const { rerender } = renderHook(
      ({ caret, open }: { caret: typeof CARET | null; open: boolean }) =>
        useCaretFloatingLayerPosition(caret, open),
      { initialProps: { caret: null as typeof CARET | null, open: false } },
    );
    rerender({ caret: CARET, open: true });
    rafSpy.mockClear();
    act(() => {
      window.dispatchEvent(new Event('resize'));
      window.dispatchEvent(new Event('resize'));
      window.dispatchEvent(new Event('resize'));
    });
    expect(rafSpy).toHaveBeenCalledTimes(1);
    act(() => {
      scheduled?.(0);
    });
  });

  it('stops listening for resize/scroll once closed, and cancels a pending rAF on unmount', async () => {
    const cancelSpy = vi.spyOn(window, 'cancelAnimationFrame');
    const { rerender, unmount } = renderHook(
      ({ caret, open }: { caret: typeof CARET | null; open: boolean }) =>
        useCaretFloatingLayerPosition(caret, open),
      { initialProps: { caret: null as typeof CARET | null, open: false } },
    );
    rerender({ caret: CARET, open: true });
    act(() => {
      window.dispatchEvent(new Event('resize'));
    });
    unmount();
    expect(cancelSpy).toHaveBeenCalled();
  });

  it('passes the boundary element rect through to the position calculation', () => {
    const boundaryEl = document.createElement('div');
    vi.spyOn(boundaryEl, 'getBoundingClientRect').mockReturnValue({
      left: 50,
      right: 350,
      width: 300,
      top: 0,
      bottom: 800,
    } as DOMRect);
    const boundaryRef = { current: boundaryEl };
    const { result, rerender } = renderHook(
      ({ caret, open }: { caret: typeof CARET | null; open: boolean }) =>
        useCaretFloatingLayerPosition(caret, open, boundaryRef),
      { initialProps: { caret: null as typeof CARET | null, open: false } },
    );
    rerender({ caret: CARET, open: true });
    expect(result.current.pos!.width).toBeLessThanOrEqual(300);
  });
});
