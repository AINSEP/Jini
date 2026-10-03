import { act, renderHook } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { useNavSections } from '../../hooks/use-nav-sections.js';
import { useSidebarRail } from '../../hooks/use-sidebar-rail.js';

it('uses supplied persistence and events for rail state, including an absent preference', () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => { values.set(key, value); }),
  };
  const events = { addEventListener: vi.fn(), removeEventListener: vi.fn() };
  const { result, unmount } = renderHook(() => useSidebarRail({ storage, events }, {
    storageKey: 'fixture-rail', defaultCollapsed: true,
  }));
  expect(result.current.collapsed).toBe(true);
  act(() => result.current.toggle());
  expect(result.current.collapsed).toBe(false);
  expect(values.get('fixture-rail')).toBe('0');
  const listener = events.addEventListener.mock.calls[0]?.[1] as EventListener;
  expect(typeof listener).toBe('function');
  act(() => listener(new StorageEvent('storage', { key: 'fixture-rail', newValue: null })));
  expect(result.current.collapsed).toBe(true);
  unmount();
  expect(events.removeEventListener).toHaveBeenCalledWith('storage', listener);
});

it('reads explicit expanded state over a collapsed default', () => {
  const storage = { getItem: () => '0', setItem: vi.fn() };
  const events = { addEventListener: vi.fn(), removeEventListener: vi.fn() };
  const { result } = renderHook(() => useSidebarRail({ storage, events }, { defaultCollapsed: true }));
  expect(result.current.collapsed).toBe(false);
});

it('persists sections through object methods without reading ambient storage', () => {
  let value: string | null = '{"Records":false,"Invalid":3}';
  const storage = {
    getItem: vi.fn(() => value),
    setItem: vi.fn((_key: string, next: string) => { value = next; }),
  };
  const events = { addEventListener: vi.fn(), removeEventListener: vi.fn() };
  const { result, unmount } = renderHook(() => useNavSections({ storage, events }, { storageKey: 'fixture-sections' }));
  expect(result.current.isOpen({ groupLabel: 'Records' })).toBe(false);
  expect(result.current.isOpen({ groupLabel: 'Invalid' })).toBe(true);
  act(() => result.current.toggle({ groupLabel: 'Records' }));
  expect(result.current.isOpen({ groupLabel: 'Records' })).toBe(true);
  expect(storage.setItem).toHaveBeenCalledWith('fixture-sections', '{"Records":true}');
  unmount();
  expect(events.removeEventListener).toHaveBeenCalledWith('storage', events.addEventListener.mock.calls[0]?.[1]);
});
