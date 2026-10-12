import { StrictMode, type ReactNode } from 'react';
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useSidebarRail } from '../../hooks/use-sidebar-rail.js';

const KEY = 'controlled-rail';

/** Real hook with fake persistence/events: overrides must never become saved preferences. */
function fixture(stored: string | null = '0') {
  const values = new Map<string, string>(stored === null ? [] : [[KEY, stored]]);
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: vi.fn((key: string, value: string) => { values.set(key, value); }),
  };
  const events = { addEventListener: vi.fn(), removeEventListener: vi.fn() };
  const onCollapsedChange = vi.fn<(collapsed: boolean) => void>();
  const emit = (newValue: string | null) => {
    const listener = events.addEventListener.mock.calls[0]?.[1] as EventListener;
    act(() => listener(new StorageEvent('storage', { key: KEY, newValue })));
  };
  return { storage, events, onCollapsedChange, values, emit };
}

type Props = { railOverride: boolean | null | undefined };

describe('controlled sidebar rail', () => {
  it('overrides expanded storage and restores it on null or undefined without writing', () => {
    const f = fixture();
    const { result, rerender } = renderHook(({ railOverride }: Props) => useSidebarRail(f, {
      storageKey: KEY, railOverride, defaultCollapsed: true,
    }), { initialProps: { railOverride: true } as Props });
    expect(result.current.collapsed).toBe(true);
    rerender({ railOverride: null });
    expect(result.current.collapsed).toBe(false);
    rerender({ railOverride: true });
    expect(result.current.collapsed).toBe(true);
    rerender({ railOverride: undefined });
    expect(result.current.collapsed).toBe(false);
    expect(f.values.get(KEY)).toBe('0');
    expect(f.storage.setItem).not.toHaveBeenCalled();
  });

  it('accepts a false override and restores the absent preference to the host default', () => {
    const f = fixture(null);
    const { result, rerender } = renderHook(({ railOverride }: Props) => useSidebarRail(f, {
      storageKey: KEY, defaultCollapsed: true, railOverride,
    }), { initialProps: { railOverride: false } as Props });
    expect(result.current.collapsed).toBe(false);
    rerender({ railOverride: null });
    expect(result.current.collapsed).toBe(true);
    expect(f.values.has(KEY)).toBe(false);
    expect(f.storage.setItem).not.toHaveBeenCalled();
  });

  it('requests each controlled toggle once in StrictMode and waits for the host', () => {
    const f = fixture('1');
    const { result, rerender } = renderHook(({ railOverride }: Props) => useSidebarRail(f, {
      storageKey: KEY, railOverride, onCollapsedChange: f.onCollapsedChange,
    }), {
      initialProps: { railOverride: true } as Props,
      wrapper: ({ children }: { children: ReactNode }) => <StrictMode>{children}</StrictMode>,
    });
    act(() => result.current.toggle());
    expect(f.onCollapsedChange.mock.calls).toEqual([[false]]);
    expect(result.current.collapsed).toBe(true);
    rerender({ railOverride: false });
    expect(result.current.collapsed).toBe(false);
    act(() => result.current.toggle());
    expect(f.onCollapsedChange.mock.calls).toEqual([[false], [true]]);
    expect(result.current.collapsed).toBe(false);
    rerender({ railOverride: null });
    expect(result.current.collapsed).toBe(true);
    expect(f.values.get(KEY)).toBe('1');
    expect(f.storage.setItem).not.toHaveBeenCalled();
  });

  it('keeps an override fixed without a callback, then resumes persisted toggles on release', () => {
    const f = fixture('0');
    const { result, rerender } = renderHook(({ railOverride }: Props) => useSidebarRail(f, {
      storageKey: KEY, railOverride,
    }), { initialProps: { railOverride: true } as Props });
    act(() => result.current.toggle());
    expect(result.current.collapsed).toBe(true);
    expect(f.storage.setItem).not.toHaveBeenCalled();
    rerender({ railOverride: null });
    expect(result.current.collapsed).toBe(false);
    act(() => result.current.toggle());
    expect(result.current.collapsed).toBe(true);
    expect(f.storage.setItem).toHaveBeenCalledWith(KEY, '1');
  });

  it('keeps cross-tab updates behind the override and reveals the latest preference on release', () => {
    const f = fixture('0');
    const { result, rerender } = renderHook(({ railOverride }: Props) => useSidebarRail(f, {
      storageKey: KEY, railOverride, onCollapsedChange: f.onCollapsedChange,
    }), { initialProps: { railOverride: false } as Props });
    f.emit('1');
    expect(result.current.collapsed).toBe(false);
    rerender({ railOverride: null });
    expect(result.current.collapsed).toBe(true);
    rerender({ railOverride: true });
    f.emit(null);
    expect(result.current.collapsed).toBe(true);
    rerender({ railOverride: null });
    expect(result.current.collapsed).toBe(false);
    expect(f.storage.setItem).not.toHaveBeenCalled();
    expect(f.onCollapsedChange).not.toHaveBeenCalled();
  });
});
