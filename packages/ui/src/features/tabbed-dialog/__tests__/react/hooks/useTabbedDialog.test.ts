import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useTabbedDialog } from '../../../react/hooks/useTabbedDialog.js';

const tabs = [
  { id: 'a', label: 'A' },
  { id: 'b', label: 'B' },
];

describe('useTabbedDialog', () => {
  it('initializes activeTabId from initialActiveTabId, falling back to the first tab', () => {
    const { result: r1 } = renderHook(() => useTabbedDialog({ tabs, initialActiveTabId: 'b' }));
    expect(r1.current.activeTabId).toBe('b');

    const { result: r2 } = renderHook(() => useTabbedDialog({ tabs, initialActiveTabId: 'missing' }));
    expect(r2.current.activeTabId).toBe('a');
  });

  it('setActiveTabId updates uncontrolled state and fires onActiveTabIdChange', () => {
    const onActiveTabIdChange = vi.fn();
    const { result } = renderHook(() => useTabbedDialog({ tabs, onActiveTabIdChange }));
    act(() => result.current.setActiveTabId('b'));
    expect(result.current.activeTabId).toBe('b');
    expect(onActiveTabIdChange).toHaveBeenCalledWith('b');
  });

  it('respects a controlled activeTabId and does not mutate it internally', () => {
    const onActiveTabIdChange = vi.fn();
    const { result, rerender } = renderHook(
      ({ activeTabId }) => useTabbedDialog({ tabs, activeTabId, onActiveTabIdChange }),
      { initialProps: { activeTabId: 'a' } },
    );
    expect(result.current.activeTabId).toBe('a');
    act(() => result.current.setActiveTabId('b'));
    // Controlled: internal state does not change on its own.
    expect(result.current.activeTabId).toBe('a');
    expect(onActiveTabIdChange).toHaveBeenCalledWith('b');
    rerender({ activeTabId: 'b' });
    expect(result.current.activeTabId).toBe('b');
  });

  it('toggles sidebarCollapsed and fullscreen', () => {
    const { result } = renderHook(() => useTabbedDialog({ tabs }));
    expect(result.current.sidebarCollapsed).toBe(false);
    act(() => result.current.toggleSidebarCollapsed());
    expect(result.current.sidebarCollapsed).toBe(true);

    expect(result.current.fullscreen).toBe(false);
    act(() => result.current.toggleFullscreen());
    expect(result.current.fullscreen).toBe(true);
  });

  it('calls onClose on Escape when onClose is supplied', () => {
    const onClose = vi.fn();
    renderHook(() => useTabbedDialog({ tabs, onClose }));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not attach an Escape listener when onClose is omitted', () => {
    const addSpy = vi.spyOn(document, 'addEventListener');
    renderHook(() => useTabbedDialog({ tabs }));
    expect(addSpy).not.toHaveBeenCalledWith('keydown', expect.anything());
    addSpy.mockRestore();
  });

  it('ignores non-Escape keys', () => {
    const onClose = vi.fn();
    renderHook(() => useTabbedDialog({ tabs, onClose }));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(onClose).not.toHaveBeenCalled();
  });
});
