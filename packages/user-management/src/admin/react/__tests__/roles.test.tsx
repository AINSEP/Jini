import { Suspense, StrictMode } from 'react';
import { render, screen, waitFor, fireEvent, within, act } from '@testing-library/react';
import userEventFactory from '@testing-library/user-event';
// Avoid one scheduled zero-delay timer per character on shared, CPU-contended runners.
// All input events and existing assertions still run; no timeout or test count changes.
const userEvent = userEventFactory.setup({ delay: null });
import { describe, it, expect, vi } from 'vitest';
import { createAdmin } from '@jini-ai/admin/core/module';
import { KitProvider, Button, createKit } from '@jini-ai/ui-kit/react';
import type { ConfirmViewProps, ResolvedKit } from '@jini-ai/ui-kit/react';
import { roles } from '../index.js';
import { createMemoryRolesApi } from '../../adapters/memory.js';
import type { RolesApiPort } from '../../ports.js';
import type { RoleRecord, PolicyRecord } from '../../models.js';
const role: RoleRecord = { id: 'r', workspaceId: 'w', name: 'Authors', isBuiltin: false };
const builtin: RoleRecord = { id: 'builtin', workspaceId: 'w', name: 'Owner', isBuiltin: true };
const policy: PolicyRecord = { id: 'p', workspaceId: 'w', name: 'Readers', description: 'Read things', isBuiltin: false, isFrozen: false };
async function mount({ permissions = [], api, kit, strict = false, omitPolicies = false }: {
    permissions?: string[];
    api?: RolesApiPort;
    kit?: ResolvedKit;
    strict?: boolean;
    omitPolicies?: boolean;
} = {}) {
    const feature = roles({});
    const port = api ?? createMemoryRolesApi({ workspaceId: 'w' }, { permissions: ['role.manage', 'content.read'], roles: [role, builtin], policies: [policy] });
    const admin = createAdmin({ modules: [feature], ports: { rolesApi: port } }, { permissions, ...(omitPolicies ? { omit: ['roles.roles.policies' as const] } : {}) });
    const { Page, tabs } = feature.react.pages.roles;
    const content = <KitProvider {...(kit ? { kit } : {})} needs={[feature.kitNeeds]} guard="off"><feature.react.Provider admin={admin}>
    <Suspense fallback="Loading…"><Page tabs={tabs} description={admin.describe().pages[0]!}/></Suspense>
  </feature.react.Provider></KitProvider>;
    // React 19's lazy page/tab retries must finish in an awaited act scope before queries.
    let rendered!: ReturnType<typeof render>;
    await act(async () => {
        rendered = render(strict ? <StrictMode>{content}</StrictMode> : content);
        await vi.dynamicImportSettled();
    });
    // The page's controller effect starts the second lazy import (the selected tab).
    await act(async () => { await vi.dynamicImportSettled(); });
    return { ...rendered, api: port, admin };
}
async function openRoleMenu() { await userEvent.click(await screen.findByRole('button', { name: 'Actions for role "Authors"' })); }
async function openPolicies() {
    const tab = await screen.findByRole('tab', { name: 'Policies' });
    // A tab switch starts another real lazy import; flush its Suspense retry as well.
    await userEvent.click(tab);
    await act(async () => { await vi.dynamicImportSettled(); });
    await screen.findByText('Readers');
}
async function openPolicyMenu() { await userEvent.click(await screen.findByRole('button', { name: 'Actions for policy "Readers"' })); }
describe('composable roles React screen', () => {
    it('loads a read-only screen without grants and exposes readable permissions without any write controls', async () => {
        const view = await mount();
        await screen.findByText('Authors');
        expect(screen.getByText(/Read-only/)).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Create role' })).toBeNull();
        expect(screen.queryByRole('button', { name: /Actions for role/ })).toBeNull();
        await openPolicies();
        expect(screen.queryByRole('button', { name: 'Create policy' })).toBeNull();
        await userEvent.click(screen.getByRole('button', { name: 'View permissions' }));
        await screen.findByText('No permissions yet.');
        expect(screen.queryByRole('button', { name: 'Add' })).toBeNull();
        expect(screen.queryByRole('textbox', { name: 'Permission' })).toBeNull();
        view.admin.dispose();
    });
    it('creates roles and policies, renames inline, and hides builtin/frozen mutation controls', async () => {
        const { api } = await mount({ permissions: ['role.manage'] });
        await screen.findByText('Authors');
        expect(screen.queryByRole('button', { name: 'Actions for role "Owner"' })).toBeNull();
        await userEvent.type(screen.getByRole('textbox', { name: 'Role name' }), 'Editors');
        await userEvent.click(screen.getByRole('button', { name: 'Create role' }));
        await screen.findByText('Editors');
        await openRoleMenu();
        await userEvent.click(screen.getByRole('menuitem', { name: 'Rename' }));
        const name = screen.getByRole('textbox', { name: 'Role new name' });
        await userEvent.clear(name);
        await userEvent.type(name, 'Writers');
        await userEvent.click(screen.getByRole('button', { name: 'Save' }));
        await screen.findByText('Writers');
        await openPolicies();
        await userEvent.type(screen.getByRole('textbox', { name: 'Policy name' }), 'Writers policy');
        await userEvent.click(screen.getByRole('button', { name: 'Create policy' }));
        await screen.findByText('Writers policy');
        expect((await api.listRoles({})).roles.map(r => r.name)).toEqual(['Writers', 'Owner', 'Editors']);
    });
    it('cancels role deletion before writing, then confirms it with consequence-aware actions', async () => {
        const { api } = await mount({ permissions: ['role.manage'] });
        await openRoleMenu();
        await userEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));
        const dialog = await screen.findByRole('alertdialog');
        expect(within(dialog).getByText(/Roles still assigned/)).toBeInTheDocument();
        const cancel = within(dialog).getByRole('button', { name: /Cancel/ });
        expect(cancel).toHaveFocus();
        await userEvent.click(cancel);
        expect((await api.listRoles({})).roles.some(r => r.id === 'r')).toBe(true);
        expect(screen.queryByRole('alertdialog')).toBeNull();
        await openRoleMenu();
        await userEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));
        await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: /^Delete — Delete role\?/ }));
        await waitFor(() => expect(screen.queryByText('Authors')).toBeNull());
        expect((await api.listRoles({})).roles.some(r => r.id === 'r')).toBe(false);
    });
    it('requires confirmation for revocation and policy deletion', async () => {
        const { api } = await mount({ permissions: ['role.manage'] });
        await openPolicies();
        await openPolicyMenu();
        await userEvent.click(screen.getByRole('menuitem', { name: 'Add permission' }));
        await screen.findByText('No permissions yet.');
        await userEvent.type(screen.getByRole('textbox', { name: 'Permission' }), 'content.read');
        await userEvent.type(screen.getByRole('textbox', { name: 'Resource type (optional)' }), 'article');
        await userEvent.click(screen.getByRole('button', { name: 'Add' }));
        await screen.findByText('content.read');
        await userEvent.click(screen.getByRole('button', { name: 'Remove permission content.read' }));
        expect((await api.listPolicyPermissions({ policyId: 'p' })).policyPermissions).toHaveLength(1);
        await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: /^Remove —/ }));
        await waitFor(() => expect(screen.queryByText('content.read')).toBeNull());
        expect((await api.listPolicyPermissions({ policyId: 'p' })).policyPermissions).toEqual([]);
        await openPolicyMenu();
        await userEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));
        await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: /^Delete — Delete policy\?/ }));
        await waitFor(() => expect(screen.queryByText('Readers')).toBeNull());
    });
    it('uses a host ConfirmDialog override and its guarded actions for deletion', async () => {
        function HouseConfirm({ controller: c }: ConfirmViewProps) { return c.open ? <div {...c.frameAttrs}><h2 {...c.titleAttrs}>{c.title}</h2><p>House confirmation</p><div>{c.body}</div><Button {...c.cancel}>Cancel house</Button><Button {...c.confirm}>Confirm house</Button></div> : null; }
        const kit = createKit({ components: { ConfirmDialog: HouseConfirm } }, { id: 'house', guard: 'off' });
        const { api } = await mount({ permissions: ['role.manage'], kit });
        await openRoleMenu();
        await userEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));
        await screen.findByText('House confirmation');
        await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: /^Delete —/ }));
        await waitFor(() => expect(screen.queryByText('Authors')).toBeNull());
        expect((await api.listRoles({})).roles.some(r => r.id === 'r')).toBe(false);
    });
    it('blocks duplicate confirm and cancellation while the destructive server write is pending', async () => {
        const api = createMemoryRolesApi({ workspaceId: 'w' }, { permissions: ['role.manage'], roles: [role] });
        let resolve!: () => void;
        const pending = new Promise<void>(r => { resolve = r; });
        const del = vi.fn(async (r: {
            roleId: string;
        }) => { await pending; await api.deleteRole(r); });
        await mount({ permissions: ['role.manage'], api: { ...api, deleteRole: del } });
        await openRoleMenu();
        await userEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));
        const dialog = screen.getByRole('alertdialog'), confirm = within(dialog).getByRole('button', { name: /^Delete —/ });
        fireEvent.click(confirm);
        fireEvent.click(confirm);
        fireEvent.click(within(dialog).getByRole('button', { name: /Cancel/ }));
        fireEvent(dialog, new Event('cancel', { cancelable: true }));
        expect(del).toHaveBeenCalledTimes(1);
        expect(screen.getByRole('alertdialog')).toBeInTheDocument();
        expect(confirm).toBeDisabled();
        await act(async () => { resolve(); await pending; });
        await waitFor(() => expect(screen.queryByText('Authors')).toBeNull());
    });
    it('hides omitted tabs and disposes StrictMode controllers with abort signals', async () => {
        const api = createMemoryRolesApi({ workspaceId: 'w' }, { roles: [role] });
        const signals: AbortSignal[] = [];
        const list = vi.fn((r: Record<string, never>, o?: {
            signal?: AbortSignal;
        }) => { if (o?.signal)
            signals.push(o.signal); return api.listRoles(r, o); });
        const view = await mount({ api: { ...api, listRoles: list }, strict: true, omitPolicies: true });
        await screen.findByText('Authors');
        expect(screen.queryByRole('tab', { name: 'Policies' })).toBeNull();
        expect(list).toHaveBeenCalledTimes(2);
        expect(signals[0]!.aborted).toBe(true);
        view.unmount();
        expect(signals.every(s => s.aborted)).toBe(true);
        view.admin.dispose();
    });
});
