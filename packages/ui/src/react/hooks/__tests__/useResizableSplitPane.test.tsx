// @vitest-environment jsdom
import { act, fireEvent, render, screen } from '@testing-library/react';
import { createRef, forwardRef, useImperativeHandle } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { readSavedWidth, saveWidth, useResizableSplitPane, type ResizableSplitPaneController } from '../useResizableSplitPane.js';

// jsdom's PointerEvent support is incomplete; a MouseEvent-based polyfill
// (matching components/TooltipLayer.test.tsx's pattern) covers the fields
// this hook reads (clientX, button, pointerId). setPointerCapture/
// releasePointerCapture aren't implemented in jsdom at all.
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
});

interface HarnessHandle {
  api: ResizableSplitPaneController;
}

const Harness = forwardRef<
  HarnessHandle,
  { options?: Parameters<typeof useResizableSplitPane>[0]; attachContainer?: boolean }
>(function Harness({ options, attachContainer = true }, ref) {
  const api = useResizableSplitPane(options);
  useImperativeHandle(ref, () => ({ api }), [api]);
  return (
    <div
      ref={attachContainer ? api.containerRef : undefined}
      data-testid="container"
      style={api.containerStyle}
    >
      <div>primary</div>
      <div
        data-testid="handle"
        tabIndex={0}
        onPointerDown={api.onHandlePointerDown}
        onKeyDown={api.onHandleKeyDown}
        onBlur={api.onHandleBlur}
      />
      <div>secondary</div>
    </div>
  );
});

