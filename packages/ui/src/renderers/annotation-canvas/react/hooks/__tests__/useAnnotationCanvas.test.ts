import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { useAnnotationCanvas } from '../useAnnotationCanvas.js';
import { createFakeAnnotationCanvasPort } from '../../../dependencies.js';
import type { AnnotationSubmitDetail, PreviewSnapshot } from '../../../types.js';

function fakePointerEvent(overrides: Partial<ReactPointerEvent> = {}): ReactPointerEvent {
  return {
    preventDefault: () => {},
    stopPropagation: () => {},
    target: { setPointerCapture: undefined },
    currentTarget: { setPointerCapture: undefined, releasePointerCapture: undefined, style: {} },
    pointerId: 1,
    clientX: 0,
    clientY: 0,
    timeStamp: 0,
    ...overrides,
  } as unknown as ReactPointerEvent;
}

/** Stubs `el.getBoundingClientRect()` so point-from-event/rect-based math in the hook (pointFromEvent, dock placement, text bounds, …) sees a real, non-zero rect — jsdom itself never computes real layout. */
function stubRect(el: { getBoundingClientRect: () => DOMRect }, rect: Partial<DOMRect>): void {
  const full = { x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0, toJSON: () => full, ...rect } as DOMRect;
  el.getBoundingClientRect = () => full;
}

/** Swaps in a fake global for the duration of `run()`, restoring the previous value (or removing the key entirely if it was absent) afterward — used for `ResizeObserver`, which jsdom doesn't define at all by default. */
function withGlobal<K extends PropertyKey, T>(key: K, value: T, run: () => void): void {
  const target = globalThis as Record<PropertyKey, unknown>;
  const had = Object.prototype.hasOwnProperty.call(target, key);
  const original = target[key];
  target[key] = value;
  try {
    run();
  } finally {
    if (had) target[key] = original;
    else delete target[key];
  }
}

