import { act, cleanup, fireEvent, screen } from '@testing-library/react';
import { createContext, useContext, useEffect, type ReactNode } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AdminShell } from '../AdminShell.js';
import type { AdminShellHostProps, AdminShellPanel, AdminShellSessionController, AdminShellSlots } from '../types.js';
import { authenticated, baseFields, controller, operator, ports, renderWithKit as render } from './shell-fixture.js';

// J2 step 4: the frame and the small slots a host needs to put its own chrome around the shell.
beforeEach(() => localStorage.clear());
afterEach(cleanup);

const Shared = createContext('no-frame');
function Reader({ label }: { readonly label: string }): ReactNode { return <p>{label}: {useContext(Shared)}</p>; }

function mount(slots: Partial<AdminShellSlots>, extra: Partial<AdminShellHostProps> = {}, path = '/') {
  const p = ports(path);
  const fields = baseFields(p);
  const view = render(<AdminShell {...fields} useHostSession={authenticated()} {...extra} slots={{ ...fields.slots, ...slots }} />);
  return { p, fields, ...view };
}

const readerPanel: AdminShellPanel = { id: 'dashboard', description: 'Manage dashboard.', render: () => <Reader label="panel" />, nav: { label: 'Overview' } };

it('frame: a context it provides is readable from the panel, the assistant content and the overlays', () => {
  const frame: AdminShellSlots['frame'] = ({ children }) => <Shared.Provider value="from-frame">{children}</Shared.Provider>;
  mount({ frame, overlays: () => <Reader label="overlay" />, assistant: { content: <Reader label="assistant" />, label: 'Assistant', open: true } },
    { panels: [readerPanel] });
  expect(screen.getByText('panel: from-frame')).toBeInTheDocument();
  expect(screen.getByText('assistant: from-frame')).toBeInTheDocument();
  expect(screen.getByText('overlay: from-frame')).toBeInTheDocument();
});

it('frame: receives the slot args and is not called for the checking, anonymous or error states', () => {
  const frame = vi.fn<NonNullable<AdminShellSlots['frame']>>(({ children }) => <>{children}</>);
  for (const state of [{ status: 'checking' }, { status: 'anonymous' }, { status: 'error', error: new Error('down') }] as const) {
    const host: AdminShellSessionController = controller(state);
    mount({ frame }, { useHostSession: () => host });
    cleanup();
  }
  expect(frame).not.toHaveBeenCalled();
  mount({ frame });
  expect(frame.mock.calls[0]![0]).toMatchObject({ session: operator, route: { panelId: 'dashboard' } });
});

function MountCounter({ onMount }: { readonly onMount: () => void }): ReactNode {
  useEffect(onMount, [onMount]);
  return null;
}

it('frame: a child is mounted once across three route changes, and re-keying on the user id remounts it', () => {
  const onMount = vi.fn();
  let host = controller({ status: 'authenticated', session: operator });
  const frame: AdminShellSlots['frame'] = ({ session, children }) => <Passthrough key={session.user.id}><MountCounter onMount={onMount} />{children}</Passthrough>;
  const { p, rerender, fields } = mount({ frame }, { useHostSession: () => host });
  act(() => p.go('/records/r1'));
  act(() => p.go('/records/r2'));
  act(() => p.go('/'));
  expect(onMount).toHaveBeenCalledTimes(1);
  host = controller({ status: 'authenticated', session: { ...operator, user: { id: 'u2', username: 'other' } } });
  rerender(<AdminShell {...fields} useHostSession={() => host} slots={{ ...fields.slots, frame }} />);
  expect(onMount).toHaveBeenCalledTimes(2);
});
function Passthrough({ children }: { readonly children: ReactNode }): ReactNode { return <>{children}</>; }

it('beforeMain renders between the sidebar and the backdrop', () => {
  const { container } = mount({ beforeMain: <div data-testid="before-main" /> });
  fireEvent.click(screen.getByRole('button', { name: 'Open navigation' }));
  const root = container.firstElementChild!;
  const order = [...root.children].map((el) => el.getAttribute('data-testid') ?? el.className);
  expect(order.slice(0, 5)).toEqual(['skip-link', 'cms-nav scroll is-open', 'before-main', 'sidebar-backdrop', 'admin-main-col']);
});

it('assistantAside renders in place of the built-in aside, and wins when both are supplied', () => {
  const { container } = mount({ assistantAside: <aside data-testid="host-aside">Host dock</aside>, assistant: { content: <p>Pane</p>, label: 'Assistant', open: true } });
  expect(screen.getByTestId('host-aside')).toBeInTheDocument();
  expect(container.querySelector('.jini-admin-assistant-pane')).toBeNull();
  expect(screen.queryByText('Pane')).toBeNull();
  const root = container.firstElementChild!;
  expect(root.children[root.children.length - 1]).toBe(screen.getByTestId('host-aside'));
});

it('afterMain renders inside the main column, right after <main>', () => {
  mount({ afterMain: <div data-testid="after-main" /> });
  const main = screen.getByRole('main');
  expect(main.nextElementSibling).toBe(screen.getByTestId('after-main'));
  expect(main.parentElement).toHaveClass('admin-main-col');
});

it('ids: one host-set value reaches the skip link, the topbar toggle, the nav and main', () => {
  mount({}, { ids: { sidebar: 'admin-sidebar', main: 'main-content' } });
  expect(screen.getByRole('navigation')).toHaveAttribute('id', 'admin-sidebar');
  expect(screen.getByRole('main')).toHaveAttribute('id', 'main-content');
  expect(screen.getByRole('link', { name: 'Skip to content' })).toHaveAttribute('href', '#main-content');
  expect(screen.getByRole('button', { name: 'Open navigation' })).toHaveAttribute('aria-controls', 'admin-sidebar');
});

it('ids: absent, each id defaults to a generated value that is the same in all four places', () => {
  mount({});
  const nav = screen.getByRole('navigation');
  const main = screen.getByRole('main');
  expect(nav.id).toMatch(/-sidebar$/);
  expect(main.id).toMatch(/-main$/);
  expect(screen.getByRole('link', { name: 'Skip to content' })).toHaveAttribute('href', `#${main.id}`);
  expect(screen.getByRole('button', { name: 'Open navigation' })).toHaveAttribute('aria-controls', nav.id);
});

it('ids: a partial override keeps the other default', () => {
  mount({}, { ids: { main: 'main-content' } });
  expect(screen.getByRole('main')).toHaveAttribute('id', 'main-content');
  expect(screen.getByRole('navigation').id).toMatch(/-sidebar$/);
});
