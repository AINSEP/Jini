import { useRolesView } from './RolesPage.hooks.js';
import type { PolicyRecord } from '../../models.js';
import type { MenuItem } from '@jini-ai/ui-kit/react';
export function usePoliciesTab(_required: Record<string, never> = {}, _optional: Record<string, never> = {}) {
    const { state, controller: c, canManage } = useRolesView({});
    return { rows: state.policies ?? [], canManage, name: state.policyName, description: state.policyDescription, saving: state.policySaving, error: state.policyError,
        changeName: ({ value }: {
            value: string;
        }) => c.setDraft({ patch: { policyName: value } }),
        changeDescription: ({ value }: {
            value: string;
        }) => c.setDraft({ patch: { policyDescription: value } }),
        submit: (event: {
            preventDefault(): void;
        }) => { event.preventDefault(); void c.createPolicy({}); },
        createDisabled: state.policySaving || !state.policyName.trim() };
}
export function usePolicyRow({ policy }: {
    policy: PolicyRecord;
}, _optional: Record<string, never> = {}) {
    const { state, controller: c, canManage } = useRolesView({});
    const editable = canManage && !policy.isBuiltin && !policy.isFrozen;
    const open = state.permissionPolicyId === policy.id;
    const menu: MenuItem[] = [{ id: 'rename', label: 'Rename', onPress: () => c.editPolicy({ policy }) },
        { id: 'permission', label: open ? 'Close' : 'Add permission', onPress: () => { void c.togglePermissions({ policyId: policy.id }); } },
        { id: 'delete', label: 'Delete', onPress: () => c.requestDestructive({ target: { kind: 'policy', policy } }) }];
    return { name: policy.name, description: policy.description ?? '—', type: `${policy.isBuiltin ? 'Built-in' : 'Custom'}${policy.isFrozen ? ' (frozen)' : ''}`,
        editable, open, editing: state.editingPolicyId === policy.id, draft: state.editingPolicyName, draftDescription: state.editingPolicyDescription,
        pending: state.rowSavingId === policy.id, saveDisabled: state.rowSavingId !== null || !state.editingPolicyName.trim(),
        changeName: ({ value }: {
            value: string;
        }) => c.setDraft({ patch: { editingPolicyName: value } }),
        changeDescription: ({ value }: {
            value: string;
        }) => c.setDraft({ patch: { editingPolicyDescription: value } }),
        save: () => { void c.savePolicy({}); }, cancel: () => c.cancelEdit({ kind: 'policy' }), menu, menuLabel: `Actions for policy "${policy.name}"`,
        viewPermissions: () => { void c.togglePermissions({ policyId: policy.id }); },
        readLabel: open ? 'Close permissions' : 'View permissions' };
}
