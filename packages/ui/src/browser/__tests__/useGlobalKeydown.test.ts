// @vitest-environment jsdom
import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { resolveGlobalKeydownTarget, useGlobalKeydown } from '../useGlobalKeydown.js';

describe('resolveGlobalKeydownTarget', () => {
  it('resolves "window" to globalThis.window and "document" to globalThis.document when present', () => {
    expect(resolveGlobalKeydownTarget({ target: 'window' })).toBe(window);
    expect(resolveGlobalKeydownTarget({ target: 'document' })).toBe(document);
  });

  it('resolves to undefined when the requested global is absent (SSR-style)', () => {
    // Driving this through a rendered `useGlobalKeydown` hook is not
    // possible: React DOM's own render/commit machinery dereferences
    // `window` before this hook's effect ever runs, so stubbing `window`
    // away breaks the render itself rather than reaching this branch. This
    // directly unit-tests the extracted resolver instead — see its own
    // doc comment in useGlobalKeydown.ts.
    vi.stubGlobal('window', undefined);
    try {
      expect(resolveGlobalKeydownTarget({ target: 'window' })).toBeUndefined();
    } finally {
      vi.unstubAllGlobals();
    }
    vi.stubGlobal('document', undefined);
    try {
      expect(resolveGlobalKeydownTarget({ target: 'document' })).toBeUndefined();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('useGlobalKeydown', () => {
  it('invokes the handler for a window keydown by default', () => {
    const handler = vi.fn();
    renderHook(() => useGlobalKeydown({ handler }));

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0]?.[0]).toBeInstanceOf(KeyboardEvent);
  });

  it('does not attach a listener while enabled is false, and does nothing on keydown', () => {
    const addSpy = vi.spyOn(window, 'addEventListener');
    const handler = vi.fn();

    renderHook(() => useGlobalKeydown({ handler }, { enabled: false }));

    expect(addSpy).not.toHaveBeenCalledWith('keydown', expect.any(Function), expect.anything());
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));
    expect(handler).not.toHaveBeenCalled();
    addSpy.mockRestore();
  });

  it('starts reacting once enabled flips from false to true, and stops when it flips back', () => {
    const handler = vi.fn();
    const { rerender } = renderHook(({ enabled }) => useGlobalKeydown({ handler }, { enabled }), {
      initialProps: { enabled: false },
    });

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));
    expect(handler).not.toHaveBeenCalled();

    rerender({ enabled: true });
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));
    expect(handler).toHaveBeenCalledTimes(1);

    rerender({ enabled: false });
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('listens on document instead of window when target is "document"', () => {
    const handler = vi.fn();
    renderHook(() => useGlobalKeydown({ handler }, { target: 'document' }));

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));
    expect(handler).not.toHaveBeenCalled();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('runs before a bubble-phase listener when capture is true', () => {
    const order: string[] = [];
    const child = document.createElement('div');
    document.body.append(child);
    child.addEventListener('keydown', () => order.push('bubble-phase-on-child'));

    renderHook(() => useGlobalKeydown({ handler: () => order.push('capture-phase-hook') }, { target: 'document', capture: true }));

    child.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));
    expect(order).toEqual(['capture-phase-hook', 'bubble-phase-on-child']);
  });

  it('removes the listener on unmount', () => {
    const handler = vi.fn();
    const { unmount } = renderHook(() => useGlobalKeydown({ handler }));
    unmount();

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));
    expect(handler).not.toHaveBeenCalled();
  });

  it('always calls the latest handler without requiring the caller to memoize it', () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = renderHook(({ handler }) => useGlobalKeydown({ handler }), {
      initialProps: { handler: first },
    });
    rerender({ handler: second });

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });
});
