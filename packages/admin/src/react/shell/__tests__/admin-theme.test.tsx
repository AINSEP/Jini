import { act, cleanup, render, renderHook, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { defaultAdminTheme, type ColorSchemePreference } from '@jini-ai/ui/theme';
import { AdminShell } from '../AdminShell.js';
import { useAdminTheme } from '../use-admin-theme.js';
import type { AdminThemeEnvironment, AdminThemePreferenceStorePort } from '../theme-ports.js';
import type { AdminShellProps } from '../types.js';

afterEach(cleanup);

function fixture() {
  const target = document.createElement('div');
  let dark = false;
  const listeners = new Set<() => void>();
  const media = { get matches() { return dark; },
    addEventListener: (_type: 'change', callback: () => void) => { listeners.add(callback); },
    removeEventListener: (_type: 'change', callback: () => void) => { listeners.delete(callback); } };
  const environment: AdminThemeEnvironment = { target, document, matchMedia: () => media };
  const preferences = new Map<string, ColorSchemePreference>([['one', 'dark'], ['two', 'light']]);
  const preferenceStore: AdminThemePreferenceStorePort = {
    read: vi.fn(({ userId }) => preferences.get(userId) ?? null),
    write: vi.fn(({ userId, preference }) => { preferences.set(userId, preference); }),
  };
  return { target, environment, preferenceStore, listeners, setDark: (next: boolean) => { dark = next; listeners.forEach((callback) => callback()); } };
}

it('restores per-user choices, writes only on explicit changes and isolates switched users', () => {
  const f = fixture(); const workspace = { project: 'fixture' };
  const { result, rerender, unmount } = renderHook(({ userId }) => useAdminTheme({ userId, workspace }, {
    theme: defaultAdminTheme, environment: f.environment, preferenceStore: f.preferenceStore,
  }), { initialProps: { userId: 'one' as string | null } });
  expect(result.current?.preference).toBe('dark');
  expect(f.target.getAttribute('data-color-scheme')).toBe('dark');
  expect(f.preferenceStore.write).not.toHaveBeenCalled();
  act(() => result.current?.setPreference({ preference: 'light' }));
  expect(f.preferenceStore.write).toHaveBeenLastCalledWith({ userId: 'one', workspace, preference: 'light' });
  rerender({ userId: 'two' });
  expect(result.current?.preference).toBe('light');
  act(() => result.current?.setPreference({ preference: 'dark' }));
  expect(f.preferenceStore.write).toHaveBeenLastCalledWith({ userId: 'two', workspace, preference: 'dark' });
  rerender({ userId: null });
  expect(result.current?.preference).toBe('system');
  unmount();
  expect(f.target.hasAttribute('data-color-scheme')).toBe(false);
  expect(f.target.hasAttribute('data-admin-theme')).toBe(false);
});

it('tracks system changes, honors a controlled choice and releases media subscriptions', () => {
  const f = fixture(); const workspace = {};
  const onColorSchemeChange = vi.fn();
  const { result, rerender, unmount } = renderHook(({ colorScheme }) => useAdminTheme({ userId: 'one', workspace }, {
    environment: f.environment, colorScheme, onColorSchemeChange,
  }), { initialProps: { colorScheme: 'system' as ColorSchemePreference } });
  expect(f.listeners.size).toBe(1);
  act(() => f.setDark(true));
  expect(result.current?.resolved).toBe('dark');
  rerender({ colorScheme: 'light' });
  expect(f.listeners.size).toBe(0);
  expect(f.target.getAttribute('data-color-scheme')).toBe('light');
  act(() => result.current?.setPreference({ preference: 'dark' }));
  expect(onColorSchemeChange).toHaveBeenCalledWith({ preference: 'dark' });
  expect(result.current?.resolved).toBe('light');
  unmount(); expect(f.listeners.size).toBe(0);
});

it('applies theme props on AdminShell and passes appearance controls into authenticated slots', async () => {
  // Generalized from the original admin shell session-gating fixture: the host owns scope,
  // session, navigation, manifest and copy; theme storage is an additional injected port.
  const f = fixture();
  const props: AdminShellProps = {
    apiBase: '/api', workspace: { project: 'fixture' }, adminBase: '/console', defaultPanelId: 'home',
    railStorageKey: 'fixture-theme-rail', title: 'Console',
    session: { read: async () => ({ user: { id: 'one', username: 'operator' } }), logout: async () => {}, onUnauthenticated: () => () => {} },
    navigation: { readRoute: () => '/', subscribe: () => () => {}, navigate: () => {}, installLinkInterceptor: () => () => {} },
    panels: [{ id: 'home', render: () => <p>Home</p> }],
    slots: { login: () => <p>Login</p>, sidebarFooter: ({ appearance }) => <button onClick={() => appearance?.setPreference({ preference: 'light' })}>Light</button> },
    labels: { navigation: 'Navigation', openNavigation: 'Open', closeNavigation: 'Close', skipToContent: 'Skip', loading: 'Loading', sessionError: 'Error', retry: 'Retry', expandSidebar: 'Expand', collapseSidebar: 'Collapse', soon: 'Soon' },
    theme: defaultAdminTheme, themeEnvironment: f.environment, themePreferenceStore: f.preferenceStore,
  };
  const { unmount } = render(<AdminShell {...props} />);
  const light = await screen.findByRole('button', { name: 'Light' });
  expect(f.target.getAttribute('data-admin-theme')).toBe('neutral');
  await waitFor(() => expect(f.target.getAttribute('data-color-scheme')).toBe('dark'));
  act(() => light.click());
  expect(f.preferenceStore.write).toHaveBeenCalledWith({ userId: 'one', workspace: props.workspace, preference: 'light' });
  expect(f.target.getAttribute('data-color-scheme')).toBe('light');
  unmount();
  expect(f.target.hasAttribute('data-admin-theme')).toBe(false);
});
