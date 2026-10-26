import type { FormEvent } from 'react';
import { useUsersView } from './UsersPage.hooks.js';
import { grantLabel, hasAdminGrant } from '../../people.rules.js';
import type { AdminOperator } from '../../models.js';
import type { UsersController } from '../../controllers/users.controller.js';
import type { MenuItem } from '@jini-ai/ui-kit/react';
/** Semantic autocomplete must survive a reveal to type=text and host facade overrides. */
export const newPasswordAttrs = { autoComplete: 'new-password', 'data-jini-part': 'new-password' };
export function useUsersTab(_required: Record<string, never> = {}, _optional: Record<string, never> = {}) {
  const { controller: c, state: s, permissions } = useUsersView({});
  return { s, canCreate: hasAdminGrant({ permissions, permission: 'user.manage' }),
    toggleForm: () => c.setFormOpen({ open: !s.formOpen }), cancelForm: () => c.setFormOpen({ open: false }),
    username: ({ value }: { value: string }) => c.setDraft({ patch: { username: value } }),
    email: ({ value }: { value: string }) => c.setDraft({ patch: { email: value } }),
    password: ({ value }: { value: string }) => c.setDraft({ patch: { password: value } }),
    submit: (e: FormEvent) => { e.preventDefault(); void c.createUser({}); },
  };
}
/** Row actions in menu order; each is offered only when the controller allows it for this user. */
const rowActions = [
  { action: 'disable', label: 'Disable', run: (c: UsersController, principalId: string) => c.requestDestructive({ principalId, kind: 'disable' }) },
  { action: 'enable', label: 'Enable', run: (c: UsersController, principalId: string) => { void c.enableUser({ principalId }); } },
  { action: 'reset', label: 'Reset password', run: (c: UsersController, principalId: string) => c.requestDestructive({ principalId, kind: 'reset' }) },
  { action: 'delete', label: 'Delete', run: (c: UsersController, principalId: string) => c.requestDestructive({ principalId, kind: 'delete' }) },
] as const;
function grantOptions({ placeholder, records }: { placeholder: string; records: readonly { id: string; name: string; isBuiltin: boolean }[] }, _optional: Record<string, never> = {}) {
  return [{ value: '', label: placeholder }, ...records.map(r => ({ value: r.id, label: `${r.name}${r.isBuiltin ? ' (built-in)' : ''}` }))];
}
export function useUserRow({ user }: { user: AdminOperator }, _optional: Record<string, never> = {}) {
  const { controller: c, state: s } = useUsersView({});
  const id = user.principalId, canEmail = c.allowed({ principalId: id, action: 'email' }), canGrants = c.allowed({ principalId: id, action: 'grants' });
  const canExpand = canEmail || canGrants, roles = s.roles ?? [], policies = s.policies ?? [];
  const items: MenuItem[] = canExpand ? [{ id: 'manage', label: 'Manage', onPress: () => c.toggleExpanded({ principalId: id }) }] : [];
  for (const a of rowActions) if (c.allowed({ principalId: id, action: a.action })) items.push({ id: a.action, label: a.label, onPress: () => a.run(c, id) });
  return { s, items, canEmail, canGrants, expanded: s.expandedId === id, canExpand,
    roles: grantLabel({ ids: user.roleIds, records: roles }), policies: grantLabel({ ids: user.policyIds, records: policies }),
    toggle: () => c.toggleExpanded({ principalId: id }), menuLabel: `Actions for user "${user.username}"`,
    email: ({ value }: { value: string }) => c.setDraft({ patch: { editEmail: value } }), role: ({ value }: { value: string }) => c.setDraft({ patch: { pendingRoleId: value } }), policy: ({ value }: { value: string }) => c.setDraft({ patch: { pendingPolicyId: value } }),
    saveEmail: () => { void c.savePanel({ principalId: id, kind: 'email' }); }, assignRole: () => { void c.savePanel({ principalId: id, kind: 'role' }); }, attachPolicy: () => { void c.savePanel({ principalId: id, kind: 'policy' }); },
    roleOptions: grantOptions({ placeholder: 'Select a role…', records: roles }),
    policyOptions: grantOptions({ placeholder: 'Select a policy…', records: policies }),
  };
}
/** Dialog copy per pending kind; nothing pending (a closed dialog) reads as the disable copy. */
const confirmationCopy = {
  delete: { title: 'Delete this user?', label: 'Move to trash', tone: 'danger' as const,
    body: 'They will be signed out and moved to the Trash. You can restore them there; they are deleted permanently after 60 days.', consequence: 'moves the user to the Trash' },
  reset: { title: 'Reset password?', label: 'Reset password', tone: 'warning' as const, body: 'Every active session for this user will be signed out.', consequence: 'revokes every active session' },
  disable: { title: 'Disable this user?', label: 'Disable', tone: 'warning' as const, body: 'They will not be able to sign in until re-enabled.', consequence: 'revokes sign-in access' },
};
export function useUsersConfirmation(_required: Record<string, never> = {}, _optional: Record<string, never> = {}) {
  const { state: s, controller: c } = useUsersView({});
  const kind = s.pending?.kind ?? 'disable', reset = kind === 'reset', mismatch = s.newPassword !== s.confirmPassword;
  const copy = confirmationCopy[kind];
  return { s, reset, mismatch, error: mismatch ? 'Passwords do not match.' : s.passwordError, copy,
    confirm: { open: s.pending !== null, title: copy.title, confirmLabel: copy.label, tone: copy.tone, consequence: copy.consequence, pending: s.confirming, agentMayConfirm: false,
      onConfirm: async () => { await c.confirmDestructive({}); }, onCancel: () => c.cancelDestructive({}) },
    newPassword: ({ value }: { value: string }) => c.setDraft({ patch: { newPassword: value } }),
    confirmPassword: ({ value }: { value: string }) => c.setDraft({ patch: { confirmPassword: value } }),
    toggleNew: () => c.togglePasswordVisible({ field: 'new' }), toggleConfirm: () => c.togglePasswordVisible({ field: 'confirm' }),
  };
}
