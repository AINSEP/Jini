import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { afterEach, describe, it, expect, vi } from 'vitest';
import { createAdmin } from '@jini-ai/admin/core/module';
import { KitProvider } from '@jini-ai/ui-kit/react';
import { users, usersKitNeeds } from '../index.js';
import { useUsersPage } from '../hooks/UsersPage.hooks.js';
import UsersPage from '../pages/UsersPage.js';
import { createUsersController } from '../../controllers/users.controller.js';
import type { UsersState } from '../../models.js';
import { fixtures, owner, role, policy } from '../../__tests__/people.fixtures.js';

// The page is a pure renderer of its page hook; the hook is replaced by a typed view model so
// every gate and notice branch is driven directly. The hook itself is pinned in its own suite.
vi.mock('../hooks/UsersPage.hooks.js', async importOriginal => ({ ...await importOriginal<typeof import('../hooks/UsersPage.hooks.js')>(), useUsersPage: vi.fn() }));
type UsersPageView = ReturnType<typeof useUsersPage>;

afterEach(cleanup);

const ports = fixtures();
const feature = users({});
const admin = createAdmin({ modules: [feature], ports: { usersApi: ports.api, usersSafety: ports.safety } }, { permissions: ['*'] });
const props = { tabs: feature.react.pages.users.tabs, description: admin.describe().pages[0]! };
const controller = createUsersController({ api: ports.api, safety: ports.safety }, { permissions: ['*'] });
const loaded: UsersState = { ...controller.getSnapshot({}), users: [owner], roles: [role], policies: [policy] };

function view(overrides: Partial<UsersPageView> = {}, stateOverrides: Partial<UsersState> = {}): UsersPageView {
  const state = { ...loaded, ...stateOverrides };
  return { content: <p>Users tab body</p>, controller, state, visible: true, view: { controller, state, permissions: ['*'] }, readOnly: false, retry: vi.fn(), ...overrides };
}
function mount(v: UsersPageView) {
  vi.mocked(useUsersPage).mockReturnValue(v);
  return render(<KitProvider needs={[usersKitNeeds]} guard="off"><UsersPage {...props}/></KitProvider>);
}

describe('UsersPage (pins)', () => {
  it('passes the page props to the page hook', () => {
    mount(view());
    expect(vi.mocked(useUsersPage)).toHaveBeenCalledWith(props);
  });

  it('an invisible page says users administration is unavailable', () => {
    mount(view({ visible: false }));
    expect(screen.getByText('Users administration is unavailable.')).toBeInTheDocument();
    expect(screen.queryByRole('heading')).toBeNull();
  });

  it('shows the loading spinner before the controller publishes state', () => {
    mount(view({ state: null, view: null }));
    expect(screen.getByLabelText('Loading users…')).toBeInTheDocument();
  });

  it('a load error shows the message and a retry button that retries', () => {
    const retry = vi.fn();
    mount(view({ retry }, { error: 'Users failed to load.' }));
    expect(screen.getByText('Users failed to load.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('keeps the spinner when state exists without a page view', () => {
    mount(view({ view: null }));
    expect(screen.getByLabelText('Loading users…')).toBeInTheDocument();
  });

  it('keeps the spinner while users are still loading', () => {
    mount(view({}, { users: null }));
    expect(screen.getByLabelText('Loading users…')).toBeInTheDocument();
  });

  it('keeps the spinner while roles are still loading', () => {
    mount(view({}, { roles: null }));
    expect(screen.getByLabelText('Loading users…')).toBeInTheDocument();
  });

  it('keeps the spinner while policies are still loading', () => {
    mount(view({}, { policies: null }));
    expect(screen.getByLabelText('Loading users…')).toBeInTheDocument();
  });

  it('renders the shell header, help, protected notice and tab content, with no read-only notice', () => {
    mount(view());
    expect(screen.getByText('People')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Users' })).toBeInTheDocument();
    expect(screen.getByText("No 'forgot password' email yet. If someone is locked out, the owner can reset their password here.")).toBeInTheDocument();
    expect(screen.getByText('Only an owner can modify an owner. Unresolved owner status prevents changes.')).toBeInTheDocument();
    expect(screen.getByText('Users tab body')).toBeInTheDocument();
    expect(screen.queryByText(/^Read-only/)).toBeNull();
  });

  it('a read-only caller sees the read-only notice', () => {
    mount(view({ readOnly: true }));
    expect(screen.getByText('Read-only — user administration is unavailable with your current grants.')).toBeInTheDocument();
  });

  it('shows a shared row error', () => {
    mount(view({}, { rowError: 'Failed to disable user.' }));
    expect(screen.getByText('Failed to disable user.')).toBeInTheDocument();
  });

  it('shows a success notice', () => {
    mount(view({}, { notice: 'User created.' }));
    expect(screen.getByText('User created.')).toBeInTheDocument();
  });

  it('keeps the confirmation dialog mounted and open when one is pending', () => {
    mount(view({}, { pending: { kind: 'disable', user: owner } }));
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
  });
});