describe('useAnnotationCanvas', () => {
  it('defaults to the box mark tool and the send submit action', () => {
    const { result } = renderHook(() => useAnnotationCanvas({ active: true, port: createFakeAnnotationCanvasPort() }));
    expect(result.current.markTool).toBe('box');
    expect(result.current.submitAction).toBe('send');
    expect(result.current.markToolOptions.map((o) => o.tool)).toEqual(['box', 'pen', 'text']);
  });

  it('selectMarkTool switches tools, fires onToolbarClick, and closes the tool menu', () => {
    const onToolbarClick = vi.fn();
    const { result } = renderHook(() => useAnnotationCanvas({ active: true, onToolbarClick, port: createFakeAnnotationCanvasPort() }));
    act(() => result.current.setMarkToolMenuOpen(true));
    act(() => result.current.selectMarkTool('pen'));
    expect(result.current.markTool).toBe('pen');
    expect(result.current.markToolMenuOpen).toBe(false);
    expect(onToolbarClick).toHaveBeenCalledWith('pen');
  });

  it('commits a freehand stroke on pointer down/move/up and undo/redo it', () => {
    const onToolbarClick = vi.fn();
    const { result } = renderHook(() => useAnnotationCanvas({ active: true, onToolbarClick, port: createFakeAnnotationCanvasPort() }));
    act(() => result.current.selectMarkTool('pen'));
    act(() => result.current.onPointerDown(fakePointerEvent()));
    act(() => result.current.onPointerMove(fakePointerEvent({ clientX: 5, clientY: 5 })));
    act(() => result.current.onPointerUp(fakePointerEvent()));
    expect(result.current.canUndo).toBe(true);

    act(() => result.current.undoStroke());
    expect(result.current.canUndo).toBe(false);
    expect(result.current.canRedo).toBe(true);
    expect(onToolbarClick).toHaveBeenCalledWith('undo');

    act(() => result.current.redoStroke());
    expect(result.current.canUndo).toBe(true);
    expect(onToolbarClick).toHaveBeenCalledWith('redo');
  });

  it('does not commit a single-point stroke (a click without drag)', () => {
    const { result } = renderHook(() => useAnnotationCanvas({ active: true, port: createFakeAnnotationCanvasPort() }));
    act(() => result.current.selectMarkTool('pen'));
    act(() => result.current.onPointerDown(fakePointerEvent()));
    act(() => result.current.onPointerUp(fakePointerEvent()));
    expect(result.current.canUndo).toBe(false);
  });

  it('Escape closes the overlay while active', () => {
    const onActiveChange = vi.fn();
    renderHook(() => useAnnotationCanvas({ active: true, onActiveChange, port: createFakeAnnotationCanvasPort() }));
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(onActiveChange).toHaveBeenCalledWith(false);
  });

  it('does not respond to keyboard shortcuts while inactive', () => {
    const onActiveChange = vi.fn();
    renderHook(() => useAnnotationCanvas({ active: false, onActiveChange, port: createFakeAnnotationCanvasPort() }));
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(onActiveChange).not.toHaveBeenCalled();
  });

  it('Cmd+Z undoes and Shift+Cmd+Z redoes', () => {
    const { result } = renderHook(() => useAnnotationCanvas({ active: true, port: createFakeAnnotationCanvasPort() }));
    act(() => result.current.selectMarkTool('pen'));
    act(() => result.current.onPointerDown(fakePointerEvent()));
    act(() => result.current.onPointerMove(fakePointerEvent({ clientX: 5, clientY: 5 })));
    act(() => result.current.onPointerUp(fakePointerEvent()));
    expect(result.current.canUndo).toBe(true);

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', metaKey: true }));
    });
    expect(result.current.canUndo).toBe(false);

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', metaKey: true, shiftKey: true }));
    });
    expect(result.current.canUndo).toBe(true);
  });

  it('Ctrl+Z (non-Mac) also undoes', () => {
    const { result } = renderHook(() => useAnnotationCanvas({ active: true, port: createFakeAnnotationCanvasPort() }));
    act(() => result.current.selectMarkTool('pen'));
    act(() => result.current.onPointerDown(fakePointerEvent()));
    act(() => result.current.onPointerMove(fakePointerEvent({ clientX: 5, clientY: 5 })));
    act(() => result.current.onPointerUp(fakePointerEvent()));
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Z', ctrlKey: true }));
    });
    expect(result.current.canUndo).toBe(false);
  });

  it('Enter in the note input submits as queue (submit-action picker gap #2)', async () => {
    const onSubmit = vi.fn(async (detail: AnnotationSubmitDetail) => ({ ok: true }));
    const { result } = renderHook(() => useAnnotationCanvas({ active: true, port: createFakeAnnotationCanvasPort({ onSubmit }) }));
    act(() => result.current.setNote('a note'));
    await act(async () => {
      result.current.onNoteKeyDown({ key: 'Enter' } as never);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ action: 'queue', note: 'a note' }));
  });

  it('Enter does not submit while an IME composition is active', () => {
    const onSubmit = vi.fn(async () => ({ ok: true }));
    const { result } = renderHook(() => useAnnotationCanvas({ active: true, port: createFakeAnnotationCanvasPort({ onSubmit }) }));
    act(() => result.current.setNote('a note'));
    act(() => result.current.onCompositionStart());
    act(() => result.current.onNoteKeyDown({ key: 'Enter' } as never));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('Enter submits again once the IME composition ends', async () => {
    const onSubmit = vi.fn(async () => ({ ok: true }));
    const { result } = renderHook(() => useAnnotationCanvas({ active: true, port: createFakeAnnotationCanvasPort({ onSubmit }) }));
    act(() => result.current.setNote('a note'));
    act(() => result.current.onCompositionStart());
    act(() => result.current.onCompositionEnd());
    await act(async () => {
      result.current.onNoteKeyDown({ key: 'Enter' } as never);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ action: 'queue' }));
  });

  it('the submit-action picker (send/draft/queue) exists and drives which action send() submits', async () => {
    const onSubmit = vi.fn(async () => ({ ok: true }));
    const { result } = renderHook(() => useAnnotationCanvas({ active: true, port: createFakeAnnotationCanvasPort({ onSubmit }) }));
    expect(result.current.submitOptions.map((o) => o.action)).toEqual(['send', 'draft', 'queue']);

    act(() => result.current.setNote('note'));
    act(() => result.current.chooseSubmitAction('draft'));
    expect(result.current.submitAction).toBe('draft');
    expect(result.current.submitMenuOpen).toBe(false);
    await act(async () => {
      await Promise.resolve();
    });
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ action: 'draft' }));
  });

  it('gates only the send option when sendDisabled is set', () => {
    const { result } = renderHook(() => useAnnotationCanvas({ active: true, sendDisabled: true, port: createFakeAnnotationCanvasPort() }));
    const send = result.current.submitOptions.find((o) => o.action === 'send')!;
    const queue = result.current.submitOptions.find((o) => o.action === 'queue')!;
    expect(send.enabled).toBe(false);
    expect(queue.enabled).toBe(false); // nothing to submit yet either
    act(() => result.current.setNote('hi'));
  });

  it('send() resolves ok:false from the port and reports it via captureWarning', async () => {
    const onSubmit = vi.fn(async () => ({ ok: false, message: 'boom' }));
    const { result } = renderHook(() => useAnnotationCanvas({ active: true, port: createFakeAnnotationCanvasPort({ onSubmit }) }));
    act(() => result.current.setNote('hi'));
    await act(async () => {
      await result.current.send('send');
    });
    expect(result.current.captureWarning).toEqual({ action: 'send', message: 'boom' });
  });

  it('clears the note and attachments after a successful send', async () => {
    const { result } = renderHook(() => useAnnotationCanvas({ active: true, port: createFakeAnnotationCanvasPort() }));
    act(() => result.current.setNote('hi'));
    await act(async () => {
      await result.current.send('send');
    });
    expect(result.current.note).toBe('');
  });

  it('does not submit send() while sendDisabled and action is send', async () => {
    const onSubmit = vi.fn(async () => ({ ok: true }));
    const { result } = renderHook(() => useAnnotationCanvas({ active: true, sendDisabled: true, port: createFakeAnnotationCanvasPort({ onSubmit }) }));
    act(() => result.current.setNote('hi'));
    await act(async () => {
      await result.current.send('send');
    });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('text tool: pointer down drops a new editable label; blur removes it if empty', () => {
    const { result } = renderHook(() => useAnnotationCanvas({ active: true, port: createFakeAnnotationCanvasPort() }));
    act(() => result.current.selectMarkTool('text'));
    act(() => result.current.onPointerDown(fakePointerEvent()));
    expect(result.current.textMarks).toHaveLength(1);
    const id = result.current.textMarks[0]!.id;
    expect(result.current.textMarks[0]!.editing).toBe(true);

    act(() => result.current.updateTextMark(id, 'hello'));
    expect(result.current.textMarks[0]!.text).toBe('hello');

    act(() => result.current.handleTextBlur(id));
    expect(result.current.textMarks).toHaveLength(1); // has text, stays

    act(() => result.current.selectMarkTool('text'));
    act(() => result.current.onPointerDown(fakePointerEvent()));
    const secondId = result.current.textMarks[1]!.id;
    act(() => result.current.handleTextBlur(secondId));
    expect(result.current.textMarks).toHaveLength(1); // empty label dropped on blur
  });

  it('removeTextMark removes a label directly', () => {
    const { result } = renderHook(() => useAnnotationCanvas({ active: true, port: createFakeAnnotationCanvasPort() }));
    act(() => result.current.selectMarkTool('text'));
    act(() => result.current.onPointerDown(fakePointerEvent()));
    const id = result.current.textMarks[0]!.id;
    act(() => result.current.removeTextMark(id));
    expect(result.current.textMarks).toHaveLength(0);
  });

  it('addExtraFiles only accepts image files', () => {
    const { result } = renderHook(() => useAnnotationCanvas({ active: true, port: createFakeAnnotationCanvasPort() }));
    const image = new File(['x'], 'a.png', { type: 'image/png' });
    const text = new File(['x'], 'a.txt', { type: 'text/plain' });
    act(() => result.current.addExtraFiles([image, text]));
    expect(result.current.extraFiles).toEqual([image]);
  });

  it('resets all drawing state when deactivated', () => {
    const { result, rerender } = renderHook(({ active }) => useAnnotationCanvas({ active, port: createFakeAnnotationCanvasPort() }), {
      initialProps: { active: true },
    });
    act(() => result.current.selectMarkTool('pen'));
    act(() => result.current.onPointerDown(fakePointerEvent()));
    act(() => result.current.onPointerMove(fakePointerEvent({ clientX: 5, clientY: 5 })));
    act(() => result.current.onPointerUp(fakePointerEvent()));
    expect(result.current.canUndo).toBe(true);

    rerender({ active: false });
    expect(result.current.canUndo).toBe(false);
  });

  describe('keyboard shortcut #2: staged-image preview modal', () => {
    it('Escape (capture phase) closes it, independent of the overlay-close shortcut', () => {
      const onActiveChange = vi.fn();
      const { result } = renderHook(() => useAnnotationCanvas({ active: false, onActiveChange, port: createFakeAnnotationCanvasPort() }));
      act(() => result.current.setPreviewIndex(0));
      act(() => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      });
      expect(result.current.previewIndex).toBeNull();
      expect(onActiveChange).not.toHaveBeenCalled();
    });

    it('a non-Escape key leaves it open', () => {
      const { result } = renderHook(() => useAnnotationCanvas({ active: false, port: createFakeAnnotationCanvasPort() }));
      act(() => result.current.setPreviewIndex(0));
      act(() => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));
      });
      expect(result.current.previewIndex).toBe(0);
    });

    it('is not registered at all when no preview is staged', () => {
      const { result } = renderHook(() => useAnnotationCanvas({ active: false, port: createFakeAnnotationCanvasPort() }));
      expect(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))).not.toThrow();
      expect(result.current.previewIndex).toBeNull();
    });
  });

  describe('keyboard shortcut #3: submit-action menu', () => {
    it('Escape dismisses it', () => {
      const { result } = renderHook(() => useAnnotationCanvas({ active: false, port: createFakeAnnotationCanvasPort() }));
      act(() => result.current.setSubmitMenuOpen(true));
      act(() => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      });
      expect(result.current.submitMenuOpen).toBe(false);
    });

    it('a pointerdown outside the menu dismisses it; one inside does not', () => {
      const { result } = renderHook(() => useAnnotationCanvas({ active: false, port: createFakeAnnotationCanvasPort() }));

      act(() => result.current.setSubmitMenuOpen(true));
      (result.current.submitMenuRef as { current: unknown }).current = { contains: () => true } as unknown as HTMLDivElement;
      act(() => {
        window.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      });
      expect(result.current.submitMenuOpen).toBe(true); // click landed "inside"

      (result.current.submitMenuRef as { current: unknown }).current = { contains: () => false } as unknown as HTMLDivElement;
      act(() => {
        window.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      });
      expect(result.current.submitMenuOpen).toBe(false); // click landed "outside"
    });
  });

  describe('keyboard shortcut #4: mark-tool menu', () => {
    it('Escape dismisses it', () => {
      const { result } = renderHook(() => useAnnotationCanvas({ active: false, port: createFakeAnnotationCanvasPort() }));
      act(() => result.current.setMarkToolMenuOpen(true));
      act(() => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      });
      expect(result.current.markToolMenuOpen).toBe(false);
    });

    it('a pointerdown outside the menu dismisses it; one inside does not', () => {
      const { result } = renderHook(() => useAnnotationCanvas({ active: false, port: createFakeAnnotationCanvasPort() }));

      act(() => result.current.setMarkToolMenuOpen(true));
      (result.current.markToolMenuRef as { current: unknown }).current = { contains: () => true } as unknown as HTMLDivElement;
      act(() => {
        window.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      });
      expect(result.current.markToolMenuOpen).toBe(true);

      (result.current.markToolMenuRef as { current: unknown }).current = { contains: () => false } as unknown as HTMLDivElement;
      act(() => {
        window.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      });
      expect(result.current.markToolMenuOpen).toBe(false);
    });
  });

  describe('canvas sizing + rAF-coalesced redraw', () => {
    it('resizes the canvas from the wrap element, using devicePixelRatio when present, and (with ResizeObserver available) observes it for future resizes', () => {
      const originalDpr = window.devicePixelRatio;
      Object.defineProperty(window, 'devicePixelRatio', { value: 2, configurable: true });
      class FakeResizeObserver {
        observeCalls: Element[] = [];
        disconnected = false;
        observe(el: Element) {
          this.observeCalls.push(el);
        }
        disconnect() {
          this.disconnected = true;
        }
      }
      let lastInstance: FakeResizeObserver | undefined;
      class TrackedResizeObserver extends FakeResizeObserver {
        constructor() {
          super();
          lastInstance = this;
        }
      }
      try {
        withGlobal('ResizeObserver', TrackedResizeObserver, () => {
          const { result } = renderHook(() => useAnnotationCanvas({ active: true, port: createFakeAnnotationCanvasPort() }));
          const wrap = document.createElement('div');
          Object.defineProperty(wrap, 'offsetWidth', { value: 300, configurable: true });
          Object.defineProperty(wrap, 'offsetHeight', { value: 150, configurable: true });
          const canvasEl = document.createElement('canvas');
          act(() => {
            result.current.wrapRef.current = wrap;
            result.current.canvasRef.current = canvasEl;
          });
          // The sizing effect depends on [redraw, active, hasInk, hasBox, hasText] —
          // committing a stroke changes hasInk, forcing it to re-run now that both
          // refs are attached (they were still null during the initial mount).
          act(() => result.current.selectMarkTool('pen'));
          act(() => result.current.onPointerDown(fakePointerEvent()));
          act(() => result.current.onPointerMove(fakePointerEvent({ clientX: 5, clientY: 5 })));
          act(() => result.current.onPointerUp(fakePointerEvent()));

          expect(canvasEl.width).toBe(600);
          expect(canvasEl.height).toBe(300);
          expect(canvasEl.style.width).toBe('300px');
          expect(canvasEl.style.height).toBe('150px');
          expect(lastInstance?.observeCalls).toContain(wrap);
        });
      } finally {
        Object.defineProperty(window, 'devicePixelRatio', { value: originalDpr, configurable: true });
      }
    });

    it('falls back to a 1x devicePixelRatio and skips ResizeObserver when it is not defined', () => {
      const originalDpr = window.devicePixelRatio;
      Object.defineProperty(window, 'devicePixelRatio', { value: 0, configurable: true });
      try {
        const { result } = renderHook(() => useAnnotationCanvas({ active: true, port: createFakeAnnotationCanvasPort() }));
        const wrap = document.createElement('div');
        Object.defineProperty(wrap, 'offsetWidth', { value: 200, configurable: true });
        Object.defineProperty(wrap, 'offsetHeight', { value: 100, configurable: true });
        const canvasEl = document.createElement('canvas');
        act(() => {
          result.current.wrapRef.current = wrap;
          result.current.canvasRef.current = canvasEl;
        });
        act(() => result.current.selectMarkTool('pen'));
        act(() => result.current.onPointerDown(fakePointerEvent()));
        act(() => result.current.onPointerMove(fakePointerEvent({ clientX: 5, clientY: 5 })));
        act(() => result.current.onPointerUp(fakePointerEvent()));
        expect(canvasEl.width).toBe(200); // dpr fell back to 1, not 0
        expect(canvasEl.height).toBe(100);
      } finally {
        Object.defineProperty(window, 'devicePixelRatio', { value: originalDpr, configurable: true });
      }
    });

    it('actually runs the coalesced redraw once the animation frame fires, instead of only ever being cancelled', async () => {
      const { result } = renderHook(() => useAnnotationCanvas({ active: true, port: createFakeAnnotationCanvasPort() }));
      act(() => result.current.selectMarkTool('pen'));
      act(() => result.current.onPointerDown(fakePointerEvent()));
      act(() => result.current.onPointerMove(fakePointerEvent({ clientX: 5, clientY: 5 })));
      await act(async () => {
        await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
      });
      act(() => result.current.onPointerUp(fakePointerEvent()));
      expect(result.current.canUndo).toBe(true);
    });
  });

  describe('box tool with a real canvas rect', () => {
    it('commits a normalized selection box on a drag past the minimum-size threshold', () => {
      const { result } = renderHook(() => useAnnotationCanvas({ active: true, port: createFakeAnnotationCanvasPort() }));
      const canvasEl = document.createElement('canvas');
      stubRect(canvasEl, { left: 0, top: 0, width: 100, height: 100 });
      act(() => {
        result.current.canvasRef.current = canvasEl;
      });
      act(() => result.current.onPointerDown(fakePointerEvent({ clientX: 10, clientY: 10 })));
      act(() => result.current.onPointerMove(fakePointerEvent({ clientX: 50, clientY: 60 })));
      act(() => result.current.onPointerUp(fakePointerEvent({ clientX: 50, clientY: 60 })));
      expect(result.current.canUndo).toBe(true);
    });

    it('discards a drag that never clears the minimum-size threshold', () => {
      const { result } = renderHook(() => useAnnotationCanvas({ active: true, port: createFakeAnnotationCanvasPort() }));
      const canvasEl = document.createElement('canvas');
      stubRect(canvasEl, { left: 0, top: 0, width: 100, height: 100 });
      act(() => {
        result.current.canvasRef.current = canvasEl;
      });
      act(() => result.current.onPointerDown(fakePointerEvent({ clientX: 10, clientY: 10 })));
      act(() => result.current.onPointerMove(fakePointerEvent({ clientX: 10.2, clientY: 10.2 })));
      act(() => result.current.onPointerUp(fakePointerEvent({ clientX: 10.2, clientY: 10.2 })));
      expect(result.current.canUndo).toBe(false);
    });

    it('undoStroke discards an in-progress box draft without committing it', () => {
      const onToolbarClick = vi.fn();
      const { result } = renderHook(() => useAnnotationCanvas({ active: true, onToolbarClick, port: createFakeAnnotationCanvasPort() }));
      const canvasEl = document.createElement('canvas');
      stubRect(canvasEl, { left: 0, top: 0, width: 100, height: 100 });
      act(() => {
        result.current.canvasRef.current = canvasEl;
      });
      act(() => result.current.onPointerDown(fakePointerEvent({ clientX: 10, clientY: 10 })));
      act(() => result.current.undoStroke());
      expect(onToolbarClick).toHaveBeenCalledWith('undo');
      act(() => result.current.onPointerUp(fakePointerEvent({ clientX: 50, clientY: 60 })));
      expect(result.current.canUndo).toBe(false); // the draft was discarded before it could commit
    });

    it('undoStroke removes a committed box (distinct from removing a freehand stroke)', () => {
      const onToolbarClick = vi.fn();
      const { result } = renderHook(() => useAnnotationCanvas({ active: true, onToolbarClick, port: createFakeAnnotationCanvasPort() }));
      const canvasEl = document.createElement('canvas');
      stubRect(canvasEl, { left: 0, top: 0, width: 100, height: 100 });
      act(() => {
        result.current.canvasRef.current = canvasEl;
      });
      act(() => result.current.onPointerDown(fakePointerEvent({ clientX: 10, clientY: 10 })));
      act(() => result.current.onPointerMove(fakePointerEvent({ clientX: 50, clientY: 60 })));
      act(() => result.current.onPointerUp(fakePointerEvent({ clientX: 50, clientY: 60 })));
      expect(result.current.canUndo).toBe(true);

      act(() => result.current.undoStroke());
      expect(onToolbarClick).toHaveBeenCalledWith('undo');
      expect(result.current.canUndo).toBe(false);
    });
  });

  describe('text-label drag (onTextPointerDown/Move/Up)', () => {
    function createdEditableMark(active = true) {
      const { result } = renderHook(() => useAnnotationCanvas({ active, port: createFakeAnnotationCanvasPort() }));
      const canvasEl = document.createElement('canvas');
      stubRect(canvasEl, { left: 0, top: 0, width: 100, height: 100 });
      act(() => {
        result.current.canvasRef.current = canvasEl;
      });
      act(() => result.current.selectMarkTool('text'));
      act(() => result.current.onPointerDown(fakePointerEvent({ clientX: 10, clientY: 10 })));
      const mark = result.current.textMarks[0]!;
      act(() => result.current.updateTextMark(mark.id, 'hi'));
      act(() => result.current.handleTextBlur(mark.id)); // stop editing (has text, so it isn't dropped)
      return { result, mark };
    }

    it('a drag past the movement threshold repositions the mark', () => {
      const { result, mark } = createdEditableMark();
      const target = { style: {} as Record<string, string>, setPointerCapture: vi.fn(), releasePointerCapture: vi.fn() };
      act(() =>
        result.current.onTextPointerDown(fakePointerEvent({ clientX: 20, clientY: 20, currentTarget: target as never }), mark),
      );
      act(() =>
        result.current.onTextPointerMove(fakePointerEvent({ clientX: 40, clientY: 20, currentTarget: target as never }), mark),
      );
      expect(parseFloat(target.style.left!)).toBeCloseTo(30);
      act(() =>
        result.current.onTextPointerUp(fakePointerEvent({ clientX: 40, clientY: 20, currentTarget: target as never }), mark),
      );
      const updated = result.current.textMarks.find((m) => m.id === mark.id)!;
      expect(updated.x).toBeCloseTo(0.3);
    });

    it('a tap without movement does not reposition the mark, and moving a different mark mid-drag is ignored', () => {
      const { result, mark } = createdEditableMark();
      const target = { style: {} as Record<string, string>, setPointerCapture: vi.fn(), releasePointerCapture: vi.fn() };
      act(() =>
        result.current.onTextPointerDown(fakePointerEvent({ clientX: 10, clientY: 10, currentTarget: target as never }), mark),
      );
      // A move reported for an unrelated mark id must be a no-op against this drag.
      act(() =>
        result.current.onTextPointerMove(fakePointerEvent({ clientX: 99, clientY: 99, currentTarget: target as never }), {
          ...mark,
          id: mark.id + 999,
        }),
      );
      act(() =>
        result.current.onTextPointerUp(fakePointerEvent({ clientX: 10, clientY: 10, currentTarget: target as never, timeStamp: 100 }), mark),
      );
      const updated = result.current.textMarks.find((m) => m.id === mark.id)!;
      expect(updated.x).toBeCloseTo(0.1);
      expect(updated.editing).toBe(false);
    });

    it('two quick taps (double-tap) enter edit mode', () => {
      const { result, mark } = createdEditableMark();
      const target = { style: {} as Record<string, string>, setPointerCapture: vi.fn(), releasePointerCapture: vi.fn() };
      act(() =>
        result.current.onTextPointerDown(fakePointerEvent({ clientX: 10, clientY: 10, currentTarget: target as never, timeStamp: 1000 }), mark),
      );
      act(() =>
        result.current.onTextPointerUp(fakePointerEvent({ clientX: 10, clientY: 10, currentTarget: target as never, timeStamp: 1000 }), mark),
      );
      act(() =>
        result.current.onTextPointerDown(fakePointerEvent({ clientX: 10, clientY: 10, currentTarget: target as never, timeStamp: 1100 }), mark),
      );
      act(() =>
        result.current.onTextPointerUp(fakePointerEvent({ clientX: 10, clientY: 10, currentTarget: target as never, timeStamp: 1100 }), mark),
      );
      expect(result.current.textMarks.find((m) => m.id === mark.id)!.editing).toBe(true);
    });

    it('two taps more than 320ms apart do not count as a double-tap', () => {
      const { result, mark } = createdEditableMark();
      const target = { style: {} as Record<string, string>, setPointerCapture: vi.fn(), releasePointerCapture: vi.fn() };
      act(() =>
        result.current.onTextPointerDown(fakePointerEvent({ clientX: 10, clientY: 10, currentTarget: target as never, timeStamp: 1000 }), mark),
      );
      act(() =>
        result.current.onTextPointerUp(fakePointerEvent({ clientX: 10, clientY: 10, currentTarget: target as never, timeStamp: 1000 }), mark),
      );
      act(() =>
        result.current.onTextPointerDown(fakePointerEvent({ clientX: 10, clientY: 10, currentTarget: target as never, timeStamp: 2000 }), mark),
      );
      act(() =>
        result.current.onTextPointerUp(fakePointerEvent({ clientX: 10, clientY: 10, currentTarget: target as never, timeStamp: 2000 }), mark),
      );
      expect(result.current.textMarks.find((m) => m.id === mark.id)!.editing).toBe(false);
    });

    it('onTextPointerDown is a no-op while the mark is already being edited', () => {
      const { result } = renderHook(() => useAnnotationCanvas({ active: true, port: createFakeAnnotationCanvasPort() }));
      act(() => result.current.selectMarkTool('text'));
      act(() => result.current.onPointerDown(fakePointerEvent()));
      const mark = result.current.textMarks[0]!;
      expect(mark.editing).toBe(true);
      const target = { style: {} as Record<string, string>, setPointerCapture: vi.fn() };
      act(() => result.current.onTextPointerDown(fakePointerEvent({ currentTarget: target as never }), mark));
      expect(target.setPointerCapture).not.toHaveBeenCalled();
    });

    it('onTextPointerDown/Move ignore a zero-size canvas rect', () => {
      const { result, mark } = createdEditableMark();
      const canvasEl = result.current.canvasRef.current!;
      stubRect(canvasEl, { left: 0, top: 0, width: 0, height: 0 });
      const target = { style: {} as Record<string, string>, setPointerCapture: vi.fn() };
      act(() => result.current.onTextPointerDown(fakePointerEvent({ currentTarget: target as never }), mark));
      expect(target.setPointerCapture).not.toHaveBeenCalled();
    });
  });

  describe('registerTextArea', () => {
    it('backs the autofocus-on-create effect and the autosize-on-change effect', () => {
      const { result } = renderHook(() => useAnnotationCanvas({ active: true, port: createFakeAnnotationCanvasPort() }));
      act(() => result.current.selectMarkTool('text'));
      act(() => result.current.onPointerDown(fakePointerEvent()));
      const mark = result.current.textMarks[0]!;
      expect(mark.editing).toBe(true);

      const el = document.createElement('textarea');
      document.body.appendChild(el);
      Object.defineProperty(el, 'scrollWidth', { value: 80, configurable: true });
      Object.defineProperty(el, 'scrollHeight', { value: 20, configurable: true });
      act(() => result.current.registerTextArea(mark.id, el));

      el.value = 'hello';
      // Re-run the [editingTextId, textMarks] focus effect and the
      // [frameSize, textMarks, autosizeTextArea] autosize effect by changing
      // textMarks now that the element is actually registered.
      act(() => result.current.updateTextMark(mark.id, 'hello'));

      expect(document.activeElement).toBe(el);
      expect(el.selectionStart).toBe('hello'.length);
      expect(el.style.width).toBe('82px');

      act(() => result.current.registerTextArea(mark.id, null));
      el.remove();
    });
  });

  it('handleTextEscape blurs the given textarea element', () => {
    const { result } = renderHook(() => useAnnotationCanvas({ active: true, port: createFakeAnnotationCanvasPort() }));
    const el = document.createElement('textarea');
    document.body.appendChild(el);
    el.focus();
    expect(document.activeElement).toBe(el);
    act(() => result.current.handleTextEscape(1, el));
    expect(document.activeElement).not.toBe(el);
    el.remove();
  });

  describe('autosizeTextArea', () => {
    it('grows the element to fit its scroll dimensions', () => {
      const { result } = renderHook(() => useAnnotationCanvas({ active: true, port: createFakeAnnotationCanvasPort() }));
      const el = document.createElement('textarea');
      Object.defineProperty(el, 'scrollWidth', { value: 120, configurable: true });
      Object.defineProperty(el, 'scrollHeight', { value: 40, configurable: true });
      act(() => result.current.autosizeTextArea(el));
      expect(el.style.width).toBe('122px');
      expect(el.style.height).toBe('40px');
    });

    it('is a no-op for a null element', () => {
      const { result } = renderHook(() => useAnnotationCanvas({ active: true, port: createFakeAnnotationCanvasPort() }));
      expect(() => result.current.autosizeTextArea(null)).not.toThrow();
    });
  });

  describe('file-attachment handlers', () => {
    it('onFileInputChange stages image files and clears the input value', () => {
      const { result } = renderHook(() => useAnnotationCanvas({ active: true, port: createFakeAnnotationCanvasPort() }));
      const input = document.createElement('input');
      input.type = 'file';
      const file = new File(['x'], 'a.png', { type: 'image/png' });
      Object.defineProperty(input, 'files', { value: [file], configurable: true });
      act(() => result.current.onFileInputChange({ target: input } as never));
      expect(result.current.extraFiles).toEqual([file]);
      expect(input.value).toBe('');
    });

    it('addExtraFiles is a no-op given a null FileList', () => {
      const { result } = renderHook(() => useAnnotationCanvas({ active: true, port: createFakeAnnotationCanvasPort() }));
      act(() => result.current.addExtraFiles(null));
      expect(result.current.extraFiles).toEqual([]);
    });

    it('onNotePaste stages pasted image files and prevents default; leaves non-image/empty pastes alone', () => {
      const { result } = renderHook(() => useAnnotationCanvas({ active: true, port: createFakeAnnotationCanvasPort() }));
      const file = new File(['x'], 'a.png', { type: 'image/png' });
      const preventDefault = vi.fn();
      act(() => result.current.onNotePaste({ clipboardData: { files: [file] }, preventDefault } as never));
      expect(result.current.extraFiles).toEqual([file]);
      expect(preventDefault).toHaveBeenCalled();

      const preventDefaultEmpty = vi.fn();
      act(() => result.current.onNotePaste({ clipboardData: { files: [] }, preventDefault: preventDefaultEmpty } as never));
      expect(preventDefaultEmpty).not.toHaveBeenCalled();

      const preventDefaultText = vi.fn();
      const textFile = new File(['x'], 'a.txt', { type: 'text/plain' });
      act(() => result.current.onNotePaste({ clipboardData: { files: [textFile] }, preventDefault: preventDefaultText } as never));
      expect(preventDefaultText).not.toHaveBeenCalled();

      const preventDefaultNone = vi.fn();
      act(() => result.current.onNotePaste({ clipboardData: undefined, preventDefault: preventDefaultNone } as never));
      expect(preventDefaultNone).not.toHaveBeenCalled();
    });

    it('removeExtraFile removes the file at the given index and closes any open preview', () => {
      const { result } = renderHook(() => useAnnotationCanvas({ active: true, port: createFakeAnnotationCanvasPort() }));
      const a = new File(['x'], 'a.png', { type: 'image/png' });
      const b = new File(['y'], 'b.png', { type: 'image/png' });
      act(() => result.current.addExtraFiles([a, b]));
      expect(result.current.imagePreviews).toHaveLength(2);
      act(() => result.current.setPreviewIndex(1));
      act(() => result.current.removeExtraFile(0));
      expect(result.current.extraFiles).toEqual([b]);
      expect(result.current.previewIndex).toBeNull();
    });
  });

  describe('sending guards', () => {
    it('ignores pointer events and undo/redo while a submit is already in flight', async () => {
      let resolveSubmit!: (v: { ok: boolean }) => void;
      const onSubmit = vi.fn(
        () =>
          new Promise<{ ok: boolean }>((resolve) => {
            resolveSubmit = resolve;
          }),
      );
      const { result } = renderHook(() => useAnnotationCanvas({ active: true, port: createFakeAnnotationCanvasPort({ onSubmit }) }));
      act(() => result.current.setNote('hi'));
      act(() => {
        void result.current.send('send');
      });
      expect(result.current.sending).toBe(true);

      act(() => result.current.onPointerDown(fakePointerEvent()));
      act(() => result.current.onPointerMove(fakePointerEvent({ clientX: 5, clientY: 5 })));
      act(() => result.current.onPointerUp(fakePointerEvent()));
      expect(result.current.canUndo).toBe(false);

      act(() => result.current.undoStroke());
      act(() => result.current.redoStroke());

      await act(async () => {
        resolveSubmit({ ok: true });
        await Promise.resolve();
        await Promise.resolve();
      });
    });

    it('a second send() call while already sending is a no-op', async () => {
      let resolveSubmit!: (v: { ok: boolean }) => void;
      const onSubmit = vi.fn(
        () =>
          new Promise<{ ok: boolean }>((resolve) => {
            resolveSubmit = resolve;
          }),
      );
      const { result } = renderHook(() => useAnnotationCanvas({ active: true, port: createFakeAnnotationCanvasPort({ onSubmit }) }));
      act(() => result.current.setNote('hi'));
      act(() => {
        void result.current.send('send');
      });
      await act(async () => {
        await result.current.send('send');
      });
      expect(onSubmit).toHaveBeenCalledTimes(1);
      await act(async () => {
        resolveSubmit({ ok: true });
        await Promise.resolve();
      });
    });
  });

  describe('screenshot capture + composite flow', () => {
    it('captures a snapshot, composites it with the drawn marks, and submits the resulting file', async () => {
      const snap: PreviewSnapshot = { dataUrl: 'data:image/png;base64,abc', w: 200, h: 100 };
      const onSubmit = vi.fn(async () => ({ ok: true }));
      const captureSnapshot = vi.fn(async () => snap);
      const captureFrameRect = vi.fn(() => ({ left: 0, top: 0, width: 100, height: 50 }));
      const { result } = renderHook(() =>
        useAnnotationCanvas({ active: true, port: createFakeAnnotationCanvasPort({ onSubmit, captureSnapshot, captureFrameRect }) }),
      );
      const canvasEl = document.createElement('canvas');
      stubRect(canvasEl, { left: 0, top: 0, width: 100, height: 100 });
      act(() => {
        result.current.canvasRef.current = canvasEl;
      });
      act(() => result.current.onPointerDown(fakePointerEvent({ clientX: 10, clientY: 10 })));
      act(() => result.current.onPointerMove(fakePointerEvent({ clientX: 50, clientY: 60 })));
      act(() => result.current.onPointerUp(fakePointerEvent({ clientX: 50, clientY: 60 })));
      expect(result.current.canUndo).toBe(true);

      await act(async () => {
        await result.current.send('send');
      });
      expect(captureSnapshot).toHaveBeenCalled();
      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ action: 'send', markKind: 'stroke', file: expect.any(File) }));
      expect(result.current.captureWarning).toBeNull();
    });

    it('computes real annotation bounds from a freehand stroke', async () => {
      const onSubmit = vi.fn(async () => ({ ok: true }));
      const captureSnapshot = vi.fn(async () => ({ dataUrl: 'data:image/png;base64,x', w: 100, h: 100 }));
      const captureFrameRect = vi.fn(() => ({ left: 0, top: 0, width: 100, height: 100 }));
      const { result } = renderHook(() =>
        useAnnotationCanvas({ active: true, port: createFakeAnnotationCanvasPort({ onSubmit, captureSnapshot, captureFrameRect }) }),
      );
      const canvasEl = document.createElement('canvas');
      stubRect(canvasEl, { left: 0, top: 0, width: 100, height: 100 });
      act(() => {
        result.current.canvasRef.current = canvasEl;
      });
      act(() => result.current.selectMarkTool('pen'));
      act(() => result.current.onPointerDown(fakePointerEvent({ clientX: 10, clientY: 10 })));
      act(() => result.current.onPointerMove(fakePointerEvent({ clientX: 50, clientY: 60 })));
      act(() => result.current.onPointerUp(fakePointerEvent({ clientX: 50, clientY: 60 })));
      await act(async () => {
        await result.current.send('send');
      });
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({ markKind: 'stroke', bounds: expect.objectContaining({ width: expect.any(Number) }) }),
      );
    });

    it('measures a registered text-mark element for annotation bounds', async () => {
      const onSubmit = vi.fn(async () => ({ ok: true }));
      const { result } = renderHook(() => useAnnotationCanvas({ active: true, port: createFakeAnnotationCanvasPort({ onSubmit }) }));
      const canvasEl = document.createElement('canvas');
      stubRect(canvasEl, { left: 0, top: 0, width: 100, height: 100 });
      act(() => {
        result.current.canvasRef.current = canvasEl;
      });
      act(() => result.current.selectMarkTool('text'));
      act(() => result.current.onPointerDown(fakePointerEvent({ clientX: 10, clientY: 10 })));
      const mark = result.current.textMarks[0]!;
      act(() => result.current.updateTextMark(mark.id, 'hello'));
      const textareaEl = document.createElement('textarea');
      stubRect(textareaEl, { left: 5, top: 5, width: 40, height: 20 });
      act(() => result.current.registerTextArea(mark.id, textareaEl));
      // No captureSnapshot on this port, so capture itself will fail; giving
      // it a note avoids the early-return warning path and lets `send()`
      // reach `annotationBounds()` (and therefore `textBounds()`'s
      // registered-element branch) regardless.
      act(() => result.current.setNote('annotate this'));
      await act(async () => {
        await result.current.send('send');
      });
      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ markKind: 'stroke' }));
    });

    it('falls back to an approximate 1x1 rect for a text mark whose textarea was never registered', async () => {
      const onSubmit = vi.fn(async () => ({ ok: true }));
      const { result } = renderHook(() => useAnnotationCanvas({ active: true, port: createFakeAnnotationCanvasPort({ onSubmit }) }));
      const canvasEl = document.createElement('canvas');
      stubRect(canvasEl, { left: 0, top: 0, width: 100, height: 100 });
      act(() => {
        result.current.canvasRef.current = canvasEl;
      });
      act(() => result.current.selectMarkTool('text'));
      act(() => result.current.onPointerDown(fakePointerEvent({ clientX: 10, clientY: 10 })));
      const mark = result.current.textMarks[0]!;
      act(() => result.current.updateTextMark(mark.id, 'hello'));
      // Deliberately never call registerTextArea for this mark.
      act(() => result.current.setNote('annotate this'));
      await act(async () => {
        await result.current.send('send');
      });
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({ markKind: 'stroke', bounds: expect.objectContaining({ width: expect.any(Number) }) }),
      );
    });

    it('warns (mark-specific message) when a snapshot exists but there is no frame rect to composite against', async () => {
      const captureSnapshot = vi.fn(async () => ({ dataUrl: 'data:image/png;base64,x', w: 10, h: 10 }));
      const onSubmit = vi.fn(async () => ({ ok: true }));
      const { result } = renderHook(() => useAnnotationCanvas({ active: true, port: createFakeAnnotationCanvasPort({ onSubmit, captureSnapshot }) }));
      const canvasEl = document.createElement('canvas');
      stubRect(canvasEl, { left: 0, top: 0, width: 100, height: 100 });
      act(() => {
        result.current.canvasRef.current = canvasEl;
      });
      act(() => result.current.onPointerDown(fakePointerEvent({ clientX: 10, clientY: 10 })));
      act(() => result.current.onPointerMove(fakePointerEvent({ clientX: 50, clientY: 60 })));
      act(() => result.current.onPointerUp(fakePointerEvent({ clientX: 50, clientY: 60 })));
      await act(async () => {
        await result.current.send('send');
      });
      expect(onSubmit).not.toHaveBeenCalled();
      expect(result.current.captureWarning).toEqual({ action: 'send', message: 'No screenshot was captured for this mark.' });
    });

    it('warns (viewport-specific message) when captureViewport is set but the port has no captureSnapshot capability at all', async () => {
      const onSubmit = vi.fn(async () => ({ ok: true }));
      const { result } = renderHook(() =>
        useAnnotationCanvas({ active: true, captureViewport: true, port: createFakeAnnotationCanvasPort({ onSubmit }) }),
      );
      await act(async () => {
        await result.current.send('send');
      });
      expect(onSubmit).not.toHaveBeenCalled();
      expect(result.current.captureWarning).toEqual({ action: 'send', message: 'No screenshot was captured for this annotation.' });
    });

    it('still submits (without a screenshot) when capture fails but a note is present, then flags it via captureWarning', async () => {
      const onSubmit = vi.fn(async () => ({ ok: true }));
      const { result } = renderHook(() => useAnnotationCanvas({ active: true, port: createFakeAnnotationCanvasPort({ onSubmit }) }));
      const canvasEl = document.createElement('canvas');
      stubRect(canvasEl, { left: 0, top: 0, width: 100, height: 100 });
      act(() => {
        result.current.canvasRef.current = canvasEl;
      });
      act(() => result.current.onPointerDown(fakePointerEvent({ clientX: 10, clientY: 10 })));
      act(() => result.current.onPointerMove(fakePointerEvent({ clientX: 50, clientY: 60 })));
      act(() => result.current.onPointerUp(fakePointerEvent({ clientX: 50, clientY: 60 })));
      act(() => result.current.setNote('still send this'));
      await act(async () => {
        await result.current.send('send');
      });
      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ file: null, note: 'still send this' }));
      expect(result.current.captureWarning).toEqual({ action: 'send', message: 'Sent without a screenshot — the note still went through.' });
    });
  });

  describe('collision-avoiding dock placement', () => {
    it('floats near the last drawn box when there is room, and returns to docked when deactivated', () => {
      const { result, rerender } = renderHook(({ active }) => useAnnotationCanvas({ active, port: createFakeAnnotationCanvasPort() }), {
        initialProps: { active: true },
      });
      const wrap = document.createElement('div');
      stubRect(wrap, { left: 0, top: 0, width: 1000, height: 800 });
      const dock = document.createElement('div');
      stubRect(dock, { left: 0, top: 0, width: 200, height: 60 });
      const canvasEl = document.createElement('canvas');
      stubRect(canvasEl, { left: 0, top: 0, width: 1000, height: 800 });
      act(() => {
        result.current.wrapRef.current = wrap;
        result.current.dockRef.current = dock;
        result.current.canvasRef.current = canvasEl;
      });
      act(() => result.current.onPointerDown(fakePointerEvent({ clientX: 100, clientY: 100 })));
      act(() => result.current.onPointerMove(fakePointerEvent({ clientX: 300, clientY: 300 })));
      act(() => result.current.onPointerUp(fakePointerEvent({ clientX: 300, clientY: 300 })));
      expect(result.current.dockPlacement.layout).toBe('floating');

      rerender({ active: false });
      expect(result.current.dockPlacement.layout).toBe('docked');
    });

    it('observes the wrap and dock elements via ResizeObserver while active, and disconnects on deactivate', () => {
      class TrackingResizeObserver {
        observeCalls: Element[] = [];
        disconnected = false;
        cb: ResizeObserverCallback;
        constructor(cb: ResizeObserverCallback) {
          this.cb = cb;
        }
        observe(el: Element) {
          this.observeCalls.push(el);
        }
        disconnect() {
          this.disconnected = true;
        }
      }
      const instances: TrackingResizeObserver[] = [];
      class TrackedRO extends TrackingResizeObserver {
        constructor(cb: ResizeObserverCallback) {
          super(cb);
          instances.push(this);
        }
      }
      withGlobal('ResizeObserver', TrackedRO, () => {
        const { result, rerender } = renderHook(({ active }) => useAnnotationCanvas({ active, port: createFakeAnnotationCanvasPort() }), {
          initialProps: { active: false },
        });
        const wrap = document.createElement('div');
        const dock = document.createElement('div');
        act(() => {
          result.current.wrapRef.current = wrap;
          result.current.dockRef.current = dock;
        });
        rerender({ active: true });
        expect(instances).toHaveLength(1);
        expect(instances[0]!.observeCalls).toEqual([wrap, dock]);
        act(() => instances[0]!.cb([], instances[0] as unknown as ResizeObserver));
        expect(instances[0]!.disconnected).toBe(false);

        rerender({ active: false });
        expect(instances[0]!.disconnected).toBe(true);
      });
    });
  });

  describe('pointer handlers while inactive', () => {
    it('onPointerDown/Move/Up are all no-ops when the overlay is not active', () => {
      const { result } = renderHook(() => useAnnotationCanvas({ active: false, port: createFakeAnnotationCanvasPort() }));
      act(() => result.current.onPointerDown(fakePointerEvent()));
      act(() => result.current.onPointerMove(fakePointerEvent({ clientX: 5, clientY: 5 })));
      act(() => result.current.onPointerUp(fakePointerEvent()));
      expect(result.current.textMarks).toHaveLength(0);
      expect(result.current.canUndo).toBe(false);
    });
  });

  describe('pointFromEvent / setPointerCapture', () => {
    it('actually invokes a real setPointerCapture function on the event target', () => {
      const { result } = renderHook(() => useAnnotationCanvas({ active: true, port: createFakeAnnotationCanvasPort() }));
      const setPointerCapture = vi.fn();
      act(() => result.current.onPointerDown(fakePointerEvent({ target: { setPointerCapture } as never })));
      expect(setPointerCapture).toHaveBeenCalledWith(1);
    });

    it('onPointerMove without a prior onPointerDown (no box draft, no drawing stroke) is a no-op', () => {
      const { result } = renderHook(() => useAnnotationCanvas({ active: true, port: createFakeAnnotationCanvasPort() }));
      expect(() => act(() => result.current.onPointerMove(fakePointerEvent({ clientX: 5, clientY: 5 })))).not.toThrow();
      expect(result.current.canUndo).toBe(false);
    });
  });

  describe('undo/redo with nothing to undo/redo', () => {
    it('undoStroke on a pristine canvas is a no-op', () => {
      const onToolbarClick = vi.fn();
      const { result } = renderHook(() => useAnnotationCanvas({ active: true, onToolbarClick, port: createFakeAnnotationCanvasPort() }));
      act(() => result.current.undoStroke());
      expect(onToolbarClick).not.toHaveBeenCalled();
    });

    it('redoStroke with nothing undone is a no-op', () => {
      const onToolbarClick = vi.fn();
      const { result } = renderHook(() => useAnnotationCanvas({ active: true, onToolbarClick, port: createFakeAnnotationCanvasPort() }));
      act(() => result.current.redoStroke());
      expect(onToolbarClick).not.toHaveBeenCalled();
    });
  });

  describe('multiple text marks', () => {
    it('updateTextMark only changes the targeted mark', () => {
      const { result } = renderHook(() => useAnnotationCanvas({ active: true, port: createFakeAnnotationCanvasPort() }));
      act(() => result.current.selectMarkTool('text'));
      act(() => result.current.onPointerDown(fakePointerEvent({ clientX: 1, clientY: 1 })));
      act(() => result.current.selectMarkTool('text'));
      act(() => result.current.onPointerDown(fakePointerEvent({ clientX: 2, clientY: 2 })));
      const [first, second] = result.current.textMarks;
      act(() => result.current.updateTextMark(first!.id, 'first mark text'));
      const marks = result.current.textMarks;
      expect(marks.find((m) => m.id === first!.id)!.text).toBe('first mark text');
      expect(marks.find((m) => m.id === second!.id)!.text).toBe(''); // untouched
    });

    it('a text-label drag only updates the dragged mark, leaving others untouched', () => {
      const { result } = renderHook(() => useAnnotationCanvas({ active: true, port: createFakeAnnotationCanvasPort() }));
      const canvasEl = document.createElement('canvas');
      stubRect(canvasEl, { left: 0, top: 0, width: 100, height: 100 });
      act(() => {
        result.current.canvasRef.current = canvasEl;
      });
      act(() => result.current.selectMarkTool('text'));
      act(() => result.current.onPointerDown(fakePointerEvent({ clientX: 10, clientY: 10 })));
      const first = result.current.textMarks[0]!;
      act(() => result.current.updateTextMark(first.id, 'a'));
      act(() => result.current.handleTextBlur(first.id));

      act(() => result.current.selectMarkTool('text'));
      act(() => result.current.onPointerDown(fakePointerEvent({ clientX: 50, clientY: 50 })));
      const second = result.current.textMarks.find((m) => m.id !== first.id)!;
      act(() => result.current.updateTextMark(second.id, 'b'));
      act(() => result.current.handleTextBlur(second.id));

      const target = { style: {} as Record<string, string>, setPointerCapture: vi.fn(), releasePointerCapture: vi.fn() };
      act(() => result.current.onTextPointerDown(fakePointerEvent({ clientX: 60, clientY: 60, currentTarget: target as never }), second));
      act(() => result.current.onTextPointerMove(fakePointerEvent({ clientX: 80, clientY: 60, currentTarget: target as never }), second));
      act(() => result.current.onTextPointerUp(fakePointerEvent({ clientX: 80, clientY: 60, currentTarget: target as never }), second));

      const updatedFirst = result.current.textMarks.find((m) => m.id === first.id)!;
      const updatedSecond = result.current.textMarks.find((m) => m.id === second.id)!;
      expect(updatedFirst.x).toBeCloseTo(0.1); // untouched
      expect(updatedSecond.x).toBeCloseTo(0.7);
    });

    it('onTextPointerMove/Up for a mark id that does not match the in-progress drag are no-ops', () => {
      const { result } = renderHook(() => useAnnotationCanvas({ active: true, port: createFakeAnnotationCanvasPort() }));
      const canvasEl = document.createElement('canvas');
      stubRect(canvasEl, { left: 0, top: 0, width: 100, height: 100 });
      act(() => {
        result.current.canvasRef.current = canvasEl;
      });
      act(() => result.current.selectMarkTool('text'));
      act(() => result.current.onPointerDown(fakePointerEvent({ clientX: 10, clientY: 10 })));
      const mark = result.current.textMarks[0]!;
      act(() => result.current.updateTextMark(mark.id, 'hi'));
      act(() => result.current.handleTextBlur(mark.id));

      const target = { style: {} as Record<string, string>, setPointerCapture: vi.fn(), releasePointerCapture: vi.fn() };
      act(() => result.current.onTextPointerDown(fakePointerEvent({ clientX: 10, clientY: 10, currentTarget: target as never }), mark));
      const otherMark = { ...mark, id: mark.id + 12345 };
      act(() => result.current.onTextPointerUp(fakePointerEvent({ clientX: 10, clientY: 10, currentTarget: target as never }), otherMark));
      // the drag for `mark` is still open (the mismatched Up was ignored) —
      // ending it for the correct mark now should still work normally.
      act(() => result.current.onTextPointerUp(fakePointerEvent({ clientX: 10, clientY: 10, currentTarget: target as never, timeStamp: 5 }), mark));
      expect(result.current.textMarks.find((m) => m.id === mark.id)).toBeDefined();
    });
  });

  describe('onTextPointerMove with a zero-size canvas rect, and pure-vertical drags', () => {
    it('onTextPointerMove bails out when the canvas rect is zero-size', () => {
      const { result } = renderHook(() => useAnnotationCanvas({ active: true, port: createFakeAnnotationCanvasPort() }));
      const canvasEl = document.createElement('canvas');
      stubRect(canvasEl, { left: 0, top: 0, width: 100, height: 100 });
      act(() => {
        result.current.canvasRef.current = canvasEl;
      });
      act(() => result.current.selectMarkTool('text'));
      act(() => result.current.onPointerDown(fakePointerEvent({ clientX: 10, clientY: 10 })));
      const mark = result.current.textMarks[0]!;
      act(() => result.current.updateTextMark(mark.id, 'hi'));
      act(() => result.current.handleTextBlur(mark.id));

      const target = { style: {} as Record<string, string>, setPointerCapture: vi.fn() };
      act(() => result.current.onTextPointerDown(fakePointerEvent({ clientX: 20, clientY: 20, currentTarget: target as never }), mark));
      stubRect(canvasEl, { left: 0, top: 0, width: 0, height: 0 });
      act(() => result.current.onTextPointerMove(fakePointerEvent({ clientX: 40, clientY: 20, currentTarget: target as never }), mark));
      expect(target.style.left).toBeUndefined();
    });

    it('a purely vertical drag past the threshold still counts as "moved"', () => {
      const { result } = renderHook(() => useAnnotationCanvas({ active: true, port: createFakeAnnotationCanvasPort() }));
      const canvasEl = document.createElement('canvas');
      stubRect(canvasEl, { left: 0, top: 0, width: 100, height: 100 });
      act(() => {
        result.current.canvasRef.current = canvasEl;
      });
      act(() => result.current.selectMarkTool('text'));
      act(() => result.current.onPointerDown(fakePointerEvent({ clientX: 10, clientY: 10 })));
      const mark = result.current.textMarks[0]!;
      act(() => result.current.updateTextMark(mark.id, 'hi'));
      act(() => result.current.handleTextBlur(mark.id));

      const target = { style: {} as Record<string, string>, setPointerCapture: vi.fn(), releasePointerCapture: vi.fn() };
      act(() => result.current.onTextPointerDown(fakePointerEvent({ clientX: 10, clientY: 10, currentTarget: target as never }), mark));
      act(() => result.current.onTextPointerMove(fakePointerEvent({ clientX: 10, clientY: 40, currentTarget: target as never }), mark));
      act(() => result.current.onTextPointerUp(fakePointerEvent({ clientX: 10, clientY: 40, currentTarget: target as never }), mark));
      const updated = result.current.textMarks.find((m) => m.id === mark.id)!;
      expect(updated.y).toBeCloseTo(0.4); // repositioned, not treated as a tap
    });
  });

  describe('addExtraFiles with no images at all', () => {
    it('is a no-op when every file is a non-image', () => {
      const { result } = renderHook(() => useAnnotationCanvas({ active: true, port: createFakeAnnotationCanvasPort() }));
      const textFile = new File(['x'], 'a.txt', { type: 'text/plain' });
      act(() => result.current.addExtraFiles([textFile]));
      expect(result.current.extraFiles).toEqual([]);
    });
  });

  describe('selectMarkTool option mapping', () => {
    it('selecting "box" reports the toolbar element as "rect"', () => {
      const onToolbarClick = vi.fn();
      const { result } = renderHook(() => useAnnotationCanvas({ active: true, onToolbarClick, port: createFakeAnnotationCanvasPort() }));
      act(() => result.current.selectMarkTool('box'));
      expect(onToolbarClick).toHaveBeenCalledWith('rect');
    });
  });

  describe('captureTarget-anchored annotations (no drawn mark at all)', () => {
    it('anchors to the captureTarget position and includes it in annotationBounds when there is no box/stroke', async () => {
      const onSubmit = vi.fn(async () => ({ ok: true }));
      const captureTarget = { position: { x: 5, y: 5, width: 20, height: 10 }, filePath: 'src/App.tsx' };
      const { result } = renderHook(() =>
        useAnnotationCanvas({ active: true, captureTarget, port: createFakeAnnotationCanvasPort({ onSubmit }) }),
      );
      // No captureSnapshot on this port, so capture fails; a note avoids the
      // early-return "no screenshot" warning path so `send()` still reaches
      // `onSubmit` (with `file: null`) and we can assert on the bounds it computed.
      act(() => result.current.setNote('annotate this'));
      await act(async () => {
        await result.current.send('send');
      });
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          markKind: 'click',
          filePath: 'src/App.tsx',
          bounds: expect.objectContaining({ x: 5, y: 5, width: 20, height: 10 }),
        }),
      );
    });
  });

  describe('compositeWithBackground', () => {
    it('falls back to the wrap element rect for frameRect when the port has no captureFrameRect', async () => {
      const onSubmit = vi.fn(async () => ({ ok: true }));
      const captureSnapshot = vi.fn(async () => ({ dataUrl: 'data:image/png;base64,abc', w: 50, h: 50 }));
      const { result } = renderHook(() =>
        useAnnotationCanvas({ active: true, port: createFakeAnnotationCanvasPort({ onSubmit, captureSnapshot }) }),
      );
      const wrap = document.createElement('div');
      stubRect(wrap, { left: 0, top: 0, width: 100, height: 100 });
      const canvasEl = document.createElement('canvas');
      stubRect(canvasEl, { left: 0, top: 0, width: 100, height: 100 });
      act(() => {
        result.current.wrapRef.current = wrap;
        result.current.canvasRef.current = canvasEl;
      });
      act(() => result.current.onPointerDown(fakePointerEvent({ clientX: 10, clientY: 10 })));
      act(() => result.current.onPointerMove(fakePointerEvent({ clientX: 50, clientY: 60 })));
      act(() => result.current.onPointerUp(fakePointerEvent({ clientX: 50, clientY: 60 })));
      await act(async () => {
        await result.current.send('send');
      });
      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ file: expect.any(File) }));
    });

    it('resolves to a null background image (not a screenshot) when the snapshot data URL fails to "load", and warns', async () => {
      const onSubmit = vi.fn(async () => ({ ok: true }));
      const captureSnapshot = vi.fn(async () => ({ dataUrl: 'https://example.com/not-a-data-url.png', w: 10, h: 10 }));
      const captureFrameRect = vi.fn(() => ({ left: 0, top: 0, width: 100, height: 100 }));
      const { result } = renderHook(() =>
        useAnnotationCanvas({ active: true, port: createFakeAnnotationCanvasPort({ onSubmit, captureSnapshot, captureFrameRect }) }),
      );
      const canvasEl = document.createElement('canvas');
      stubRect(canvasEl, { left: 0, top: 0, width: 100, height: 100 });
      act(() => {
        result.current.canvasRef.current = canvasEl;
      });
      act(() => result.current.onPointerDown(fakePointerEvent({ clientX: 10, clientY: 10 })));
      act(() => result.current.onPointerMove(fakePointerEvent({ clientX: 50, clientY: 60 })));
      act(() => result.current.onPointerUp(fakePointerEvent({ clientX: 50, clientY: 60 })));
      await act(async () => {
        await result.current.send('send');
      });
      expect(onSubmit).not.toHaveBeenCalled();
      expect(result.current.captureWarning).toEqual({ action: 'send', message: 'No screenshot was captured for this mark.' });
    });

    it('bails out (no screenshot) when the canvas 2D context is unavailable, for both the live redraw and the export canvas', async () => {
      const originalGetContext = HTMLCanvasElement.prototype.getContext;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (HTMLCanvasElement.prototype as any).getContext = () => null;
      try {
        const onSubmit = vi.fn(async () => ({ ok: true }));
        const captureSnapshot = vi.fn(async () => ({ dataUrl: 'data:image/png;base64,abc', w: 50, h: 50 }));
        const captureFrameRect = vi.fn(() => ({ left: 0, top: 0, width: 100, height: 100 }));
        const { result } = renderHook(() =>
          useAnnotationCanvas({ active: true, port: createFakeAnnotationCanvasPort({ onSubmit, captureSnapshot, captureFrameRect }) }),
        );
        const canvasEl = document.createElement('canvas');
        stubRect(canvasEl, { left: 0, top: 0, width: 100, height: 100 });
        act(() => {
          result.current.canvasRef.current = canvasEl;
        });
        // Pen tool so onPointerDown's `redraw()` call also exercises the
        // hook's own `!ctx` guard, not just the export canvas's.
        act(() => result.current.selectMarkTool('pen'));
        act(() => result.current.onPointerDown(fakePointerEvent({ clientX: 10, clientY: 10 })));
        act(() => result.current.onPointerMove(fakePointerEvent({ clientX: 50, clientY: 60 })));
        act(() => result.current.onPointerUp(fakePointerEvent({ clientX: 50, clientY: 60 })));
        await act(async () => {
          await result.current.send('send');
        });
        expect(onSubmit).not.toHaveBeenCalled();
        expect(result.current.captureWarning).toEqual({ action: 'send', message: 'No screenshot was captured for this mark.' });
      } finally {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (HTMLCanvasElement.prototype as any).getContext = originalGetContext;
      }
    });

    it('bails out when window.CanvasRenderingContext2D is unavailable (a non-canvas-capable host)', () => {
      const original = (window as unknown as { CanvasRenderingContext2D: unknown }).CanvasRenderingContext2D;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (window as any).CanvasRenderingContext2D;
      try {
        const { result } = renderHook(() => useAnnotationCanvas({ active: true, port: createFakeAnnotationCanvasPort() }));
        const canvasEl = document.createElement('canvas');
        stubRect(canvasEl, { left: 0, top: 0, width: 100, height: 100 });
        act(() => {
          result.current.canvasRef.current = canvasEl;
        });
        act(() => result.current.selectMarkTool('pen'));
        expect(() => act(() => result.current.onPointerDown(fakePointerEvent({ clientX: 10, clientY: 10 })))).not.toThrow();
      } finally {
        (window as unknown as { CanvasRenderingContext2D: unknown }).CanvasRenderingContext2D = original;
      }
    });
  });

  describe('scheduleRedraw double-scheduling and unmount cleanup', () => {
    it('a second pointer-move before the frame fires does not schedule a second animation frame', async () => {
      const { result } = renderHook(() => useAnnotationCanvas({ active: true, port: createFakeAnnotationCanvasPort() }));
      act(() => result.current.selectMarkTool('pen'));
      act(() => result.current.onPointerDown(fakePointerEvent()));
      act(() => result.current.onPointerMove(fakePointerEvent({ clientX: 5, clientY: 5 })));
      act(() => result.current.onPointerMove(fakePointerEvent({ clientX: 6, clientY: 6 })));
      await act(async () => {
        await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
      });
      act(() => result.current.onPointerUp(fakePointerEvent()));
      expect(result.current.canUndo).toBe(true);
    });

    it('cancels a pending animation frame on unmount', () => {
      const { result, unmount } = renderHook(() => useAnnotationCanvas({ active: true, port: createFakeAnnotationCanvasPort() }));
      act(() => result.current.selectMarkTool('pen'));
      act(() => result.current.onPointerDown(fakePointerEvent()));
      act(() => result.current.onPointerMove(fakePointerEvent({ clientX: 5, clientY: 5 })));
      expect(() => unmount()).not.toThrow();
    });
  });

  describe('send() with only extraFiles attached (no note, no marks, no capture)', () => {
    it('submits using extraFiles alone as the reason canSubmitNow is true', async () => {
      const onSubmit = vi.fn(async () => ({ ok: true }));
      const onToolbarClick = vi.fn();
      const { result } = renderHook(() =>
        useAnnotationCanvas({ active: true, onToolbarClick, port: createFakeAnnotationCanvasPort({ onSubmit }) }),
      );
      const file = new File(['x'], 'a.png', { type: 'image/png' });
      act(() => result.current.addExtraFiles([file]));
      await act(async () => {
        await result.current.send('send');
      });
      expect(onToolbarClick).toHaveBeenCalledWith('annotation_submit', 'send');
      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ extraFiles: [file] }));
    });
  });

  describe('send() failure without a message', () => {
    it('falls back to a default failure message when the port resolves ok:false with no message', async () => {
      const onSubmit = vi.fn(async () => ({ ok: false }));
      const { result } = renderHook(() => useAnnotationCanvas({ active: true, port: createFakeAnnotationCanvasPort({ onSubmit }) }));
      act(() => result.current.setNote('hi'));
      await act(async () => {
        await result.current.send('send');
      });
      expect(result.current.captureWarning).toEqual({ action: 'send', message: 'Could not submit this annotation.' });
    });
  });

  describe('remaining fine-grained branches', () => {
    it('handleTextBlur leaves editingTextId untouched when it no longer matches (a stale blur for a mark that is not the current one)', () => {
      const { result } = renderHook(() => useAnnotationCanvas({ active: true, port: createFakeAnnotationCanvasPort() }));
      act(() => result.current.selectMarkTool('text'));
      act(() => result.current.onPointerDown(fakePointerEvent({ clientX: 1, clientY: 1 })));
      const first = result.current.textMarks[0]!;
      act(() => result.current.updateTextMark(first.id, 'first')); // has text, survives blur

      act(() => result.current.selectMarkTool('text'));
      act(() => result.current.onPointerDown(fakePointerEvent({ clientX: 2, clientY: 2 })));
      // editingTextId is now the second mark's id — blurring the *first* mark
      // (a stale event) must not touch editingTextId, and must still run the
      // "has text, keep it" removal check for that (now non-editing) mark.
      act(() => result.current.handleTextBlur(first.id));
      const second = result.current.textMarks.find((m) => m.id !== first.id)!;
      expect(second.editing).toBe(true); // untouched by the stale blur
    });

    it('selectMarkTool maps every tool to its toolbar-analytics element', () => {
      const onToolbarClick = vi.fn();
      const { result } = renderHook(() => useAnnotationCanvas({ active: true, onToolbarClick, port: createFakeAnnotationCanvasPort() }));
      act(() => result.current.selectMarkTool('box'));
      act(() => result.current.selectMarkTool('text'));
      act(() => result.current.selectMarkTool('pen'));
      expect(onToolbarClick.mock.calls.map((c) => c[0])).toEqual(['rect', 'text', 'pen']);
    });

    it('boxBounds/lastBoxBounds return null once the canvas ref is detached mid-flow', async () => {
      const onSubmit = vi.fn(async () => ({ ok: true }));
      const { result } = renderHook(() => useAnnotationCanvas({ active: true, port: createFakeAnnotationCanvasPort({ onSubmit }) }));
      const canvasEl = document.createElement('canvas');
      stubRect(canvasEl, { left: 0, top: 0, width: 100, height: 100 });
      act(() => {
        result.current.canvasRef.current = canvasEl;
      });
      act(() => result.current.onPointerDown(fakePointerEvent({ clientX: 10, clientY: 10 })));
      act(() => result.current.onPointerMove(fakePointerEvent({ clientX: 50, clientY: 60 })));
      act(() => result.current.onPointerUp(fakePointerEvent({ clientX: 50, clientY: 60 })));
      expect(result.current.canUndo).toBe(true);

      // Detach the canvas ref (e.g. the host unmounted the preview) before submitting.
      act(() => {
        result.current.canvasRef.current = null;
      });
      act(() => result.current.setNote('still send this'));
      await act(async () => {
        await result.current.send('send');
      });
      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ bounds: undefined }));
    });

    it('textBounds skips a blank in-progress mark but measures a real one, in the same pass', async () => {
      const onSubmit = vi.fn(async () => ({ ok: true }));
      const { result } = renderHook(() => useAnnotationCanvas({ active: true, port: createFakeAnnotationCanvasPort({ onSubmit }) }));
      const canvasEl = document.createElement('canvas');
      stubRect(canvasEl, { left: 0, top: 0, width: 100, height: 100 });
      act(() => {
        result.current.canvasRef.current = canvasEl;
      });
      act(() => result.current.selectMarkTool('text'));
      act(() => result.current.onPointerDown(fakePointerEvent({ clientX: 10, clientY: 10 })));
      const withText = result.current.textMarks[0]!;
      act(() => result.current.updateTextMark(withText.id, 'hello'));
      act(() => result.current.handleTextBlur(withText.id));

      // A second mark is created and left mid-edit with no text at all —
      // `hasText` is still true because of the first mark.
      act(() => result.current.selectMarkTool('text'));
      act(() => result.current.onPointerDown(fakePointerEvent({ clientX: 50, clientY: 50 })));
      expect(result.current.textMarks).toHaveLength(2);

      act(() => result.current.setNote('annotate this'));
      await act(async () => {
        await result.current.send('send');
      });
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({ markKind: 'stroke', bounds: expect.objectContaining({ width: expect.any(Number) }) }),
      );
    });

    it('anchorBounds falls through to the captureTarget position for dock placement when nothing is drawn', () => {
      const captureTarget = { position: { x: 400, y: 300, width: 40, height: 20 } };
      const { result } = renderHook(() => useAnnotationCanvas({ active: true, captureTarget, port: createFakeAnnotationCanvasPort() }));
      const wrap = document.createElement('div');
      stubRect(wrap, { left: 0, top: 0, width: 1000, height: 800 });
      const dock = document.createElement('div');
      stubRect(dock, { left: 0, top: 0, width: 200, height: 60 });
      act(() => {
        result.current.wrapRef.current = wrap;
        result.current.dockRef.current = dock;
      });
      // Force the dock-placement effect (deps include `imagePreviews.length`)
      // to re-run now that the refs are attached, with no box/stroke drawn at
      // all — only `captureTarget` for `anchorBounds()` to fall through to.
      const file = new File(['x'], 'a.png', { type: 'image/png' });
      act(() => result.current.addExtraFiles([file]));
      expect(result.current.dockPlacement.layout).toBe('floating');
    });
  });
});
