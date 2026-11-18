import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, expectTypeOf, it, vi } from 'vitest';
import { AdminShell } from '../AdminShell.js';
import type { AdminShellAppearance } from '../theme-ports.js';
import type {
  AdminShellBaseProps, AdminShellHostProps, AdminShellNavigationPort, AdminShellPanel, AdminShellProps, AdminShellSessionController, AdminShellSessionPort,
} from '../types.js';

// J2 step 1: every hook the shell calls arrives as a prop defaulted to the real hook, so each
// test hands the shell a fake and asserts the real one's collaborator was never touched.
const session = { user: { id: 'u1', username: 'operator' }, effectivePermissions: ['*'] };
const panels: readonly AdminShellPanel[] = [
  { id: 'dashboard', description: 'Manage dashboard.', render: () => <h1>Overview screen</h1>, nav: { label: 'Overview' } },
  { id: 'records', description: 'Manage records.', render: ({ route }) => <h1>Records {route.params.recordId}</h1>, nav: { label: 'Records' },
    routes: [{ pattern: '/:recordId', view: 'detail' }] },
];
const labels = {
  navigation: 'Navigation', openNavigation: 'Open navigation', closeNavigation: 'Close navigation', skipToContent: 'Skip to content',
  loading: 'Checking session', sessionError: 'Session unavailable', retry: 'Retry', expandSidebar: 'Expand sidebar',
  collapseSidebar: 'Collapse sidebar', soon: 'Soon',
};

/** Ports whose every method is a spy: a fake hook must keep all of them untouched. */
function ports() {
  const navigation: AdminShellNavigationPort = {
    readRoute: vi.fn(() => '/'), subscribe: vi.fn(() => () => {}), navigate: vi.fn(), installLinkInterceptor: vi.fn(() => () => {}),
  };
  const sessionPort: AdminShellSessionPort = {
    read: vi.fn(async () => session), logout: vi.fn(async () => {}), onUnauthenticated: vi.fn(() => () => {}),
  };
  const themePreferenceStore = { read: vi.fn(() => null), write: vi.fn() };
  return { navigation, sessionPort, themePreferenceStore };
}

function baseFields(p: ReturnType<typeof ports>): AdminShellBaseProps {
  return {
    apiBase: '/operator-api', workspace: { projectId: 'p1' }, adminBase: '/console', defaultPanelId: 'dashboard', railStorageKey: 'hook-props-rail',
    title: 'Console', navigation: p.navigation, panels, labels, themePreferenceStore: p.themePreferenceStore,
    slots: { login: () => <p>Login fixture</p> },
  };
}

const baseProps = (p: ReturnType<typeof ports>): AdminShellProps => ({ ...baseFields(p), session: p.sessionPort });

const controller = (state: AdminShellSessionController['state']): AdminShellSessionController => ({
  state, refresh: vi.fn(async () => {}), logout: vi.fn(async () => {}),
});

afterEach(cleanup);

it('useSessionHook: a fake returning anonymous shows the login slot and the real session port is never read', () => {
  const p = ports();
  const useSessionHook = vi.fn(() => controller({ status: 'anonymous' }));
  render(<AdminShell {...baseProps(p)} useSessionHook={useSessionHook} />);
  expect(screen.getByText('Login fixture')).toBeInTheDocument();
  expect(useSessionHook).toHaveBeenCalledWith({ port: p.sessionPort, context: { apiBase: '/operator-api', workspace: { projectId: 'p1' } } });
  expect(p.sessionPort.read).not.toHaveBeenCalled();
  expect(p.sessionPort.onUnauthenticated).not.toHaveBeenCalled();
});

