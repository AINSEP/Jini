import { useRolesView } from './RolesPage.hooks.js';
import type { RoleRecord } from '../../models.js';
import type { MenuItem } from '@jini-ai/ui-kit/react';
export function useRolesTab(_required: Record<string, never> = {}, _optional: Record<string, never> = {}) {
    const { state, controller: c, canManage } = useRolesView({});
    return { rows: state.roles ?? [], canManage, name: state.roleName, saving: state.roleSaving, error: state.roleError,
        changeName: ({ value }: {
            value: string;
        }) => c.setDraft({ patch: { roleName: value } }),
        submit: (event: {
            preventDefault(): void;
        }) => { event.preventDefault(); void c.createRole({}); },
        createDisabled: state.roleSaving || !state.roleName.trim() };
}
export function useRoleRow({ role }: {
    role: RoleRecord;
}, _optional: Record<string, never> = {}) {
    const { state, controller: c, canManage } = useRolesView({});
    const editable = canManage && !role.isBuiltin;
    const menu: MenuItem[] = [{ id: 'rename', label: 'Rename', onPress: () => c.editRole({ role }) }, { id: 'delete', label: 'Delete', onPress: () => c.requestDestructive({ target: { kind: 'role', role } }) }];
    return { name: role.name, type: role.isBuiltin ? 'Built-in' : 'Custom', editable, editing: state.editingRoleId === role.id,
        draft: state.editingRoleName, pending: state.rowSavingId === role.id,
        saveDisabled: state.rowSavingId !== null || !state.editingRoleName.trim(),
        changeName: ({ value }: {
            value: string;
        }) => c.setDraft({ patch: { editingRoleName: value } }),
        save: () => { void c.saveRole({}); }, cancel: () => c.cancelEdit({ kind: 'role' }), menu, menuLabel: `Actions for role "${role.name}"` };
}
