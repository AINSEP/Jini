import { cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { AdminNavGroup } from '../../../core/manifest/rules.js';
import { Sidebar } from '../../components/Sidebar.js';
import { AdminShell } from '../AdminShell.js';
import type { AdminShellHostProps, AdminShellPanel, AdminShellSlots } from '../types.js';
import { authenticated, baseFields, operator, panels, ports, controller, renderWithKit as render } from './shell-fixture.js';

// J2 step 3: `slots.sidebar` replaces the shell's fixed sidebar arrangement with a host-composed one.
beforeEach(() => localStorage.clear());
afterEach(cleanup);

type SidebarSlot = NonNullable<AdminShellSlots['sidebar']>;

function mount(sidebar: SidebarSlot, extra: Partial<AdminShellHostProps> = {}, path = '/') {
  const p = ports(path);
  const fields = baseFields(p);
  const view = render(<AdminShell {...fields} useHostSession={authenticated()} {...extra} slots={{ ...fields.slots, sidebar }} />);
  return { p, ...view };
}

/** A host arrangement the fixed shell cannot express: mobile header, custom first group, rail toggle between nav slices, footer. */
const hostSidebar: SidebarSlot = ({ nav, sidebarProps, setDrawerOpen }) => (
  <Sidebar {...sidebarProps}>
    <Sidebar.MobileHeader onClose={() => setDrawerOpen(false)} />
    <div data-testid="first-group">Host first group</div>
    <Sidebar.RailToggle expandLabel="Expand" collapseLabel="Collapse" />
    <Sidebar.Nav groups={nav} />
    <Sidebar.Footer><p>Host footer</p></Sidebar.Footer>
  </Sidebar>
);

it('renders the host composition in the place of the built-in sidebar, in the host DOM order', () => {
  const { container } = mount(hostSidebar);
  const nav = screen.getByRole('navigation', { name: 'Navigation' });
  const order = [...nav.querySelectorAll('.cms-nav-mobile-head, [data-testid="first-group"], .cms-rail-toggle-row, .cms-section, .cms-foot')]
    .map((el) => el.className || (el as HTMLElement).dataset.testid);
  expect(order).toEqual(['cms-nav-mobile-head', 'first-group', 'cms-rail-toggle-row', 'cms-section', 'cms-section', 'cms-foot']);
  expect(screen.getByText('Host footer')).toBeInTheDocument();
  expect(screen.getAllByRole('navigation')).toHaveLength(1);
  expect(container.querySelector('.jini-admin-main-col')).not.toBeNull();
});

it('hands the slot the visible, translated nav and exactly the props the built-in sidebar passes', () => {
  const slot = vi.fn<SidebarSlot>(hostSidebar);
  const translateNav = vi.fn(({ groups }: { groups: readonly AdminNavGroup[] }) => groups);
  mount(slot, { translateNav, railDefaultCollapsed: true, adminBase: '/console' }, '/records/r1');
  const args = slot.mock.calls[0]![0];
  expect(args.nav).toBe(translateNav.mock.results[0]!.value);
  expect(args.sidebarProps).toMatchObject({
    activeId: 'records', base: '/console', open: false, label: 'Navigation', railStorageKey: 'fixture-rail', railDefaultCollapsed: true,
  });
  expect(typeof args.sidebarProps.id).toBe('string');
  expect(args.session).toBe(operator);
  expect(typeof args.logout).toBe('function');
});

it('sidebarProps.activeId equals the routed panel id, also when access is denied', () => {
  const gated: AdminShellPanel = { id: 'secret', description: 'Manage secret.', render: () => <h1>Secret</h1>, nav: { label: 'Secret' }, permissions: ['secret.read'] };
  const slot = vi.fn<SidebarSlot>(hostSidebar);
  const p = ports('/secret');
  const fields = baseFields(p);
  const noGrants = { ...controller({ status: 'authenticated', session: { ...operator, effectivePermissions: [] } }) };
  render(<AdminShell {...fields} panels={[...panels, gated]} useHostSession={() => noGrants} slots={{ ...fields.slots, sidebar: slot }} />);
  expect(slot.mock.calls.at(-1)![0].sidebarProps.activeId).toBe('secret');
  expect(slot.mock.calls.at(-1)![0].route.panelId).toBe('secret');
});

it('setDrawerOpen(false) closes the drawer the topbar toggle opened: one drawer state, not two', () => {
  const { container } = mount(hostSidebar);
  const toggle = screen.getByRole('button', { name: 'Open navigation' });
  fireEvent.click(toggle);
  expect(toggle).toHaveAttribute('aria-expanded', 'true');
  expect(screen.getByRole('navigation')).toHaveClass('is-open');
  fireEvent.click(container.querySelector('.cms-nav-close')!);
  expect(toggle).toHaveAttribute('aria-expanded', 'false');
  expect(screen.getByRole('navigation')).not.toHaveClass('is-open');
});