it('useThemeHook: a fake appearance reaches the slots and the real theme hook never reads its preference store', () => {
  const p = ports();
  const appearance: AdminShellAppearance = { preference: 'dark', resolved: 'dark', setPreference: vi.fn() };
  const useThemeHook = vi.fn(() => appearance);
  const props = baseProps(p);
  render(<AdminShell {...props} useSessionHook={() => controller({ status: 'authenticated', session })} useThemeHook={useThemeHook}
    slots={{ ...props.slots, overlays: ({ appearance: seen }) => <p>Appearance {seen?.preference}</p> }} />);
  expect(screen.getByText('Appearance dark')).toBeInTheDocument();
  expect(useThemeHook).toHaveBeenCalledWith({ userId: 'u1', workspace: { projectId: 'p1' } }, expect.any(Object));
  expect(p.themePreferenceStore.read).not.toHaveBeenCalled();
});

it('useRouteHook: a fake route dispatches the panel and the real navigation port is never read', () => {
  const p = ports();
  const useRouteHook = vi.fn(() => '/records/r9');
  render(<AdminShell {...baseProps(p)} useSessionHook={() => controller({ status: 'authenticated', session })} useRouteHook={useRouteHook} />);
  expect(screen.getByRole('heading', { name: 'Records r9' })).toBeInTheDocument();
  expect(useRouteHook).toHaveBeenCalledWith({ navigation: p.navigation, base: '/console' });
  expect(p.navigation.readRoute).not.toHaveBeenCalled();
  expect(p.navigation.subscribe).not.toHaveBeenCalled();
  expect(p.navigation.installLinkInterceptor).not.toHaveBeenCalled();
});

it('useDrawerHook: a fake drawer state drives the toggle and backdrop', () => {
  const p = ports();
  const setOpen = vi.fn();
  const useDrawerHook = vi.fn(() => ({ open: true, setOpen }));
  const { container } = render(<AdminShell {...baseProps(p)} useSessionHook={() => controller({ status: 'authenticated', session })}
    useDrawerHook={useDrawerHook} />);
  expect(useDrawerHook).toHaveBeenCalledWith({ routePath: '/' });
  expect(screen.getByRole('button', { name: 'Close navigation', expanded: true })).toBeInTheDocument();
  act(() => { (container.querySelector('.sidebar-backdrop') as HTMLElement).click(); });
  expect(setOpen).toHaveBeenCalledWith(false);
});

// 1b: a host that owns the session machine passes `useHostSession` and no port at all.
function hostProps(p: ReturnType<typeof ports>, useHostSession: () => AdminShellSessionController): AdminShellHostProps {
  return { ...baseFields(p), useHostSession };
}

it('useHostSession authenticated: the panel renders and no session port exists to be called', () => {
  const p = ports();
  render(<AdminShell {...hostProps(p, () => controller({ status: 'authenticated', session }))} />);
  expect(screen.getByRole('heading', { name: 'Overview screen' })).toBeInTheDocument();
  expect(p.sessionPort.read).not.toHaveBeenCalled();
});

it('useHostSession anonymous: the login slot renders', () => {
  const p = ports();
  render(<AdminShell {...hostProps(p, () => controller({ status: 'anonymous' }))} />);
  expect(screen.getByText('Login fixture')).toBeInTheDocument();
  expect(screen.queryByRole('main')).toBeNull();
});

it('useHostSession: the controller logout and refresh reach the slot args', () => {
  const p = ports();
  const host = controller({ status: 'authenticated', session });
  const props = hostProps(p, () => host);
  render(<AdminShell {...props} slots={{ ...props.slots, overlays: ({ logout, refreshSession }) => <p>{logout === host.logout && refreshSession === host.refresh ? 'wired' : 'unwired'}</p> }} />);
  expect(screen.getByText('wired')).toBeInTheDocument();
});

it('one session source only: each variant forbids the other source by type', () => {
  expectTypeOf<AdminShellProps['useHostSession']>().toEqualTypeOf<undefined>();
  expectTypeOf<AdminShellHostProps['session']>().toEqualTypeOf<undefined>();
  expectTypeOf<AdminShellHostProps['useSessionHook']>().toEqualTypeOf<undefined>();
});
