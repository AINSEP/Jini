import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { usePreviewModalShell } from './usePreviewModalShell.js';

const views = [
  { id: 'a', label: 'A' },
  { id: 'b', label: 'B' },
];

afterEach(() => {
  document.body.style.overflow = '';
});

describe('usePreviewModalShell — initial state', () => {
  it('resolves the initial active id from initialViewId', () => {
    const { result } = renderHook(() => usePreviewModalShell({ views, initialViewId: 'b', onClose: vi.fn() }));
    expect(result.current.activeId).toBe('b');
    expect(result.current.activeView).toEqual({ id: 'b', label: 'B' });
  });

  it('falls back to the first view when initialViewId is invalid', () => {
    const { result } = renderHook(() => usePreviewModalShell({ views, initialViewId: 'nope', onClose: vi.fn() }));
    expect(result.current.activeId).toBe('a');
  });

  it('starts closed/not-fullscreen with the sidebar default', () => {
    const { result } = renderHook(() =>
      usePreviewModalShell({ views, onClose: vi.fn(), sidebarDefaultOpen: true }),
    );
    expect(result.current.fullscreen).toBe(false);
    expect(result.current.primaryMenuOpen).toBe(false);
    expect(result.current.sidebarOpen).toBe(true);
    expect(result.current.stageSize).toEqual({ w: 0, h: 0 });
  });
});

describe('usePreviewModalShell — onView', () => {
  it('fires onView on mount with the initial active id', () => {
    const onView = vi.fn();
    renderHook(() => usePreviewModalShell({ views, initialViewId: 'b', onClose: vi.fn(), onView }));
    expect(onView).toHaveBeenCalledWith('b');
  });

  it('fires onView again whenever the active id changes', () => {
    const onView = vi.fn();
    const { result } = renderHook(() => usePreviewModalShell({ views, onClose: vi.fn(), onView }));
    onView.mockClear();
    act(() => result.current.setActiveId('b'));
    expect(onView).toHaveBeenCalledWith('b');
  });
});

describe('usePreviewModalShell — sidebar toggle notification', () => {
  it('fires sidebarOnToggle on mount and whenever sidebarOpen or sidebarContentKey changes', () => {
    const sidebarOnToggle = vi.fn();
    const { result, rerender } = renderHook(
      ({ contentKey }) => usePreviewModalShell({ views, onClose: vi.fn(), sidebarOnToggle, sidebarContentKey: contentKey }),
      { initialProps: { contentKey: 'k1' as string | number } },
    );
    expect(sidebarOnToggle).toHaveBeenCalledWith(false);
    sidebarOnToggle.mockClear();

    act(() => result.current.setSidebarOpen(true));
    expect(sidebarOnToggle).toHaveBeenCalledWith(true);
    sidebarOnToggle.mockClear();

    rerender({ contentKey: 'k2' });
    expect(sidebarOnToggle).toHaveBeenCalledWith(true);
  });

  it('does not throw when sidebarOnToggle is omitted', () => {
    const { result } = renderHook(() => usePreviewModalShell({ views, onClose: vi.fn() }));
    expect(() => act(() => result.current.setSidebarOpen(true))).not.toThrow();
  });

  it('picks up a changed sidebarOnToggle identity via the latest-ref without re-firing on every render', () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = renderHook(
      ({ cb }) => usePreviewModalShell({ views, onClose: vi.fn(), sidebarOnToggle: cb }),
      { initialProps: { cb: first } },
    );
    expect(first).toHaveBeenCalledTimes(1);
    rerender({ cb: second });
    // sidebarOpen/sidebarContentKey didn't change, so the effect doesn't re-fire.
    expect(second).not.toHaveBeenCalled();
  });
});

