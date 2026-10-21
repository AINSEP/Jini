import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { defaultAdminTheme, type ColorSchemePreference } from '@jini-ai/ui/theme';
import { useAdminTheme } from '../use-admin-theme.js';
import type { AdminThemeEnvironment, AdminThemePreferenceStorePort } from '../theme-ports.js';

afterEach(cleanup);

// Stable references: the hook keys its effects on the workspace object, as a host's memoised value would be.
const noWorkspace = {};
const siteA = { site: 'a' };

function environmentFor(target: HTMLElement): AdminThemeEnvironment {
  return { target, document, matchMedia: () => ({ matches: false }) };
}

function storeReturning(value: string | null): AdminThemePreferenceStorePort {
  // Host storage is untrusted at runtime even though the port is typed; the hook validates it.
  return { read: vi.fn(() => value as ColorSchemePreference | null), write: vi.fn() };
}

it('restores a stored "system" preference for the signed-in user', () => {
  const target = document.createElement('div');
  const environment = environmentFor(target); const preferenceStore = storeReturning('system');
  const { result } = renderHook(() => useAdminTheme({ userId: 'u1', workspace: noWorkspace }, { environment, preferenceStore }));
  expect(result.current?.preference).toBe('system');
  expect(result.current?.resolved).toBe('light');
});

it('ignores a corrupted stored preference and falls back to "system"', () => {
  const target = document.createElement('div');
  const environment = environmentFor(target);
  const preferenceStore = storeReturning('purple');
  const { result } = renderHook(() => useAdminTheme({ userId: 'u1', workspace: siteA }, {
    environment, preferenceStore,
  }));
  expect(preferenceStore.read).toHaveBeenCalledWith({ userId: 'u1', workspace: siteA });
  expect(result.current?.preference).toBe('system');
});

it('refuses to apply a theme when the host supplies no theme environment', () => {
  const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  expect(() => renderHook(() => useAdminTheme({ userId: null, workspace: noWorkspace }, { theme: defaultAdminTheme })))
    .toThrow(new TypeError('AdminShell theme requires a themeEnvironment port'));
  error.mockRestore();
});

it('returns no appearance controls when there is no environment', () => {
  const { result } = renderHook(() => useAdminTheme({ userId: null, workspace: noWorkspace }));
  expect(result.current).toBeUndefined();
});

it('restores the color-scheme attribute the host had set before mounting', () => {
  const target = document.createElement('div');
  target.setAttribute('data-color-scheme', 'dark');
  const environment = environmentFor(target);
  const { result, unmount } = renderHook(() => useAdminTheme({ userId: null, workspace: noWorkspace }, {
    environment, colorScheme: 'light',
  }));
  expect(result.current?.resolved).toBe('light');
  expect(target.getAttribute('data-color-scheme')).toBe('light');
  unmount();
  expect(target.getAttribute('data-color-scheme')).toBe('dark');
});

it('rejects an invalid preference without writing it to the store', () => {
  const target = document.createElement('div');
  const environment = environmentFor(target);
  const preferenceStore = storeReturning(null);
  const { result } = renderHook(() => useAdminTheme({ userId: 'u1', workspace: noWorkspace }, {
    environment, preferenceStore,
  }));
  expect(() => act(() => result.current?.setPreference({ preference: 'sepia' as ColorSchemePreference })))
    .toThrow(new TypeError('Invalid color scheme preference'));
  expect(preferenceStore.write).not.toHaveBeenCalled();
  expect(result.current?.preference).toBe('system');
});

it('keeps an explicit choice in memory when no user is signed in', () => {
  const target = document.createElement('div');
  const environment = environmentFor(target);
  const preferenceStore = storeReturning(null);
  const { result } = renderHook(() => useAdminTheme({ userId: null, workspace: noWorkspace }, {
    environment, preferenceStore,
  }));
  act(() => result.current?.setPreference({ preference: 'dark' }));
  expect(preferenceStore.read).not.toHaveBeenCalled();
  expect(preferenceStore.write).not.toHaveBeenCalled();
  expect(result.current?.preference).toBe('dark');
  expect(target.getAttribute('data-color-scheme')).toBe('dark');
});
