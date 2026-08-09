import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_NAV_SECTIONS_STORAGE_KEY, useNavSections } from '../../hooks/use-nav-sections.js';

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('useNavSections', () => {
  it('defaults every section to OPEN for a first-run visitor', () => {
    const { result } = renderHook(() => useNavSections());
    // The safe direction: a section nobody has expressed a preference about must render its items,
    // never hide working navigation from an operator who does not know the control exists.
    expect(result.current.isOpen('People')).toBe(true);
    expect(result.current.isOpen('Content')).toBe(true);
  });

  it('closes a never-before-stored section on its FIRST press, not on the second', () => {
    // Regression guard for the `?? true` in `toggle`. A bare `!current[label]` reads `undefined` as
    // falsy and would OPEN an already-open section — the first click would visibly do nothing.
    const { result } = renderHook(() => useNavSections());
    act(() => result.current.toggle('People'));
    expect(result.current.isOpen('People')).toBe(false);
  });

  it('persists open/closed across a remount', () => {
    const first = renderHook(() => useNavSections());
    act(() => first.result.current.toggle('People'));
    first.unmount();

    const second = renderHook(() => useNavSections());
    expect(second.result.current.isOpen('People')).toBe(false);
  });

  it('keeps sections independent — closing one does not disturb another', () => {
    const { result } = renderHook(() => useNavSections());
    act(() => result.current.toggle('People'));
    act(() => result.current.toggle('Studio'));
    act(() => result.current.toggle('Studio'));

    expect(result.current.isOpen('People')).toBe(false);
    expect(result.current.isOpen('Studio')).toBe(true);
  });

  it('falls back to all-open on a malformed stored value rather than throwing', () => {
    localStorage.setItem(DEFAULT_NAV_SECTIONS_STORAGE_KEY, 'not json{');
    const { result } = renderHook(() => useNavSections());
    expect(result.current.isOpen('People')).toBe(true);
  });

  it('drops a non-boolean entry without discarding the rest of the map', () => {
    localStorage.setItem(DEFAULT_NAV_SECTIONS_STORAGE_KEY, JSON.stringify({ People: false, Studio: 'nope' }));
    const { result } = renderHook(() => useNavSections());
    expect(result.current.isOpen('People')).toBe(false);
    expect(result.current.isOpen('Studio')).toBe(true);
  });

  it('ignores a stored array — JSON-valid but the wrong shape', () => {
    localStorage.setItem(DEFAULT_NAV_SECTIONS_STORAGE_KEY, JSON.stringify(['People']));
    const { result } = renderHook(() => useNavSections());
    expect(result.current.isOpen('People')).toBe(true);
  });

  it('survives localStorage throwing (locked-down embed) instead of taking the nav down', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied');
    });

    const { result } = renderHook(() => useNavSections());
    expect(result.current.isOpen('People')).toBe(true);
    // The toggle still works for this tab even though nothing can be written.
    act(() => result.current.toggle('People'));
    expect(result.current.isOpen('People')).toBe(false);
  });

  it('uses a host-supplied key instead of the package default', () => {
    const { result } = renderHook(() => useNavSections('host-sections-key'));
    act(() => result.current.toggle('People'));
    expect(localStorage.getItem('host-sections-key')).toContain('People');
    expect(localStorage.getItem(DEFAULT_NAV_SECTIONS_STORAGE_KEY)).toBeNull();
  });

  it('syncs across tabs on a storage event', () => {
    const { result } = renderHook(() => useNavSections());
    expect(result.current.isOpen('People')).toBe(true);

    act(() => {
      localStorage.setItem(DEFAULT_NAV_SECTIONS_STORAGE_KEY, JSON.stringify({ People: false }));
      window.dispatchEvent(
        new StorageEvent('storage', {
          key: DEFAULT_NAV_SECTIONS_STORAGE_KEY,
          newValue: JSON.stringify({ People: false }),
        }),
      );
    });

    expect(result.current.isOpen('People')).toBe(false);
  });

  it('treats another tab CLEARING storage as "no preference", not as all-closed', () => {
    localStorage.setItem(DEFAULT_NAV_SECTIONS_STORAGE_KEY, JSON.stringify({ People: false }));
    const { result } = renderHook(() => useNavSections());
    expect(result.current.isOpen('People')).toBe(false);

    act(() => {
      localStorage.clear();
      window.dispatchEvent(new StorageEvent('storage', { key: DEFAULT_NAV_SECTIONS_STORAGE_KEY, newValue: null }));
    });

    expect(result.current.isOpen('People')).toBe(true);
  });

  it('ignores a storage event for an unrelated key', () => {
    const { result } = renderHook(() => useNavSections());
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: 'something-else', newValue: '{"People":false}' }));
    });
    expect(result.current.isOpen('People')).toBe(true);
  });
});
