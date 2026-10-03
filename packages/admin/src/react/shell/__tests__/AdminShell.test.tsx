import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useEffect, useState } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AdminShell } from '../AdminShell.js';
import type { AdminShellNavigationPort, AdminShellPanel, AdminShellProps, AdminShellRenderArgs, AdminShellSessionPort } from '../types.js';

// Generalized App prototype-key, agent-page, rail-storage and session-seam tests.
const panels: readonly AdminShellPanel[] = [
  { id: 'dashboard', render: () => <h1>Overview screen</h1>, nav: { label: 'Overview' } },
  {
    id: 'records', nav: { label: 'Records', group: 'Work' }, requires: ['records'], permissions: ['records.read'],
    routes: [{ pattern: '/:recordId', view: 'detail', agentPageId: 'record-detail' }],
    render: ({ route, context }) => <div data-testid="record">{route.view}:{route.params.recordId}:{route.query.get('tab')}:{context.workspace.projectId}</div>,
  },
  { id: 'private', render: () => <h1>Private screen</h1>, nav: { label: 'Private' }, permissions: ['private.read'] },
  { id: 'hidden', render: () => <h1>Unlisted screen</h1> },
];

function fixture(path = '/') {
  let routePath = path;
  const routeListeners = new Set<() => void>();
  let invalidate: () => void = () => {};
  const navigation: AdminShellNavigationPort = {
    readRoute: () => routePath,
    subscribe: ({ onChange }) => { routeListeners.add(onChange); return () => { routeListeners.delete(onChange); }; },
    navigate: ({ routePath: next }) => { routePath = next; routeListeners.forEach((listener) => listener()); },
    installLinkInterceptor: () => () => {},
  };
  const session: AdminShellSessionPort = {
    read: vi.fn(async () => ({ user: { id: 'u1', username: 'operator' }, effectivePermissions: ['records.read'] })),
    logout: vi.fn(async () => {}),
    onUnauthenticated: ({ onUnauthenticated }) => { invalidate = onUnauthenticated; return () => {}; },
  };
  const props: AdminShellProps = {
    apiBase: '/operator-api', workspace: { projectId: 'p1' }, adminBase: '/console', defaultPanelId: 'dashboard',
    railStorageKey: 'fixture-rail', title: 'Example console', session, navigation, panels, capabilities: ['records'],
    labels: { navigation: 'Navigation', openNavigation: 'Open navigation', closeNavigation: 'Close navigation',
      skipToContent: 'Skip to content', loading: 'Checking session', sessionError: 'Session unavailable', retry: 'Retry',
      expandSidebar: 'Expand sidebar', collapseSidebar: 'Collapse sidebar', soon: 'Soon' },
    slots: { login: ({ refreshSession }) => <button onClick={() => { void refreshSession(); }}>Sign in</button> },
  };
  return { props, invalidate: () => invalidate(), go: (next: string) => navigation.navigate({ base: props.adminBase, routePath: next }) };
}

beforeEach(() => localStorage.clear());
afterEach(cleanup);

it('gates all protected contributions and slots until the session resolves', async () => {
  const f = fixture();
  f.props.session.read = vi.fn().mockResolvedValue(null);
  const slots = { ...f.props.slots, assistant: { content: <p>Assistant fixture</p>, label: 'Assistant', open: true }, overlays: () => <p>Overlay fixture</p> };
  render(<AdminShell {...f.props} slots={slots} />);
  expect(screen.getByText('Checking session')).toBeInTheDocument();
  expect(screen.queryByRole('main')).toBeNull();
  await screen.findByRole('button', { name: 'Sign in' });
  expect(screen.queryByText('Assistant fixture')).toBeNull();
  expect(screen.queryByText('Overlay fixture')).toBeNull();
  expect(screen.queryByRole('navigation')).toBeNull();
});

it('derives nav and route dispatch from the same resolved contributions', async () => {
  const f = fixture('/records/r7?tab=history');
  render(<AdminShell {...f.props} />);
  expect(await screen.findByTestId('record')).toHaveTextContent('detail:r7:history:p1');
  expect(screen.getByRole('link', { name: 'Records' })).toHaveAttribute('href', '/console/records');
  expect(screen.queryByRole('link', { name: 'Private' })).toBeNull();
  expect(screen.queryByRole('link', { name: 'hidden' })).toBeNull();
  const main = screen.getByRole('main');
  expect(main).toHaveAttribute('data-agent-page', 'record-detail');
  expect(screen.getByRole('link', { name: 'Records' })).toHaveAttribute('aria-current', 'page');
  act(() => f.go('/private'));
  expect(await screen.findByRole('heading', { name: 'Overview screen' })).toBeInTheDocument();
  expect(screen.queryByText('Private screen')).toBeNull();
  act(() => f.go('/hidden'));
  expect(screen.getByRole('heading', { name: 'Unlisted screen' })).toBeInTheDocument();
});

