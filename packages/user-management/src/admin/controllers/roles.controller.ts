import type { RolesApiPort } from '../ports.js';
import type { RolesState, RolesDraft, RoleRecord, PolicyRecord, DestructiveTarget } from '../models.js';
import { canManageRoles, mutableRole, mutablePolicy, describeRolesError } from '../rules.js';
import { rolesMessagesEn as m } from '../messages.en.js';
import { createControllerStore } from './controller-store.js';
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
    const store = createControllerStore<RolesState>({ initial });
    const read = store.getSnapshot, call = store.call;
    let listGeneration = 0, permissionGeneration = 0, panelGeneration = 0;
    const set = (patch: Partial<RolesState>) => store.set({ patch: patch.permissionRows ? { ...patch, permissionRows: Object.freeze([...patch.permissionRows]) } : patch });
    const report = (error: unknown, fallback: string) => describeRolesError({ error, fallback });
    const gate = () => {
        if (!store.active({}) || read({}).confirming) {
            return false;
        }
        if (!canManageRoles({ permissions: grants })) {
            set({ rowError: m.forbidden });
            return false;
        } return true;
    };
    const role = (id: string) => read({}).roles?.find(r => r.id === id);
    const policy = (id: string) => read({}).policies?.find(p => p.id === id);
    const roleGate = (r: RoleRecord | undefined) => gate() && !!r && (mutableRole({ role: r }) || (set({ rowError: m.immutable }), false));
    const policyGate = (p: PolicyRecord | undefined) => gate() && !!p && (mutablePolicy({ policy: p }) || (set({ rowError: m.immutable }), false));
    const rows = <T extends object>(items: T[]): readonly T[] => Object.freeze(items.map(r => Object.freeze({ ...r })));
    /** Shared settle path for the two create forms: each owns its own busy flag and error slot. */
    async function formWrite({ saving, error: errorKey, fallback, run }: {
        saving: 'roleSaving' | 'policySaving';
        error: 'roleError' | 'policyError';
        fallback: string;
        run: () => Promise<void>;
    }) {
        set({ [saving]: true, [errorKey]: null });
        let saved = false;
        try {
            await run();
            await load({});
            saved = store.active({});
        }
        catch (error) {
            set({ [errorKey]: report(error, fallback) });
        }
        finally {
            set({ [saving]: false });
        }
        return saved;
    }
    /** Shared settle path for row writes (rename, policy edit, permission grant). */
    async function rowWrite({ id, fallback, run }: {
        id: string;
        fallback: string;
        run: () => Promise<void>;
    }) {
        set({ rowSavingId: id, rowError: null });
        let saved = false;
        try {
            await run();
            saved = store.active({});
        }
        catch (error) {
            set({ rowError: report(error, fallback) });
        }
        finally {
            if (read({}).rowSavingId === id) {
                set({ rowSavingId: null });
            }

        }
        return saved;
    }
    async function load(_required: Record<string, never>, _optional: Record<string, never> = {}) {
        if (!store.active({})) {
            return;
        }

        ++listGeneration;
        const generation = listGeneration;
        set({ error: null });
        try {
            const [r, p] = await Promise.all([api.listRoles({}, call), api.listPolicies({}, call)]);
            if (generation === listGeneration) {
                set({ roles: rows(r.roles), policies: rows(p.policies) });
            }

        }
        catch (error) {
            if (generation === listGeneration) {
                set({ error: report(error, 'Failed to load roles/policies.') });
            }

        }
    }
    async function loadPermissions({ policyId }: {
        policyId: string;
    }, _optional: Record<string, never> = {}) {
        if (!store.active({}) || read({}).permissionPolicyId !== policyId) {
            return;
        }

        // Start order, rather than completion order, owns rows AND failures. Closing also invalidates.
        ++permissionGeneration;
        const generation = permissionGeneration;
        set({ permissionsLoading: true });
        try {
            const result = await api.listPolicyPermissions({ policyId }, call);
            if (generation === permissionGeneration && read({}).permissionPolicyId === policyId) {
                set({ permissionRows: rows(result.policyPermissions) });
            }

        }
        catch (error) {
            if (generation === permissionGeneration && read({}).permissionPolicyId === policyId) {
                set({ permissionRows: [], rowError: report(error, 'Failed to load permissions.') });
            }

        }
        finally {
            if (generation === permissionGeneration) {
                set({ permissionsLoading: false });
            }

        }
    }
    async function togglePermissions({ policyId }: {
        policyId: string;
    }, _optional: Record<string, never> = {}) {
        if (!store.active({}) || !policy(policyId)) {
            return;
        }

        const next = read({}).permissionPolicyId === policyId ? null : policyId;
        ++panelGeneration;
        ++permissionGeneration;
        // Clear first so reopening cannot flash the previous policy's permissions.
        set({ permissionPolicyId: next, permissionRows: [], permissionsLoading: false, permissionInput: '', resourceTypeInput: '', rowError: null });
        if (next) {
            await loadPermissions({ policyId: next });
        }

    }
    async function createRole(_required: Record<string, never>, _optional: Record<string, never> = {}) {
        if (!gate() || read({}).roleSaving) {
            return false;
        }

        const name = read({}).roleName;
        return formWrite({
            saving: 'roleSaving', error: 'roleError', fallback: 'Failed to create role.', run: async () => {
                await api.createRole({ name }, call);
                if (read({}).roleName === name) {
                    set({ roleName: '' });
                }

            }
        });
    }
    async function createPolicy(_required: Record<string, never>, _optional: Record<string, never> = {}) {
        if (!gate() || read({}).policySaving) {
            return false;
        }

        const name = read({}).policyName, description = read({}).policyDescription;
        return formWrite({
            saving: 'policySaving', error: 'policyError', fallback: 'Failed to create policy.', run: async () => {
                await api.createPolicy({ name }, { ...call, ...(description ? { description } : {}) });
                if (read({}).policyName === name && read({}).policyDescription === description) {
                    set({ policyName: '', policyDescription: '' });
                }

            }
        });
    }
    function editRole({ role: r }: {
        role: RoleRecord;
    }, _optional: Record<string, never> = {}) {
        if (roleGate(role(r.id))) {
            set({ editingRoleId: r.id, editingRoleName: r.name, rowError: null });
        }
    }
    function editPolicy({ policy: p }: {
        policy: PolicyRecord;
    }, _optional: Record<string, never> = {}) {
        if (policyGate(policy(p.id))) {
            set({ editingPolicyId: p.id, editingPolicyName: p.name, editingPolicyDescription: p.description ?? '', rowError: null });
        }
    }
    async function saveRole(_required: Record<string, never>, _optional: Record<string, never> = {}) {
        const id = read({}).editingRoleId, name = read({}).editingRoleName;
        if (!id || !roleGate(role(id)) || read({}).rowSavingId) {
            return false;
        }

        return rowWrite({
            id, fallback: 'Failed to rename role.', run: async () => {
                await api.updateRole({ roleId: id, name }, call);
                // A late save must not close another row's newer edit.
                if (read({}).editingRoleId === id && read({}).editingRoleName === name) {
                    set({ editingRoleId: null });
                }

                await load({});
            }
        });
    }
    async function savePolicy(_required: Record<string, never>, _optional: Record<string, never> = {}) {
        const id = read({}).editingPolicyId, name = read({}).editingPolicyName, description = read({}).editingPolicyDescription;
        if (!id || !policyGate(policy(id)) || read({}).rowSavingId) {
            return false;
        }

        return rowWrite({
            id, fallback: 'Failed to update policy.', run: async () => {
                await api.updatePolicy({ policyId: id }, { ...call, name, description });
                if (read({}).editingPolicyId === id && read({}).editingPolicyName === name && read({}).editingPolicyDescription === description) {
                    set({ editingPolicyId: null });
                }

                await load({});
            }
        });
    }
    async function writePermission(_required: Record<string, never>, _optional: Record<string, never> = {}) {
        const id = read({}).permissionPolicyId, permission = read({}).permissionInput, resourceType = read({}).resourceTypeInput;
        if (!id || !permission || !policyGate(policy(id)) || read({}).rowSavingId) {
            return false;
        }

        const generation = panelGeneration;
        return rowWrite({
            id, fallback: 'Failed to add permission.', run: async () => {
                await api.writePolicyPermission({ policyId: id, permission }, { ...call, ...(resourceType ? { resourceType } : {}) });
                // Ordering alone cannot protect a trailing refresh: it always mints the newest generation.
                // Check the CURRENT panel identity, and preserve a newer draft even on the same panel.
                if (generation === panelGeneration && read({}).permissionInput === permission && read({}).resourceTypeInput === resourceType) {
                    set({ permissionInput: '', resourceTypeInput: '' });
                }

                if (read({}).permissionPolicyId === id) {
                    await loadPermissions({ policyId: id });
                }

            }
        });
    }
    function targetGate(target: DestructiveTarget): boolean {
        if (target.kind === 'role') {
            return roleGate(role(target.role.id));
        }

        return policyGate(policy(target.kind === 'policy' ? target.policy.id : target.policyId));
    }
    function capture(target: DestructiveTarget): DestructiveTarget {
        if (target.kind === 'role') {
            return Object.freeze({ kind: 'role', role: Object.freeze({ ...target.role }) });
        }

        if (target.kind === 'policy') {
            return Object.freeze({ kind: 'policy', policy: Object.freeze({ ...target.policy }) });
        }

        return Object.freeze({ kind: 'permission', policyId: target.policyId, row: Object.freeze({ ...target.row }) });
    }
    function requestDestructive({ target }: {
        target: DestructiveTarget;
    }, _optional: Record<string, never> = {}) {
        if (read({}).confirming || !targetGate(target)) {
            return;
        }

        if (target.kind === 'permission' && (read({}).permissionPolicyId !== target.policyId || !read({}).permissionRows.some(r => r.id === target.row.id))) {
            return;
        }

        // The menu closes after one click; shell confirmation survives that closure. Revoke also
        // needs confirmation: removing from an attached policy immediately changes live authority.
        set({ pending: capture(target), rowError: null });
    }
    function cancelDestructive(_required: Record<string, never>, _optional: Record<string, never> = {}) {
        if (!read({}).confirming) {
            set({ pending: null });
        }
    }
    async function destroy(target: DestructiveTarget) {
        if (target.kind === 'role') {
            await api.deleteRole({ roleId: target.role.id }, call);
            await load({});
        }
        else if (target.kind === 'policy') {
            await api.deletePolicy({ policyId: target.policy.id }, call);
            if (read({}).permissionPolicyId === target.policy.id) {
                ++permissionGeneration;
                ++panelGeneration;
                set({ permissionPolicyId: null, permissionRows: [], permissionsLoading: false });
            }
            await load({});
        }
        else {
            set({ removingPermissionId: target.row.id });
            await api.removePolicyPermission({ policyId: target.policyId, policyPermissionId: target.row.id }, call);
            if (read({}).permissionPolicyId === target.policyId) {
                await loadPermissions({ policyId: target.policyId });
            }

        }
    }
    async function confirmDestructive(_required: Record<string, never>, _optional: Record<string, never> = {}) {
        const target = read({}).pending;
        if (!target || read({}).confirming || read({}).rowSavingId || !targetGate(target)) {
            return false;
        }

        set({ confirming: true, rowError: null });
        let destroyed = false;
        try {
            await destroy(target);
            destroyed = store.active({});
        }
        catch (error) {
            set({ rowError: report(error, target.kind === 'permission' ? 'Failed to remove permission.' : `Failed to delete ${target.kind}.`) });
        }
        finally {
            if (read({}).pending === target) {
                set({ pending: null });
            }

            set({ confirming: false, removingPermissionId: null });
        }
        return destroyed;
    }
    return {
        getSnapshot: store.getSnapshot,
        subscribe: store.subscribe,
        dispose(_required: Record<string, never> = {}, _optional: Record<string, never> = {}) {
            if (!store.active({})) return;
            ++listGeneration; ++permissionGeneration; store.dispose({});
        },
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
