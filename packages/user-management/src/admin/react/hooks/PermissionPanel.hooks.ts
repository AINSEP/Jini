import { useRolesView } from './RolesPage.hooks.js';
import type { PolicyRecord } from '../../models.js';
export function usePermissionPanel({ policy }: {
    policy: PolicyRecord;
}, _optional: Record<string, never> = {}) {
    const { state, controller: c, canManage } = useRolesView({});
    const editable = canManage && !policy.isBuiltin && !policy.isFrozen;
    return { editable, loading: state.permissionsLoading, empty: state.permissionRows.length === 0,
        rows: state.permissionRows.map(row => ({ id: row.id, permission: row.permission, resourceType: row.resourceType ?? '',
            pending: state.removingPermissionId === row.id, removeLabel: `Remove permission ${row.permission}`,
            requestRemove: () => c.requestDestructive({ target: { kind: 'permission', policyId: policy.id, row } }) })),
        permission: state.permissionInput, resourceType: state.resourceTypeInput, pending: state.rowSavingId === policy.id,
        addDisabled: state.rowSavingId !== null || !state.permissionInput.trim(),
        changePermission: ({ value }: {
            value: string;
        }) => c.setDraft({ patch: { permissionInput: value } }),
        changeResourceType: ({ value }: {
            value: string;
        }) => c.setDraft({ patch: { resourceTypeInput: value } }),
        submit: (event: {
            preventDefault(): void;
        }) => { event.preventDefault(); void c.writePermission({}); } };
}