describe('usePreviewModalShell — Escape key handling', () => {
  it('calls onClose on Escape when not fullscreen', () => {
    const onClose = vi.fn();
    renderHook(() => usePreviewModalShell({ views, onClose }));
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('exits fullscreen on Escape instead of closing, when fullscreen', () => {
    const onClose = vi.fn();
    const { result } = renderHook(() => usePreviewModalShell({ views, onClose }));
    // No real element behind stageRef -> enterFullscreen falls through to the plain setState branch.
    act(() => result.current.enterFullscreen());
    expect(result.current.fullscreen).toBe(true);

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(result.current.fullscreen).toBe(false);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('ignores non-Escape keys', () => {
    const onClose = vi.fn();
    renderHook(() => usePreviewModalShell({ views, onClose }));
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    });
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('usePreviewModalShell — fullscreen', () => {
  it('enterFullscreen sets fullscreen synchronously when the stage has no requestFullscreen', () => {
    const { result } = renderHook(() => usePreviewModalShell({ views, onClose: vi.fn() }));
    act(() => result.current.enterFullscreen());
    expect(result.current.fullscreen).toBe(true);
  });

  it('exitFullscreen clears fullscreen even with no document.exitFullscreen available', () => {
    const { result } = renderHook(() => usePreviewModalShell({ views, onClose: vi.fn() }));
    act(() => result.current.enterFullscreen());
    act(() => result.current.exitFullscreen());
    expect(result.current.fullscreen).toBe(false);
  });

  it('exitFullscreen calls document.exitFullscreen when a fullscreenElement is active', async () => {
    const { result } = renderHook(() => usePreviewModalShell({ views, onClose: vi.fn() }));
    act(() => result.current.enterFullscreen());

    const exitFullscreen = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(document, 'fullscreenElement', { value: document.body, configurable: true });
    Object.defineProperty(document, 'exitFullscreen', { value: exitFullscreen, configurable: true });

    act(() => result.current.exitFullscreen());
    expect(exitFullscreen).toHaveBeenCalledTimes(1);
    expect(result.current.fullscreen).toBe(false);

    Object.defineProperty(document, 'fullscreenElement', { value: null, configurable: true });
    // @ts-expect-error -- test-only cleanup of a jsdom-unsupported API
    delete document.exitFullscreen;
  });

  it('mirrors a native fullscreenchange exit back into React state', () => {
    const { result } = renderHook(() => usePreviewModalShell({ views, onClose: vi.fn() }));
    act(() => result.current.enterFullscreen());
    expect(result.current.fullscreen).toBe(true);

    Object.defineProperty(document, 'fullscreenElement', { value: null, configurable: true });
    act(() => {
      document.dispatchEvent(new Event('fullscreenchange'));
    });
    expect(result.current.fullscreen).toBe(false);
  });

  it('does not clear fullscreen on fullscreenchange while a fullscreenElement is still active', () => {
    const { result } = renderHook(() => usePreviewModalShell({ views, onClose: vi.fn() }));
    act(() => result.current.enterFullscreen());
    Object.defineProperty(document, 'fullscreenElement', { value: document.body, configurable: true });
    act(() => {
      document.dispatchEvent(new Event('fullscreenchange'));
    });
    expect(result.current.fullscreen).toBe(true);
    Object.defineProperty(document, 'fullscreenElement', { value: null, configurable: true });
  });
});

describe('usePreviewModalShell — primary menu outside-click/Escape dismissal', () => {
  it('does not attach listeners while closed', () => {
    const addSpy = vi.spyOn(document, 'addEventListener');
    renderHook(() => usePreviewModalShell({ views, onClose: vi.fn() }));
    const mousedownCalls = addSpy.mock.calls.filter(([type]) => type === 'mousedown').length;
    expect(mousedownCalls).toBe(0);
    addSpy.mockRestore();
  });

  it('closes on an outside mousedown', () => {
    const { result } = renderHook(() => usePreviewModalShell({ views, onClose: vi.fn() }));
    act(() => result.current.setPrimaryMenuOpen(true));
    expect(result.current.primaryMenuOpen).toBe(true);

    act(() => {
      document.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });
    expect(result.current.primaryMenuOpen).toBe(false);
  });

  it('stays open on a click inside the menu ref element', () => {
    const { result } = renderHook(() => usePreviewModalShell({ views, onClose: vi.fn() }));
    const el = document.createElement('div');
    document.body.appendChild(el);
    result.current.primaryMenuRef.current = el;

    act(() => result.current.setPrimaryMenuOpen(true));
    act(() => {
      el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });
    expect(result.current.primaryMenuOpen).toBe(true);
    el.remove();
  });

  it('closes on Escape', () => {
    const { result } = renderHook(() => usePreviewModalShell({ views, onClose: vi.fn() }));
    act(() => result.current.setPrimaryMenuOpen(true));
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(result.current.primaryMenuOpen).toBe(false);
  });
});

describe('usePreviewModalShell — body scroll lock', () => {
  it('locks overflow while mounted and restores the prior value on unmount', () => {
    document.body.style.overflow = 'auto';
    const { unmount } = renderHook(() => usePreviewModalShell({ views, onClose: vi.fn() }));
    expect(document.body.style.overflow).toBe('hidden');
    unmount();
    expect(document.body.style.overflow).toBe('auto');
  });
});

describe('usePreviewModalShell — stage measurement without a mounted element', () => {
  it('leaves stageSize at {0,0} when stageFrameRef never attaches to a real element', () => {
    const { result } = renderHook(() => usePreviewModalShell({ views, onClose: vi.fn() }));
    expect(result.current.stageSize).toEqual({ w: 0, h: 0 });
    expect(result.current.scale).toBe(1);
  });
});
