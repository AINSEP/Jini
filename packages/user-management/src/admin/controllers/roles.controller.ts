import type { RolesApiPort } from '../ports.js';
import type { RolesState, RolesDraft, RoleRecord, PolicyRecord, DestructiveTarget } from '../models.js';
import { canManageRoles, mutableRole, mutablePolicy, describeRolesError } from '../rules.js';
import { rolesMessagesEn as m } from '../messages.en.js';
const initial: RolesState = {
    roles: null, policies: null, error: null, rowError: null, roleError: null, policyError: null,
    roleName: '', policyName: '', policyDescription: '', roleSaving: false, policySaving: false, rowSavingId: null,
    editingRoleId: null, editingRoleName: '', editingPolicyId: null, editingPolicyName: '', editingPolicyDescription: '',
    permissionPolicyId: null, permissionInput: '', resourceTypeInput: '', permissionRows: Object.freeze([]), permissionsLoading: false,
    removingPermissionId: null, pending: null, confirming: false,
};
/** One controller backs both tabs: two hook calls would double reads and split shared errors.
 * The lists always refresh together; permission edits only refresh the currently open panel.
 * Controller methods use synchronous state, never React state updater side effects. */
export function createRolesController({ api }: {
    api: RolesApiPort;
}, { permissions = [] }: {
    permissions?: readonly string[];
} = {}) {
    const grants = Object.freeze([...permissions]);
    let state: RolesState = Object.freeze({ ...initial }), disposed = false, listGeneration = 0, permissionGeneration = 0, panelGeneration = 0;
    const listeners = new Set<() => void>();
    const abort = new AbortController();
    const call = { signal: abort.signal };
    const set = (patch: Partial<RolesState>) => {
        if (disposed) return;
        const immutablePatch = patch.permissionRows ? {...patch, permissionRows: Object.freeze([...patch.permissionRows])} : patch;
        state = Object.freeze({ ...state, ...immutablePatch });
        for (const listener of listeners) listener();
    };
    const report = (error: unknown, fallback: string) => describeRolesError({ error, fallback });
    const gate = () => { if (disposed || state.confirming)
        return false; if (!canManageRoles({ permissions: grants })) {
        set({ rowError: m.forbidden });
        return false;
    } return true; };
    const role = (id: string) => state.roles?.find(r => r.id === id);
    const policy = (id: string) => state.policies?.find(p => p.id === id);
    const roleGate = (r: RoleRecord | undefined) => gate() && !!r && (mutableRole({ role: r }) || (set({ rowError: m.immutable }), false));
    const policyGate = (p: PolicyRecord | undefined) => gate() && !!p && (mutablePolicy({ policy: p }) || (set({ rowError: m.immutable }), false));
    const rows = <T extends object>(items: T[]): readonly T[] => Object.freeze(items.map(r => Object.freeze({ ...r })));
    async function load(_required: Record<string, never>, _optional: Record<string, never> = {}) {
        if (disposed)
            return;
        const generation = ++listGeneration;
        set({ error: null });
        try {
            const [r, p] = await Promise.all([api.listRoles({}, call), api.listPolicies({}, call)]);
            if (generation === listGeneration)
                set({ roles: rows(r.roles), policies: rows(p.policies) });
        }
        catch (error) {
            if (generation === listGeneration)
                set({ error: report(error, 'Failed to load roles/policies.') });
        }
    }
    async function loadPermissions({ policyId }: {
        policyId: string;
    }, _optional: Record<string, never> = {}) {
        if (disposed || state.permissionPolicyId !== policyId)
            return;
        // Start order, rather than completion order, owns rows AND failures. Closing also invalidates.
        const generation = ++permissionGeneration;
        set({ permissionsLoading: true });
        try {
            const result = await api.listPolicyPermissions({ policyId }, call);
            if (generation === permissionGeneration && state.permissionPolicyId === policyId)
                set({ permissionRows: rows(result.policyPermissions) });
        }
        catch (error) {
            if (generation === permissionGeneration && state.permissionPolicyId === policyId)
                set({ permissionRows: [], rowError: report(error, 'Failed to load permissions.') });
        }
        finally {
            if (generation === permissionGeneration)
                set({ permissionsLoading: false });
        }
    }
    async function togglePermissions({ policyId }: {
        policyId: string;
    }, _optional: Record<string, never> = {}) {
        if (disposed || !policy(policyId))
            return;
        const next = state.permissionPolicyId === policyId ? null : policyId;
        ++panelGeneration;
        ++permissionGeneration;
        // Clear first so reopening cannot flash the previous policy's permissions.
        set({ permissionPolicyId: next, permissionRows: [], permissionsLoading: false, permissionInput: '', resourceTypeInput: '', rowError: null });
        if (next)
            await loadPermissions({ policyId: next });
    }
    async function createRole(_required: Record<string, never>, _optional: Record<string, never> = {}) {
        if (!gate() || state.roleSaving)
            return false;
        const name = state.roleName;
        set({ roleSaving: true, roleError: null });
        try {
            await api.createRole({ name }, call);
            if (state.roleName === name)
                set({ roleName: '' });
            await load({});
            return !disposed;
        }
        catch (error) {
            set({ roleError: report(error, 'Failed to create role.') });
            return false;
        }
        finally {
            set({ roleSaving: false });
        }
    }
    async function createPolicy(_required: Record<string, never>, _optional: Record<string, never> = {}) {
        if (!gate() || state.policySaving)
            return false;
        const name = state.policyName, description = state.policyDescription;
        set({ policySaving: true, policyError: null });
        try {
            await api.createPolicy({ name }, { ...call, ...(description ? { description } : {}) });
            if (state.policyName === name && state.policyDescription === description)
                set({ policyName: '', policyDescription: '' });
            await load({});
            return !disposed;
        }
        catch (error) {
            set({ policyError: report(error, 'Failed to create policy.') });
            return false;
        }
        finally {
            set({ policySaving: false });
        }
    }
    function editRole({ role: r }: {
        role: RoleRecord;
    }, _optional: Record<string, never> = {}) { if (roleGate(role(r.id)))
        set({ editingRoleId: r.id, editingRoleName: r.name, rowError: null }); }
    function editPolicy({ policy: p }: {
        policy: PolicyRecord;
    }, _optional: Record<string, never> = {}) { if (policyGate(policy(p.id)))
        set({ editingPolicyId: p.id, editingPolicyName: p.name, editingPolicyDescription: p.description ?? '', rowError: null }); }
    async function saveRole(_required: Record<string, never>, _optional: Record<string, never> = {}) {
        const id = state.editingRoleId, name = state.editingRoleName;
        if (!id || !roleGate(role(id)) || state.rowSavingId)
            return false;
        set({ rowSavingId: id, rowError: null });
        try {
            await api.updateRole({ roleId: id, name }, call);
            // A late save must not close another row's newer edit.
            if (state.editingRoleId === id && state.editingRoleName === name)
                set({ editingRoleId: null });
            await load({});
            return !disposed;
        }
        catch (error) {
            set({ rowError: report(error, 'Failed to rename role.') });
            return false;
        }
        finally {
            if (state.rowSavingId === id)
                set({ rowSavingId: null });
        }
    }
    async function savePolicy(_required: Record<string, never>, _optional: Record<string, never> = {}) {
        const id = state.editingPolicyId, name = state.editingPolicyName, description = state.editingPolicyDescription;
        if (!id || !policyGate(policy(id)) || state.rowSavingId)
            return false;
        set({ rowSavingId: id, rowError: null });
        try {
            await api.updatePolicy({ policyId: id }, { ...call, name, description });
            if (state.editingPolicyId === id && state.editingPolicyName === name && state.editingPolicyDescription === description)
                set({ editingPolicyId: null });
            await load({});
            return !disposed;
        }
        catch (error) {
            set({ rowError: report(error, 'Failed to update policy.') });
            return false;
        }
        finally {
            if (state.rowSavingId === id)
                set({ rowSavingId: null });
        }
    }
    async function writePermission(_required: Record<string, never>, _optional: Record<string, never> = {}) {
        const id = state.permissionPolicyId, permission = state.permissionInput, resourceType = state.resourceTypeInput;
        if (!id || !permission || !policyGate(policy(id)) || state.rowSavingId)
            return false;
        const generation = panelGeneration;
        set({ rowSavingId: id, rowError: null });
        try {
            await api.writePolicyPermission({ policyId: id, permission }, { ...call, ...(resourceType ? { resourceType } : {}) });
            // Ordering alone cannot protect a trailing refresh: it always mints the newest generation.
            // Check the CURRENT panel identity, and preserve a newer draft even on the same panel.
            if (generation === panelGeneration && state.permissionInput === permission && state.resourceTypeInput === resourceType)
                set({ permissionInput: '', resourceTypeInput: '' });
            if (state.permissionPolicyId === id)
                await loadPermissions({ policyId: id });
            return !disposed;
        }
        catch (error) {
            set({ rowError: report(error, 'Failed to add permission.') });
            return false;
        }
        finally {
            if (state.rowSavingId === id)
                set({ rowSavingId: null });
        }
    }
    function targetGate(target: DestructiveTarget): boolean {
        if (target.kind === 'role')
            return roleGate(role(target.role.id));
        return policyGate(policy(target.kind === 'policy' ? target.policy.id : target.policyId));
    }
    function requestDestructive({ target }: {
        target: DestructiveTarget;
    }, _optional: Record<string, never> = {}) {
        if (state.confirming || !targetGate(target))
            return;
        if (target.kind === 'permission' && (state.permissionPolicyId !== target.policyId || !state.permissionRows.some(r => r.id === target.row.id)))
            return;
        // The menu closes after one click; shell confirmation survives that closure. Revoke also
        // needs confirmation: removing from an attached policy immediately changes live authority.
        const captured: DestructiveTarget = target.kind === 'role' ? Object.freeze({ kind: 'role', role: Object.freeze({ ...target.role }) }) : target.kind === 'policy' ? Object.freeze({ kind: 'policy', policy: Object.freeze({ ...target.policy }) }) : Object.freeze({ kind: 'permission', policyId: target.policyId, row: Object.freeze({ ...target.row }) });
        set({ pending: captured, rowError: null });
    }
    function cancelDestructive(_required: Record<string, never>, _optional: Record<string, never> = {}) { if (!state.confirming)
        set({ pending: null }); }
    async function confirmDestructive(_required: Record<string, never>, _optional: Record<string, never> = {}) {
        const target = state.pending;
        if (!target || state.confirming || state.rowSavingId || !targetGate(target))
            return false;
        set({ confirming: true, rowError: null });
        try {
            if (target.kind === 'role') {
                await api.deleteRole({ roleId: target.role.id }, call);
                await load({});
            }
            else if (target.kind === 'policy') {
                await api.deletePolicy({ policyId: target.policy.id }, call);
                if (state.permissionPolicyId === target.policy.id) {
                    ++permissionGeneration;
                    ++panelGeneration;
                    set({ permissionPolicyId: null, permissionRows: [], permissionsLoading: false });
                }
                await load({});
            }
            else {
                set({ removingPermissionId: target.row.id });
                await api.removePolicyPermission({ policyId: target.policyId, policyPermissionId: target.row.id }, call);
                if (state.permissionPolicyId === target.policyId)
                    await loadPermissions({ policyId: target.policyId });
            }
            return !disposed;
        }
        catch (error) {
            set({ rowError: report(error, target.kind === 'permission' ? 'Failed to remove permission.' : `Failed to delete ${target.kind}.`) });
            return false;
        }
        finally {
            if (state.pending === target)
                set({ pending: null });
            set({ confirming: false, removingPermissionId: null });
        }
    }
    return {
        getSnapshot(_required: Record<string, never> = {}, _optional: Record<string, never> = {}) { return state; },
        subscribe({ listener }: {
            listener: () => void;
        }, _optional: Record<string, never> = {}) { if (!disposed)
            listeners.add(listener); return () => { listeners.delete(listener); }; },
        dispose(_required: Record<string, never> = {}, _optional: Record<string, never> = {}) { if (disposed)
            return; disposed = true; abort.abort(); ++listGeneration; ++permissionGeneration; listeners.clear(); },
        setDraft({ patch }: {
            patch: Partial<RolesDraft>;
        }, _optional: Record<string, never> = {}) { set(patch); },
        cancelEdit({ kind }: {
            kind: 'role' | 'policy';
        }, _optional: Record<string, never> = {}) { set(kind === 'role' ? { editingRoleId: null } : { editingPolicyId: null }); },
        load, loadPermissions, togglePermissions, createRole, createPolicy, editRole, editPolicy, saveRole, savePolicy, writePermission,
        requestDestructive, cancelDestructive, confirmDestructive,
    };
}
export type RolesController = ReturnType<typeof createRolesController>;
