import { render, type RenderOptions, type RenderResult } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { vi } from 'vitest';
import { AdminKitProvider } from '../../kit.js';
import { fakeAdminKit } from '../../testing-kit.js';
import type {
  AdminShellBaseProps, AdminShellNavigationPort, AdminShellPanel, AdminShellProps, AdminShellSession, AdminShellSessionController, AdminShellSessionPort,
} from '../types.js';

/** Shared fixture for the J2 shell tests: spy ports, two panels, an authenticated operator. */
export const operator: AdminShellSession = { user: { id: 'u1', username: 'operator' }, effectivePermissions: ['*'] };

export const labels: AdminShellBaseProps['labels'] = {
  navigation: 'Navigation', openNavigation: 'Open navigation', closeNavigation: 'Close navigation', skipToContent: 'Skip to content',
  loading: 'Checking session', sessionError: 'Session unavailable', retry: 'Retry', expandSidebar: 'Expand sidebar',
  collapseSidebar: 'Collapse sidebar', soon: 'Soon',
};

export const panels: readonly AdminShellPanel[] = [
  { id: 'dashboard', description: 'Manage dashboard.', render: () => <h1>Overview screen</h1>, nav: { label: 'Overview' } },
  { id: 'records', description: 'Manage records.', render: ({ route }) => <h1>Records {route.params.recordId}</h1>, nav: { label: 'Records', group: 'Work' },
    routes: [{ pattern: '/:recordId', view: 'detail' }] },
];

/** Ports whose every method is a spy; `navigation` keeps a live route so a test can navigate. */
export function ports(path = '/') {
  let routePath = path;
  const listeners = new Set<() => void>();
  const navigation: AdminShellNavigationPort = {
    readRoute: vi.fn(() => routePath),
    subscribe: vi.fn(({ onChange }) => { listeners.add(onChange); return () => { listeners.delete(onChange); }; }),
    navigate: vi.fn(({ routePath: next }) => { routePath = next; listeners.forEach((listener) => listener()); }),
    installLinkInterceptor: vi.fn(() => () => {}),
  };
  const sessionPort: AdminShellSessionPort = {
    read: vi.fn(async () => operator), logout: vi.fn(async () => {}), onUnauthenticated: vi.fn(() => () => {}),
  };
  const themePreferenceStore = { read: vi.fn(() => null), write: vi.fn() };
  return { navigation, sessionPort, themePreferenceStore, go: (next: string) => navigation.navigate({ base: '/console', routePath: next }) };
}

export type Ports = ReturnType<typeof ports>;

export function baseFields(p: Ports): AdminShellBaseProps {
  return {
    apiBase: '/operator-api', workspace: { projectId: 'p1' }, adminBase: '/console', defaultPanelId: 'dashboard', railStorageKey: 'fixture-rail',
    title: 'Console', navigation: p.navigation, panels, labels, themePreferenceStore: p.themePreferenceStore,
    slots: { login: () => <p>Login fixture</p> },
  };
}

export const baseProps = (p: Ports): AdminShellProps => ({ ...baseFields(p), session: p.sessionPort });

export const controller = (state: AdminShellSessionController['state']): AdminShellSessionController => ({
  state, refresh: vi.fn(async () => {}), logout: vi.fn(async () => {}),
});

/** A host-owned session that is already authenticated, so tests need no async wait. */
export const authenticated = (): (() => AdminShellSessionController) => {
  const host = controller({ status: 'authenticated', session: operator });
  return () => host;
};

/**
 * `render` with the host kit above the shell: the shell reads its theme functions from the nearest
 * `AdminKitProvider` (R1c), so every shell test mounts under the fake kit instead of the real host's.
 */
export function renderWithKit(ui: ReactElement, options: Omit<RenderOptions, 'wrapper'> = {}): RenderResult {
  const wrapper = ({ children }: { children: ReactNode }) => <AdminKitProvider kit={fakeAdminKit()}>{children}</AdminKitProvider>;
  return render(ui, { ...options, wrapper });
}
