import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SIDEBAR_RAIL_STORAGE_KEY, useSidebarRail } from '../../hooks/use-sidebar-rail.js';

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('useSidebarRail', () => {
  it('defaults to expanded on a first-run visitor', () => {
    const { result } = renderHook(() => useSidebarRail());
    expect(result.current.collapsed).toBe(false);
  });

  it('reads the persisted value on mount', () => {
    localStorage.setItem(DEFAULT_SIDEBAR_RAIL_STORAGE_KEY, '1');
    const { result } = renderHook(() => useSidebarRail());
    expect(result.current.collapsed).toBe(true);
  });

  it('persists on toggle', () => {
    const { result } = renderHook(() => useSidebarRail());
    act(() => result.current.toggle());
    expect(result.current.collapsed).toBe(true);
    expect(localStorage.getItem(DEFAULT_SIDEBAR_RAIL_STORAGE_KEY)).toBe('1');

    act(() => result.current.toggle());
    expect(result.current.collapsed).toBe(false);
    expect(localStorage.getItem(DEFAULT_SIDEBAR_RAIL_STORAGE_KEY)).toBe('0');
  });

  it('uses a host-supplied key instead of the package default', () => {
    // The migration path for a host that already persisted this preference under its own key.
    localStorage.setItem('host-rail-key', '1');
    const { result } = renderHook(() => useSidebarRail('host-rail-key'));
    expect(result.current.collapsed).toBe(true);

    act(() => result.current.toggle());
    expect(localStorage.getItem('host-rail-key')).toBe('0');
    expect(localStorage.getItem(DEFAULT_SIDEBAR_RAIL_STORAGE_KEY)).toBeNull();
  });

  it('syncs across tabs via the storage event, ignoring other keys', () => {
    const { result } = renderHook(() => useSidebarRail());

    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: 'something-else', newValue: '1' }));
    });
    expect(result.current.collapsed).toBe(false);

    act(() => {
      window.dispatchEvent(
        new StorageEvent('storage', { key: DEFAULT_SIDEBAR_RAIL_STORAGE_KEY, newValue: '1' }),
      );
    });
    expect(result.current.collapsed).toBe(true);
  });

  it('stops listening once unmounted', () => {
    const { result, unmount } = renderHook(() => useSidebarRail());
    unmount();
    expect(() =>
      window.dispatchEvent(
        new StorageEvent('storage', { key: DEFAULT_SIDEBAR_RAIL_STORAGE_KEY, newValue: '1' }),
      ),
    ).not.toThrow();
    expect(result.current.collapsed).toBe(false);
  });

  it('falls back to expanded when localStorage reads throw', () => {
    // Locked-down embed/iframe contexts: `localStorage` access itself can throw.
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('access denied');
    });
    const { result } = renderHook(() => useSidebarRail());
    expect(result.current.collapsed).toBe(false);
  });

  it('still toggles for the current tab when the persistence write throws', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    const { result } = renderHook(() => useSidebarRail());
    act(() => result.current.toggle());
    expect(result.current.collapsed).toBe(true);
  });
});