it('missing capabilities remove a panel from both the nav and direct URLs', async () => {
  const f = fixture('/records/r7');
  render(<AdminShell {...f.props} capabilities={[]} />);
  await screen.findByRole('heading', { name: 'Overview screen' });
  expect(screen.queryByTestId('record')).toBeNull();
  expect(screen.queryByRole('link', { name: 'Records' })).toBeNull();
});

it.each(['constructor', 'valueOf', '__proto__', 'toString', 'hasOwnProperty'])('an unregistered prototype key /%s falls back safely', async (key) => {
  const f = fixture(`/${key}`);
  render(<AdminShell {...f.props} />);
  await screen.findByRole('heading', { name: 'Overview screen' });
  expect(screen.queryByText('[object Object]')).toBeNull();
});

it('a bad detail URL renders a clean default route, without stale params or view', async () => {
  const f = fixture('/records/r7/typo?tab=history');
  const renderDefault = vi.fn((_args: AdminShellRenderArgs) => <h1>Fallback</h1>);
  render(<AdminShell {...f.props} panels={[{ id: 'home', render: renderDefault }, ...panels]} defaultPanelId="home" />);
  await screen.findByRole('heading', { name: 'Fallback' });
  expect(renderDefault.mock.calls[0]?.[0]).toMatchObject({ route: { panelId: 'home', view: null, params: {} } });
  act(() => f.go('/'));
  expect(screen.getByRole('heading', { name: 'Fallback' })).toBeInTheDocument();
});

it('expires a live session through the port and unmounts protected screens', async () => {
  const f = fixture();
  render(<AdminShell {...f.props} />);
  await screen.findByRole('main');
  act(f.invalidate);
  expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument();
  expect(screen.queryByRole('main')).toBeNull();
});

it('a failed logout shows login instead of offering a session-restoring retry', async () => {
  const f = fixture();
  f.props.session.logout = vi.fn().mockRejectedValue(new Error('offline'));
  const slots = {
    ...f.props.slots,
    sidebarFooter: ({ logout }: { logout: () => Promise<void> }) => <button onClick={() => { void logout(); }}>Leave</button>,
  };
  render(<AdminShell {...f.props} slots={slots} />);
  await screen.findByRole('main');
  fireEvent.click(screen.getByRole('button', { name: 'Leave' }));
  await screen.findByRole('button', { name: 'Sign in' });
  expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
  expect(screen.queryByRole('main')).toBeNull();
  expect(f.props.session.read).toHaveBeenCalledTimes(1);
});

it('renders the dashboard destination even when another panel owns the root URL', async () => {
  const f = fixture();
  render(<AdminShell {...f.props} defaultPanelId="home" panels={[
    { id: 'home', render: () => <h1>Home screen</h1> }, ...panels,
  ]} />);
  await screen.findByRole('heading', { name: 'Home screen' });
  const dashboard = screen.getByRole('link', { name: 'Overview' });
  expect(dashboard).toHaveAttribute('href', '/console/dashboard');
  act(() => f.go(dashboard.getAttribute('href')!.slice('/console'.length)));
  expect(screen.getByRole('heading', { name: 'Overview screen' })).toBeInTheDocument();
  expect(screen.getByRole('main')).toHaveAttribute('data-agent-page', 'dashboard');
});

