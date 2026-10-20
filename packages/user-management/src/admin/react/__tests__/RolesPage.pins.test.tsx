import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { afterEach, describe, it, expect, vi } from 'vitest';
import { KitProvider } from '@jini-ai/ui-kit/react';
import { createAdmin } from '@jini-ai/admin/core/module';
import { roles, rolesKitNeeds } from '../index.js';
import { useRolesPage } from '../hooks/RolesPage.hooks.js';
import RolesPage from '../pages/RolesPage.js';
import { createRolesController } from '../../controllers/roles.controller.js';
import { createMemoryRolesApi } from '../../adapters/memory.js';
import type { RolesState } from '../../models.js';
import { role, policy } from '../../__tests__/people.fixtures.js';

// The page is a pure renderer of its page hook; the hook is replaced by a typed view model so
// every gate and notice branch is driven directly. The hook itself is pinned in its own suite.
vi.mock('../hooks/RolesPage.hooks.js', async importOriginal => ({ ...await importOriginal<typeof import('../hooks/RolesPage.hooks.js')>(), useRolesPage: vi.fn() }));
type RolesPageView = ReturnType<typeof useRolesPage>;

afterEach(cleanup);

const feature = roles({});
const rolesApi = createMemoryRolesApi({ workspaceId: 'w' }, { permissions: ['role.manage'], roles: [role], policies: [policy] });
const admin = createAdmin({ modules: [feature], ports: { rolesApi } }, { permissions: ['role.manage'] });
const props = { tabs: feature.react.pages.roles.tabs, description: admin.describe().pages[0]! };
const controller = createRolesController({ api: rolesApi }, { permissions: ['role.manage'] });
const loaded: RolesState = { ...controller.getSnapshot(), roles: [role], policies: [policy] };

function view(overrides: Partial<RolesPageView> = {}, stateOverrides: Partial<RolesState> = {}): RolesPageView {
  const state = { ...loaded, ...stateOverrides };
  return { controller, state, canManage: true, items: [{ id: 'roles', label: 'Roles', content: <p>Roles tab body</p> }], tab: 'roles',
    confirm: { open: false, title: 'Delete role?', body: '', confirmLabel: 'Delete', tone: 'danger', consequence: 'cannot be undone', pending: false, agentMayConfirm: false, onConfirm: async () => {}, onCancel: () => {} },
    hidden: false, noTabs: false, view: { controller, state, canManage: true }, changeTab: vi.fn(), retry: vi.fn(), ...overrides };
}
function mount(v: RolesPageView) {
  vi.mocked(useRolesPage).mockReturnValue(v);
  return render(<KitProvider needs={[rolesKitNeeds]} guard="off"><RolesPage {...props}/></KitProvider>);
}

describe('RolesPage (pins)', () => {
  it('passes the page props to the page hook', () => {
    mount(view());
    expect(vi.mocked(useRolesPage)).toHaveBeenCalledWith(props);
  });

  it('a hidden page says roles administration is unavailable', () => {
    mount(view({ hidden: true }));
    expect(screen.getByText('Roles administration is unavailable.')).toBeInTheDocument();
    expect(screen.queryByRole('heading')).toBeNull();
  });

  it('shows the loading spinner before the controller publishes state', () => {
    mount(view({ state: null, view: null }));
    expect(screen.getByLabelText('Loading roles & permissions…')).toBeInTheDocument();
  });

  it('a load error shows the message and a retry button that retries', () => {
    const retry = vi.fn();
    mount(view({ retry }, { error: 'Roles failed to load.' }));
    expect(screen.getByText('Roles failed to load.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('keeps the spinner while roles are still loading', () => {
    mount(view({}, { roles: null }));
    expect(screen.getByLabelText('Loading roles & permissions…')).toBeInTheDocument();
  });

  it('keeps the spinner while policies are still loading', () => {
    mount(view({}, { policies: null }));
    expect(screen.getByLabelText('Loading roles & permissions…')).toBeInTheDocument();
  });

  it('keeps the spinner when state exists without a page view', () => {
    mount(view({ view: null }));
    expect(screen.getByLabelText('Loading roles & permissions…')).toBeInTheDocument();
  });

  it('renders the shell header and the active tab for a manager, with no read-only notice', () => {
    mount(view());
    expect(screen.getByRole('heading', { name: 'Roles & Permissions' })).toBeInTheDocument();
    expect(screen.getByText('Define roles and policies here. Assign them to people in Users.')).toBeInTheDocument();
    expect(screen.getByText('Roles tab body')).toBeInTheDocument();
    expect(screen.queryByText('Read-only: managing roles requires role.manage.')).toBeNull();
  });

  it('a non-manager sees the read-only notice', () => {
    mount(view({ canManage: false }));
    expect(screen.getByText('Read-only: managing roles requires role.manage.')).toBeInTheDocument();
  });

  it('shows a shared row error', () => {
    mount(view({}, { rowError: 'Failed to rename role.' }));
    expect(screen.getByText('Failed to rename role.')).toBeInTheDocument();
  });

  it('says no tabs are enabled instead of rendering tabs', () => {
    mount(view({ noTabs: true, items: [] }));
    expect(screen.getByText('No roles tabs are enabled.')).toBeInTheDocument();
    expect(screen.queryByRole('tablist')).toBeNull();
  });

  it('keeps the confirmation dialog mounted and open when one is pending', () => {
    mount(view({ confirm: { ...view().confirm, open: true } }));
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
  });
});