function flushRaf(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

const STORAGE_KEY = 'test.split-pane.width';

describe('useResizableSplitPane', () => {
  beforeEach(() => {
    window.localStorage.clear();
    // jsdom containers report 0 width by default; stub a normal-sized one so
    // the ResizeObserver-fallback effect's clamping math exercises the
    // "container wide enough" branch unless a test overrides it.
    Object.defineProperty(HTMLDivElement.prototype, 'clientWidth', {
      configurable: true,
      value: 1000,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('starts at the default width when nothing is persisted', () => {
    const ref = createRef<HarnessHandle>();
    render(<Harness ref={ref} options={{ storageKey: STORAGE_KEY }} />);
    expect(ref.current?.api.width).toBe(460);
  });

  it('reads a valid persisted width from localStorage on mount', () => {
    window.localStorage.setItem(STORAGE_KEY, '500');
    const ref = createRef<HarnessHandle>();
    render(<Harness ref={ref} options={{ storageKey: STORAGE_KEY }} />);
    expect(ref.current?.api.width).toBe(500);
  });

  it('falls back to the default width for a non-numeric persisted value', () => {
    window.localStorage.setItem(STORAGE_KEY, 'not-a-number');
    const ref = createRef<HarnessHandle>();
    render(<Harness ref={ref} options={{ storageKey: STORAGE_KEY }} />);
    expect(ref.current?.api.width).toBe(460);
  });

  it('clamps a persisted value outside [minWidth, maxWidth] to the explicit maxWidth option, before container-width narrowing', () => {
    window.localStorage.setItem(STORAGE_KEY, '10000');
    const ref = createRef<HarnessHandle>();
    // A tight maxWidth well under the stubbed 1000px container means the
    // container-width-narrowing effect won't further clamp the result,
    // isolating the persisted-value clamp this test targets.
    render(<Harness ref={ref} options={{ storageKey: STORAGE_KEY, maxWidth: 500, minWidth: 100 }} />);
    expect(ref.current?.api.width).toBe(500);
  });

  it('persists under a generic default key when no storageKey is given (not a skip)', () => {
    const ref = createRef<HarnessHandle>();
    render(<Harness ref={ref} />);
    expect(ref.current?.api.width).toBe(460);
    const handle = screen.getByTestId('handle');
    act(() => {
      handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    });
    expect(window.localStorage.getItem('jini.resizable-split-pane.width')).toBe('476');
  });

  it('falls back to the default width when localStorage.getItem throws', () => {
    vi.spyOn(window.localStorage.__proto__, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const ref = createRef<HarnessHandle>();
    render(<Harness ref={ref} options={{ storageKey: STORAGE_KEY }} />);
    expect(ref.current?.api.width).toBe(460);
  });

  it('swallows a localStorage.setItem failure when saving after a keyboard resize', () => {
    vi.spyOn(window.localStorage.__proto__, 'setItem').mockImplementation(() => {
      throw new Error('quota exceeded');
    });
    const ref = createRef<HarnessHandle>();
    render(<Harness ref={ref} options={{ storageKey: STORAGE_KEY }} />);
    const handle = screen.getByTestId('handle');
    expect(() => {
      act(() => {
        handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
      });
    }).not.toThrow();
  });

  it('ignores a non-primary-button pointerdown', () => {
    const ref = createRef<HarnessHandle>();
    render(<Harness ref={ref} options={{ storageKey: STORAGE_KEY }} />);
    const handle = screen.getByTestId('handle');
    act(() => {
      handle.dispatchEvent(
        new PointerEvent('pointerdown', { button: 2, clientX: 100, bubbles: true, pointerId: 1 }),
      );
    });
    expect(ref.current?.api.isResizing).toBe(false);
  });

  it('resizes on drag, coalescing rapid pointermove events into one RAF-flushed update', async () => {
    const ref = createRef<HarnessHandle>();
    render(<Harness ref={ref} options={{ storageKey: STORAGE_KEY }} />);
    const handle = screen.getByTestId('handle');
    const startWidth = ref.current!.api.width;

    act(() => {
      handle.dispatchEvent(
        new PointerEvent('pointerdown', { button: 0, clientX: 200, bubbles: true, pointerId: 1 }),
      );
    });
    expect(ref.current?.api.isResizing).toBe(true);

    // During an active drag, width updates go straight to the DOM (perf —
    // avoids a re-render per pointermove); React state only commits at
    // drag-end. So assert on the container's live style mid-drag, and on
    // `api.width` only after pointerup.
    const container = screen.getByTestId('container');

    // Fire several moves before the RAF flush — only the last clientX should win.
    act(() => {
      window.dispatchEvent(new PointerEvent('pointermove', { clientX: 210 }));
      window.dispatchEvent(new PointerEvent('pointermove', { clientX: 220 }));
      window.dispatchEvent(new PointerEvent('pointermove', { clientX: 250 }));
    });
    await act(async () => {
      await flushRaf();
    });
    expect(container.style.getPropertyValue('--resizable-split-pane-primary-width')).toBe(
      `${startWidth + 50}px`,
    );

    act(() => {
      window.dispatchEvent(new PointerEvent('pointerup', {}));
    });
    expect(ref.current?.api.isResizing).toBe(false);
    expect(ref.current?.api.width).toBe(startWidth + 50);
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe(String(startWidth + 50));
  });

  it('inverts drag direction under RTL', async () => {
    const ref = createRef<HarnessHandle>();
    render(<Harness ref={ref} options={{ storageKey: STORAGE_KEY }} />);
    const container = screen.getByTestId('container');
    container.style.direction = 'rtl';
    vi.spyOn(window, 'getComputedStyle').mockReturnValue({ direction: 'rtl' } as CSSStyleDeclaration);
    const handle = screen.getByTestId('handle');
    const startWidth = ref.current!.api.width;

    act(() => {
      handle.dispatchEvent(
        new PointerEvent('pointerdown', { button: 0, clientX: 200, bubbles: true, pointerId: 1 }),
      );
    });
    act(() => {
      window.dispatchEvent(new PointerEvent('pointermove', { clientX: 250 }));
    });
    await act(async () => {
      await flushRaf();
    });
    act(() => {
      window.dispatchEvent(new PointerEvent('pointerup', {}));
    });
    // RTL: moving right (positive delta) narrows the primary pane.
    expect(ref.current?.api.width).toBe(startWidth - 50);
  });

  it('reverts to the pre-drag width on pointercancel, without persisting anything', async () => {
    const ref = createRef<HarnessHandle>();
    render(<Harness ref={ref} options={{ storageKey: STORAGE_KEY }} />);
    const container = screen.getByTestId('container');
    const handle = screen.getByTestId('handle');
    const startWidth = ref.current!.api.width;

    act(() => {
      handle.dispatchEvent(
        new PointerEvent('pointerdown', { button: 0, clientX: 200, bubbles: true, pointerId: 1 }),
      );
    });
    act(() => {
      window.dispatchEvent(new PointerEvent('pointermove', { clientX: 260 }));
    });
    await act(async () => {
      await flushRaf();
    });
    expect(container.style.getPropertyValue('--resizable-split-pane-primary-width')).not.toBe(
      `${startWidth}px`,
    );

    act(() => {
      window.dispatchEvent(new PointerEvent('pointercancel', {}));
    });
    expect(ref.current?.api.width).toBe(startWidth);
    expect(ref.current?.api.isResizing).toBe(false);
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('reverts an in-progress drag when the handle loses focus', async () => {
    // Native `blur` doesn't bubble (only `focusout` does) -- React's
    // synthetic onBlur listens at the root via focusout/focusin, so this
    // must go through testing-library's fireEvent (which translates
    // correctly), not a raw dispatchEvent('blur').
    const ref = createRef<HarnessHandle>();
    render(<Harness ref={ref} options={{ storageKey: STORAGE_KEY }} />);
    const container = screen.getByTestId('container');
    const handle = screen.getByTestId('handle');
    const startWidth = ref.current!.api.width;

    act(() => {
      handle.dispatchEvent(
        new PointerEvent('pointerdown', { button: 0, clientX: 200, bubbles: true, pointerId: 1 }),
      );
    });
    act(() => {
      window.dispatchEvent(new PointerEvent('pointermove', { clientX: 240 }));
    });
    await act(async () => {
      await flushRaf();
    });
    expect(container.style.getPropertyValue('--resizable-split-pane-primary-width')).not.toBe(
      `${startWidth}px`,
    );

    act(() => {
      fireEvent.blur(handle);
    });
    expect(ref.current?.api.width).toBe(startWidth);
    expect(ref.current?.api.isResizing).toBe(false);
  });

  it('a blur with no drag in progress is a no-op', () => {
    const ref = createRef<HarnessHandle>();
    render(<Harness ref={ref} options={{ storageKey: STORAGE_KEY }} />);
    const handle = screen.getByTestId('handle');
    const startWidth = ref.current!.api.width;
    act(() => {
      fireEvent.blur(handle);
    });
    expect(ref.current?.api.width).toBe(startWidth);
  });

  it('resizes via ArrowLeft/ArrowRight and persists the result', () => {
    const ref = createRef<HarnessHandle>();
    render(<Harness ref={ref} options={{ storageKey: STORAGE_KEY, keyboardStep: 20 }} />);
    const handle = screen.getByTestId('handle');
    const startWidth = ref.current!.api.width;

    act(() => {
      handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    });
    expect(ref.current?.api.width).toBe(startWidth + 20);
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe(String(startWidth + 20));

    act(() => {
      handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    });
    expect(ref.current?.api.width).toBe(startWidth);
  });

  it('inverts arrow-key direction under RTL', () => {
    vi.spyOn(window, 'getComputedStyle').mockReturnValue({ direction: 'rtl' } as CSSStyleDeclaration);
    const ref = createRef<HarnessHandle>();
    render(<Harness ref={ref} options={{ storageKey: STORAGE_KEY, keyboardStep: 20 }} />);
    const handle = screen.getByTestId('handle');
    const startWidth = ref.current!.api.width;

    act(() => {
      handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    });
    expect(ref.current?.api.width).toBe(startWidth - 20);

    act(() => {
      handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    });
    expect(ref.current?.api.width).toBe(startWidth);
  });

  it('Home jumps to minWidth, End jumps to the current maxWidth', () => {
    const ref = createRef<HarnessHandle>();
    render(<Harness ref={ref} options={{ storageKey: STORAGE_KEY, minWidth: 300, maxWidth: 700 }} />);
    const handle = screen.getByTestId('handle');

    act(() => {
      handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
    });
    expect(ref.current?.api.width).toBe(300);

    act(() => {
      handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
    });
    expect(ref.current?.api.width).toBe(ref.current?.api.maxWidth);
  });

  it('ignores unrelated keys', () => {
    const ref = createRef<HarnessHandle>();
    render(<Harness ref={ref} options={{ storageKey: STORAGE_KEY }} />);
    const handle = screen.getByTestId('handle');
    const startWidth = ref.current!.api.width;
    act(() => {
      handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    });
    expect(ref.current?.api.width).toBe(startWidth);
  });

  it('narrows maxWidth and zeroes secondaryMinWidth when the container is too small, via ResizeObserver', () => {
    const observed: Array<() => void> = [];
    class FakeResizeObserver {
      constructor(private cb: () => void) {
        observed.push(cb);
      }
      observe() {
        this.cb();
      }
      disconnect() {}
    }
    // @ts-expect-error -- test stub
    globalThis.ResizeObserver = FakeResizeObserver;

    Object.defineProperty(HTMLDivElement.prototype, 'clientWidth', {
      configurable: true,
      value: 500,
    });

    const ref = createRef<HarnessHandle>();
    render(
      <Harness
        ref={ref}
        options={{ storageKey: STORAGE_KEY, minWidth: 345, maxWidth: 720, minSecondaryWidth: 400, handleWidth: 8 }}
      />,
    );
    // container(500) < minWidth(345) + handleWidth(8) + minSecondaryWidth(400) = 753 -> secondary collapses to 0.
    expect(ref.current?.api.secondaryMinWidth).toBe(0);
    expect(ref.current?.api.maxWidth).toBe(Math.max(0, Math.min(720, 500 - 8 - 0)));

    // @ts-expect-error -- test cleanup
    delete globalThis.ResizeObserver;
  });

  it('falls back to a window resize listener when ResizeObserver is unavailable, and cleans it up on unmount', () => {
    const previousRO = globalThis.ResizeObserver;
    // @ts-expect-error -- simulate an environment without ResizeObserver
    delete globalThis.ResizeObserver;
    const addSpy = vi.spyOn(window, 'addEventListener');
    const removeSpy = vi.spyOn(window, 'removeEventListener');

    const ref = createRef<HarnessHandle>();
    const { unmount } = render(<Harness ref={ref} options={{ storageKey: STORAGE_KEY }} />);
    expect(addSpy).toHaveBeenCalledWith('resize', expect.any(Function));

    Object.defineProperty(HTMLDivElement.prototype, 'clientWidth', {
      configurable: true,
      value: 900,
    });
    act(() => {
      window.dispatchEvent(new Event('resize'));
    });
    // maxWidth = min(720, floor(900 - handleWidth(8) - secondaryMinWidth(400))) = min(720, 492) = 492.
    expect(ref.current?.api.maxWidth).toBe(492);

    unmount();
    expect(removeSpy).toHaveBeenCalledWith('resize', expect.any(Function));

    globalThis.ResizeObserver = previousRO;
  });

  it('cancels an in-flight drag when the component unmounts mid-resize', () => {
    const ref = createRef<HarnessHandle>();
    const { unmount } = render(<Harness ref={ref} options={{ storageKey: STORAGE_KEY }} />);
    const handle = screen.getByTestId('handle');
    act(() => {
      handle.dispatchEvent(
        new PointerEvent('pointerdown', { button: 0, clientX: 200, bubbles: true, pointerId: 1 }),
      );
    });
    expect(() => unmount()).not.toThrow();
  });

  it('reports 0 width with the default width when a nonzero clientWidth is unavailable (falls back gracefully)', () => {
    Object.defineProperty(HTMLDivElement.prototype, 'clientWidth', {
      configurable: true,
      value: 0,
    });
    const ref = createRef<HarnessHandle>();
    render(<Harness ref={ref} options={{ storageKey: STORAGE_KEY }} />);
    expect(ref.current?.api.maxWidth).toBe(720);
    expect(ref.current?.api.secondaryMinWidth).toBe(400);
  });

  it('cancels a pending RAF-scheduled frame when the component unmounts before the frame fires', () => {
    // handlePointerEnd/handlePointerCancel both flush the pending frame
    // themselves before calling finishResize, so finishResize's OWN
    // pointerFrameRef check is only reachable via the unmount-cleanup path
    // (finishResize(false) called directly, bypassing that flush) while a
    // pointermove-scheduled frame is still outstanding.
    const rafCancelSpy = vi.spyOn(window, 'cancelAnimationFrame');
    const ref = createRef<HarnessHandle>();
    const { unmount } = render(<Harness ref={ref} options={{ storageKey: STORAGE_KEY }} />);
    const handle = screen.getByTestId('handle');

    act(() => {
      handle.dispatchEvent(
        new PointerEvent('pointerdown', { button: 0, clientX: 200, bubbles: true, pointerId: 1 }),
      );
    });
    act(() => {
      // Schedules a RAF via handlePointerMove but never awaits it.
      window.dispatchEvent(new PointerEvent('pointermove', { clientX: 240 }));
    });
    unmount();
    expect(rafCancelSpy).toHaveBeenCalled();
  });

  it('flushes and cancels a still-pending pointermove RAF when pointerup fires before the frame runs', () => {
    // The RAF callback itself nulls pointerFrameRef before calling
    // flushPendingPointerMove, so that call never sees a pending frame.
    // flushPendingPointerMove's OWN cancelAnimationFrame branch is only
    // reachable when pointerup/pointercancel calls it directly WHILE a
    // pointermove-scheduled frame is still outstanding (i.e. no `await
    // flushRaf()` in between, unlike the coalescing test above).
    const rafCancelSpy = vi.spyOn(window, 'cancelAnimationFrame');
    const ref = createRef<HarnessHandle>();
    render(<Harness ref={ref} options={{ storageKey: STORAGE_KEY }} />);
    const container = screen.getByTestId('container');
    const handle = screen.getByTestId('handle');
    const startWidth = ref.current!.api.width;

    act(() => {
      handle.dispatchEvent(
        new PointerEvent('pointerdown', { button: 0, clientX: 200, bubbles: true, pointerId: 1 }),
      );
    });
    act(() => {
      window.dispatchEvent(new PointerEvent('pointermove', { clientX: 250 }));
      window.dispatchEvent(new PointerEvent('pointerup', {}));
    });
    expect(rafCancelSpy).toHaveBeenCalled();
    // pointerup's own synchronous flush still applies the last pending move.
    expect(ref.current?.api.width).toBe(startWidth + 50);
    expect(container.style.getPropertyValue('--resizable-split-pane-primary-width')).toBe(
      `${startWidth + 50}px`,
    );
  });

  it('treats a pointermove that lands back on the exact drag-start position as a no-op', async () => {
    const ref = createRef<HarnessHandle>();
    render(<Harness ref={ref} options={{ storageKey: STORAGE_KEY }} />);
    const container = screen.getByTestId('container');
    const handle = screen.getByTestId('handle');
    const startWidth = ref.current!.api.width;

    act(() => {
      handle.dispatchEvent(
        new PointerEvent('pointerdown', { button: 0, clientX: 200, bubbles: true, pointerId: 1 }),
      );
    });
    act(() => {
      // Same clientX as the pointerdown -- delta is 0 and the drag hasn't
      // moved yet, so this should be a genuine no-op, not a width change.
      window.dispatchEvent(new PointerEvent('pointermove', { clientX: 200 }));
    });
    await act(async () => {
      await flushRaf();
    });
    expect(container.style.getPropertyValue('--resizable-split-pane-primary-width')).toBe(
      `${startWidth}px`,
    );
  });

  it('does not throw when the consumer never attaches containerRef to a DOM node', () => {
    const ref = createRef<HarnessHandle>();
    render(<Harness ref={ref} options={{ storageKey: STORAGE_KEY }} attachContainer={false} />);
    const handle = screen.getByTestId('handle');
    expect(() => {
      act(() => {
        handle.dispatchEvent(
          new PointerEvent('pointerdown', { button: 0, clientX: 200, bubbles: true, pointerId: 1 }),
        );
      });
    }).not.toThrow();
    // The pointerdown handler bails out early (no container to resize against).
    expect(ref.current?.api.isResizing).toBe(false);
  });

  it('keyboard resize falls back to LTR when the container is unattached', () => {
    const ref = createRef<HarnessHandle>();
    render(
      <Harness ref={ref} options={{ storageKey: STORAGE_KEY, keyboardStep: 20 }} attachContainer={false} />,
    );
    const handle = screen.getByTestId('handle');
    const startWidth = ref.current!.api.width;
    act(() => {
      handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    });
    // No container -> isRtl defaults to false -> ArrowRight still widens.
    expect(ref.current?.api.width).toBe(startWidth + 20);
  });

  it('tears down and re-registers listeners when a second pointerdown starts before the first drag ends', async () => {
    const ref = createRef<HarnessHandle>();
    render(<Harness ref={ref} options={{ storageKey: STORAGE_KEY }} />);
    const container = screen.getByTestId('container');
    const handle = screen.getByTestId('handle');
    const startWidth = ref.current!.api.width;

    act(() => {
      handle.dispatchEvent(
        new PointerEvent('pointerdown', { button: 0, clientX: 200, bubbles: true, pointerId: 1 }),
      );
    });
    // A second pointerdown while the first drag is still active must clean up
    // the first drag's window listeners (pointerCleanupRef.current?.()) before
    // registering a fresh set, rather than leaking two live listener sets.
    act(() => {
      handle.dispatchEvent(
        new PointerEvent('pointerdown', { button: 0, clientX: 300, bubbles: true, pointerId: 2 }),
      );
    });
    act(() => {
      window.dispatchEvent(new PointerEvent('pointermove', { clientX: 320 }));
    });
    await act(async () => {
      await flushRaf();
    });
    // Delta is measured from the SECOND pointerdown's start (300), not the first (200).
    expect(container.style.getPropertyValue('--resizable-split-pane-primary-width')).toBe(
      `${startWidth + 20}px`,
    );
  });

  describe('readSavedWidth/saveWidth SSR guards', () => {
    // Stubbed within this same jsdom file, rather than a separate
    // `@vitest-environment node` companion file: a prior version used a
    // separate-environment file (matching features/sketch-editor/dom.ssr
    // .test.ts's precedent) and proved via statement-level coverage that
    // the guard genuinely executed (the code after it provably did not
    // run), but V8's branch-level counter still misreported that path as
    // untaken -- a real merge-across-environments artifact, not a real
    // gap. Stubbing `window` to undefined in-place keeps everything in one
    // environment/coverage worker, which resolves it (unstubbed via
    // vi.unstubAllGlobals() in this file's afterEach).
    it('readSavedWidth returns the default width when window is undefined', () => {
      vi.stubGlobal('window', undefined);
      expect(typeof window).toBe('undefined');
      expect(readSavedWidth({ storageKey: 'any-key', defaultWidth: 460, min: 345, max: 720 })).toBe(460);
    });

    it('saveWidth is a no-op when window is undefined', () => {
      vi.stubGlobal('window', undefined);
      expect(typeof window).toBe('undefined');
      expect(() => saveWidth({ storageKey: 'any-key', width: 500, min: 345, max: 720 })).not.toThrow();
    });
  });
});