it('shows a session error without protected content and retries through the port', async () => {
  const f = fixture();
  const liveSession = { user: { id: 'u1', username: 'operator' } };
  f.props.session.read = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(liveSession);
  render(<AdminShell {...f.props} />);
  await screen.findByRole('alert');
  expect(screen.queryByRole('main')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  await screen.findByRole('main');
  expect(screen.queryByRole('alert')).toBeNull();
});

it('provides the authenticated main element to a host page driver', async () => {
  const f = fixture();
  const mainRef = vi.fn();
  render(<AdminShell {...f.props} mainRef={(element) => { mainRef(element); }} />);
  const main = await screen.findByRole('main');
  expect(mainRef).toHaveBeenCalledWith(main);
  const skip = screen.getByRole('link', { name: 'Skip to content' });
  expect(skip).toHaveAttribute('href', `#${main.id}`);
  expect(main).toHaveAttribute('tabindex', '-1');
  act(f.invalidate);
  expect(mainRef).toHaveBeenLastCalledWith(null);
});

it('translates navigation through the host while preserving its route URL', async () => {
  const f = fixture('/records');
  const translateNav: NonNullable<AdminShellProps['translateNav']> = ({ groups }) => groups.map((group) => ({
    ...group, items: group.items.map((item) => ({ ...item, label: `Localized ${item.label}` })),
  }));
  render(<AdminShell {...f.props} translateNav={translateNav} />);
  expect(await screen.findByRole('link', { name: 'Localized Records' })).toHaveAttribute('href', '/console/records');
  expect(screen.queryByRole('link', { name: 'Records' })).toBeNull();
});

it('preserves and writes rail preference under the required host key', async () => {
  const f = fixture();
  localStorage.setItem('fixture-rail', '0');
  render(<AdminShell {...f.props} railDefaultCollapsed />);
  await screen.findByRole('main');
  expect(screen.getByRole('navigation')).not.toHaveClass('is-rail');
  fireEvent.click(screen.getByRole('button', { name: 'Collapse sidebar' }));
  expect(localStorage.getItem('fixture-rail')).toBe('1');
  fireEvent.click(screen.getByRole('button', { name: 'Expand sidebar' }));
  expect(localStorage.getItem('fixture-rail')).toBe('0');
  expect(localStorage.getItem('jini-admin-sidebar-rail-collapsed')).toBeNull();
});

it('closes the drawer on Escape, backdrop and navigation', async () => {
  const f = fixture();
  const { container } = render(<AdminShell {...f.props} />);
  await screen.findByRole('main');
  const toggle = screen.getByRole('button', { name: 'Open navigation' });
  fireEvent.click(toggle);
  expect(toggle).toHaveAttribute('aria-expanded', 'true');
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(toggle).toHaveAttribute('aria-expanded', 'false');
  fireEvent.click(toggle);
  fireEvent.click(container.querySelector('.sidebar-backdrop')!);
  expect(toggle).toHaveAttribute('aria-expanded', 'false');
  fireEvent.click(toggle);
  act(() => f.go('/hidden'));
  await waitFor(() => expect(toggle).toHaveAttribute('aria-expanded', 'false'));
});

it('keeps an assistant pane mounted when closed and across navigation', async () => {
  const f = fixture();
  const unmount = vi.fn();
  function AssistantFixture() {
    const [value, setValue] = useState('');
    useEffect(() => unmount, []);
    return <input aria-label="Assistant draft" value={value} onChange={(event) => setValue(event.target.value)} />;
  }
  const content = <AssistantFixture />;
  const slots = { ...f.props.slots, assistant: { content, label: 'Assistant', open: true } };
  const { rerender, container } = render(<AdminShell {...f.props} slots={slots} />);
  await screen.findByRole('main');
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'keep this' } });
  rerender(<AdminShell {...f.props} slots={{ ...slots, assistant: { ...slots.assistant, open: false } }} />);
  expect(container.querySelector('aside')).toHaveAttribute('hidden');
  act(() => f.go('/hidden'));
  rerender(<AdminShell {...f.props} slots={slots} />);
  expect(screen.getByRole('textbox')).toHaveValue('keep this');
  expect(unmount).not.toHaveBeenCalled();
  act(f.invalidate);
  expect(unmount).toHaveBeenCalledTimes(1);
});

it('lets another host supply its own login, features, branding and footer', async () => {
  const f = fixture('/tasks');
  const logoutSlot: AdminShellProps['slots'] = {
    ...f.props.slots, sidebarFooter: ({ logout }) => <button onClick={() => { void logout(); }}>Leave workspace</button>,
  };
  render(<AdminShell {...f.props} apiBase="/mock" title="Workspace console" slots={logoutSlot}
    workspace={{ organizationId: 'org' }} panels={[{ id: 'tasks', render: () => <h1>Task board</h1>, nav: { label: 'Tasks' } }]} defaultPanelId="tasks" />);
  await screen.findByRole('heading', { name: 'Task board' });
  expect(screen.getByText('Workspace console')).toBeInTheDocument();
  expect(within(screen.getByRole('navigation')).getByRole('link', { name: 'Tasks' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Leave workspace' }));
  await screen.findByRole('button', { name: 'Sign in' });
  expect(f.props.session.logout).toHaveBeenCalledWith({ apiBase: '/mock', workspace: { organizationId: 'org' } });
});
