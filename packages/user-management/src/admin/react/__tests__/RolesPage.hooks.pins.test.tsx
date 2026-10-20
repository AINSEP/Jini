import { lazy } from 'react';
import type { ReactNode, ReactElement } from 'react';
import { act, renderHook, waitFor, cleanup } from '@testing-library/react';
import { afterEach, describe, it, expect } from 'vitest';
import { createAdmin } from '@jini-ai/admin/core/module';
import { roles } from '../index.js';
import { useRolesPage } from '../hooks/RolesPage.hooks.js';
import type { RolesPageProps, RolesTabProps } from '../hooks/RolesBinding.hooks.js';
import { createMemoryRolesApi } from '../../adapters/memory.js';
import { role, policy } from '../../__tests__/people.fixtures.js';

afterEach(cleanup);

type Description = RolesPageProps['description'];
type Tabs = RolesPageProps['tabs'];
function TabStub(_props: RolesTabProps) { return null; }
const stubTabs: Tabs = { roles: lazy(async () => ({ default: TabStub })), policies: lazy(async () => ({ default: TabStub })) };

// The real binding scope over the memory adapter; tabs and description are varied per test.
function mount({ permissions = ['role.manage'], tabs = stubTabs, describe: shape = d => d }: { permissions?: string[]; tabs?: Tabs; describe?: (d: Description) => Description } = {}) {
  const feature = roles({});
  const api = createMemoryRolesApi({ workspaceId: 'w' }, { permissions: ['role.manage'], roles: [role], policies: [policy] });
  const admin = createAdmin({ modules: [feature], ports: { rolesApi: api } }, { permissions });
  const description = shape(admin.describe().pages[0]!);
  const wrapper = ({ children }: { children: ReactNode }) => <feature.react.Provider admin={admin}>{children}</feature.react.Provider>;
  return { api, description, ...renderHook(() => useRolesPage({ tabs, description }), { wrapper }) };
}

describe('useRolesPage (pins)', () => {
  it('before the controller attaches, the view is null, the confirm is closed and retry/cancel/confirm are no-ops', async () => {
    const seen: ReturnType<typeof useRolesPage>[] = [];
    const feature = roles({});
    const api = createMemoryRolesApi({ workspaceId: 'w' }, { permissions: ['role.manage'], roles: [role], policies: [policy] });
    const admin = createAdmin({ modules: [feature], ports: { rolesApi: api } }, { permissions: ['role.manage'] });
    const wrapper = ({ children }: { children: ReactNode }) => <feature.react.Provider admin={admin}>{children}</feature.react.Provider>;
    renderHook(() => { const v = useRolesPage({ tabs: stubTabs, description: admin.describe().pages[0]! }); seen.push(v); return v; }, { wrapper });
    const initial = seen[0]!;
    expect([initial.controller, initial.state, initial.view]).toEqual([null, null, null]);
    expect(initial.confirm).toMatchObject({ open: false, pending: false, title: 'Delete role?', body: '', confirmLabel: 'Delete', tone: 'danger', consequence: 'cannot be undone', agentMayConfirm: false });
    expect(() => initial.retry()).not.toThrow();
    expect(() => initial.confirm.onCancel({})).not.toThrow();
    await expect(initial.confirm.onConfirm({})).resolves.toBeUndefined();
  });

  it('opens the destructive confirmation for a pending role and cancels it through the controller', async () => {
    const { result } = mount();
    await waitFor(() => expect(result.current.state?.roles).not.toBeNull());
    act(() => result.current.controller!.requestDestructive({ target: { kind: 'role', role } }));
    expect(result.current.confirm).toMatchObject({ open: true, pending: false, title: 'Delete role?', body: 'Delete "Writer"? Roles still assigned to users cannot be deleted.' });
    act(() => result.current.confirm.onCancel({}));
    expect(result.current.confirm.open).toBe(false);
  });

  it('confirming deletes the pending role through the controller', async () => {
    const { result, api } = mount();
    await waitFor(() => expect(result.current.state?.roles).not.toBeNull());
    act(() => result.current.controller!.requestDestructive({ target: { kind: 'role', role } }));
    await act(async () => { await result.current.confirm.onConfirm({}); });
    expect((await api.listRoles({})).roles.map(r => r.id)).toEqual([]);
  });

  it('a caller without role.manage cannot manage', async () => {
    const { result } = mount({ permissions: ['content.read'] });
    expect(result.current.canManage).toBe(false);
  });

  it('drops a described tab that the host omitted from the tab components', () => {
    const { result } = mount({ tabs: { policies: stubTabs.policies! } });
    expect(result.current.items.map(i => i.id)).toEqual(['policies']);
    expect(result.current.tab).toBe('policies');
  });

  it('drops a tab the description marks invisible', () => {
    const { result } = mount({ describe: d => ({ ...d, tabs: d.tabs.map(t => ({ ...t, visible: !t.id.endsWith('.roles') })) }) });
    expect(result.current.items.map(i => i.id)).toEqual(['policies']);
  });

  it('a visible page with no usable tabs is not hidden but has no tabs and no active tab', () => {
    const { result } = mount({ tabs: {} });
    expect([result.current.hidden, result.current.noTabs, result.current.tab, result.current.items]).toEqual([false, true, '', []]);
  });

  it('labels tabs from the description and renders only the active tab with its params', () => {
    const { result, description } = mount({ describe: d => ({ ...d, tabs: d.tabs.map(t => ({ ...t, params: { from: t.id } })) }) });
    expect(result.current.items.map(i => i.label)).toEqual(description.tabs.map(t => t.label));
    const [active, other] = result.current.items;
    expect((active!.content as ReactElement<RolesTabProps>).props.params).toEqual({ from: description.tabs[0]!.id });
    expect(active!.content).toMatchObject({ type: stubTabs.roles });
    expect(other!.content).toBeNull();
  });

  it('changeTab without a host listener only selects locally', () => {
    const { result } = mount();
    expect(() => act(() => result.current.changeTab({ value: 'policies' }))).not.toThrow();
    expect(result.current.tab).toBe('policies');
  });
});
