import type { AdminOperator, CallerInfo, UserAction } from './models.js';
import type { UsersSafetyPort } from './ports.js';
export function hasAdminGrant({ permissions, permission }: { permissions: readonly string[]; permission: string }, _optional: Record<string, never> = {}) {
  return permissions.includes('*') || permissions.includes(permission);
}
/** Server trash authority is a required additional check. This portable UI also requires
 * user.manage: member.manage by itself must never reveal actions over operators.
 * Unknown ownership never becomes permission. The member.manage self-email exception does not
 * confer any credential, status or grant authority over other operators. */
export function userActionAllowed({ user, action, permissions, caller, safety }: {
  user: AdminOperator; action: UserAction; permissions: readonly string[];
  caller: CallerInfo | null; safety: UsersSafetyPort;
}, _optional: Record<string, never> = {}): boolean {
  if (!caller) return false;
  let owner: ReturnType<UsersSafetyPort['ownerStatus']>;
  try { owner = safety.ownerStatus({ principalId: user.principalId }); } catch { return false; }
  if ((owner !== 'owner' && owner !== 'operator') || (owner === 'owner' && !permissions.includes('*'))) return false;
  const self = caller.user.id === user.principalId;
  if (action === 'delete') return hasAdminGrant({ permissions, permission: 'user.manage' }) && caller.canManageUserTrash === true && !self && safety.seededOwnerPrincipalId !== null && user.principalId !== safety.seededOwnerPrincipalId;
  if (action === 'disable' && (user.status !== 'active' || safety.seededOwnerPrincipalId === null || user.principalId === safety.seededOwnerPrincipalId)) return false;
  if (action === 'enable' && user.status !== 'disabled') return false;
  if (action === 'reset' && (safety.seededOwnerPrincipalId === null || (user.principalId === safety.seededOwnerPrincipalId && !self))) return false;
  if (action === 'grants') return hasAdminGrant({ permissions, permission: 'role.manage' });
  if (action === 'email' && self && hasAdminGrant({ permissions, permission: 'member.manage' })) return true;
  return hasAdminGrant({ permissions, permission: 'user.manage' });
}
export function describePeopleError({ error, fallback }: { error: unknown; fallback: string }, _optional: Record<string, never> = {}): string {
  const copy: Record<string, string> = {
    FORBIDDEN: 'You do not have permission to do that.', GRANT_EXCEEDS_ISSUER: 'You cannot grant a permission you do not hold.',
    RESOURCE_CONFLICT: 'That username is already in use.', OWNER_REQUIRED: 'The workspace must keep at least one active owner.',
    SELF_DELETE: 'You cannot delete your own account.', USER_IN_TRASH: 'This user is in the Trash; restore them first.',
    USERNAME_IN_TRASH: 'A user with this username is in the Trash; restore or delete them permanently first.',
  };
  // Own keys only: a server code such as "constructor" must not resolve to an Object.prototype member.
  if (error && typeof error === 'object' && 'code' in error && typeof error.code === 'string' && Object.hasOwn(copy, error.code)) return copy[error.code]!;
  return error instanceof Error && error.message ? error.message : fallback;
}
export function grantLabel({ ids, records }: { ids: readonly string[]; records: readonly { id: string; name: string }[] }, _optional: Record<string, never> = {}) {
  // Unknown grant ids stay visible: dropping them would conceal dangling references.
  const byId = new Map(records.map(r => [r.id, r.name]));
  return ids.map(id => byId.get(id) ?? id).join(', ') || 'none';
}
