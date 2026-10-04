import type { FormEvent } from 'react';
import { useUsersView } from './UsersPage.hooks.js';
import { grantLabel, hasAdminGrant } from '../../people.rules.js';
import type { AdminOperator } from '../../models.js';
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
export function useUserRow({ user }: { user: AdminOperator }, _optional: Record<string, never> = {}) {
  const { controller: c, state: s } = useUsersView({});
  const id = user.principalId, canEmail = c.allowed({ principalId: id, action: 'email' }), canGrants = c.allowed({ principalId: id, action: 'grants' });
  const items: MenuItem[] = [];
  if (canEmail || canGrants) items.push({ id: 'manage', label: 'Manage', onPress: () => c.toggleExpanded({ principalId: id }) });
  if (c.allowed({ principalId: id, action: 'disable' })) items.push({ id: 'disable', label: 'Disable', onPress: () => c.requestDestructive({ principalId: id, kind: 'disable' }) });
  if (c.allowed({ principalId: id, action: 'enable' })) items.push({ id: 'enable', label: 'Enable', onPress: () => { void c.enableUser({ principalId: id }); } });
  if (c.allowed({ principalId: id, action: 'reset' })) items.push({ id: 'reset', label: 'Reset password', onPress: () => c.requestDestructive({ principalId: id, kind: 'reset' }) });
  if (c.allowed({ principalId: id, action: 'delete' })) items.push({ id: 'delete', label: 'Delete', onPress: () => c.requestDestructive({ principalId: id, kind: 'delete' }) });
  return { s, items, canEmail, canGrants, expanded: s.expandedId === id, canExpand: canEmail || canGrants,
    roles: grantLabel({ ids: user.roleIds, records: s.roles ?? [] }), policies: grantLabel({ ids: user.policyIds, records: s.policies ?? [] }),
    toggle: () => c.toggleExpanded({ principalId: id }), menuLabel: `Actions for user "${user.username}"`,
    email: ({ value }: { value: string }) => c.setDraft({ patch: { editEmail: value } }), role: ({ value }: { value: string }) => c.setDraft({ patch: { pendingRoleId: value } }), policy: ({ value }: { value: string }) => c.setDraft({ patch: { pendingPolicyId: value } }),
    saveEmail: () => { void c.savePanel({ principalId: id, kind: 'email' }); }, assignRole: () => { void c.savePanel({ principalId: id, kind: 'role' }); }, attachPolicy: () => { void c.savePanel({ principalId: id, kind: 'policy' }); },
    roleOptions: [{ value: '', label: 'Select a role…' }, ...(s.roles ?? []).map(r => ({ value: r.id, label: `${r.name}${r.isBuiltin ? ' (built-in)' : ''}` }))],
    policyOptions: [{ value: '', label: 'Select a policy…' }, ...(s.policies ?? []).map(p => ({ value: p.id, label: `${p.name}${p.isBuiltin ? ' (built-in)' : ''}` }))],
  };
}
export function useUsersConfirmation(_required: Record<string, never> = {}, _optional: Record<string, never> = {}) {
  const { state: s, controller: c } = useUsersView({});
  const kind = s.pending?.kind, reset = kind === 'reset', mismatch = s.newPassword !== s.confirmPassword;
  const copy = kind === 'delete' ? { title: 'Delete this user?', label: 'Move to trash', tone: 'danger' as const,
    body: 'They will be signed out and moved to the Trash. You can restore them there; they are deleted permanently after 60 days.', consequence: 'moves the user to the Trash' }
    : reset ? { title: 'Reset password?', label: 'Reset password', tone: 'warning' as const, body: 'Every active session for this user will be signed out.', consequence: 'revokes every active session' }
    : { title: 'Disable this user?', label: 'Disable', tone: 'warning' as const, body: 'They will not be able to sign in until re-enabled.', consequence: 'revokes sign-in access' };
  return { s, reset, mismatch, error: mismatch ? 'Passwords do not match.' : s.passwordError, copy,
    confirm: { open: s.pending !== null, title: copy.title, confirmLabel: copy.label, tone: copy.tone, consequence: copy.consequence, pending: s.confirming, agentMayConfirm: false,
      onConfirm: async () => { await c.confirmDestructive({}); }, onCancel: () => c.cancelDestructive({}) },
    newPassword: ({ value }: { value: string }) => c.setDraft({ patch: { newPassword: value } }),
    confirmPassword: ({ value }: { value: string }) => c.setDraft({ patch: { confirmPassword: value } }),
    newType: s.showNewPassword ? 'text' as const : 'password' as const, confirmType: s.showConfirmPassword ? 'text' as const : 'password' as const,
    toggleNew: () => c.togglePasswordVisible({ field: 'new' }), toggleConfirm: () => c.togglePasswordVisible({ field: 'confirm' }),
    newLabel: s.showNewPassword ? 'Hide new password' : 'Show new password', confirmLabel: s.showConfirmPassword ? 'Hide confirm password' : 'Show confirm password',
  };
}
