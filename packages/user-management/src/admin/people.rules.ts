import type { AdminOperator, CallerInfo, UserAction } from './models.js';
import type { UsersSafetyPort } from './ports.js';
import { errorCode, errorMessageOr } from './error-copy.js';
export function hasAdminGrant({ permissions, permission }: { permissions: readonly string[]; permission: string }, _optional: Record<string, never> = {}) {
  return permissions.includes('*') || permissions.includes(permission);
}
/** What every per-action rule may read once the caller and ownership gates have passed. */
interface ActionContext {
  readonly user: AdminOperator; readonly permissions: readonly string[];
  readonly caller: CallerInfo; readonly seeded: string | null; readonly self: boolean;
}
/** Unknown ownership never becomes permission, and only a wildcard holder may act over an owner. */
function ownershipAllows({ user, permissions, safety }: { user: AdminOperator; permissions: readonly string[]; safety: UsersSafetyPort }): boolean {
  let owner: ReturnType<UsersSafetyPort['ownerStatus']>;
  try { owner = safety.ownerStatus({ principalId: user.principalId }); } catch { return false; }
  return owner === 'operator' || (owner === 'owner' && permissions.includes('*'));
}
const userManage = (c: ActionContext) => hasAdminGrant({ permissions: c.permissions, permission: 'user.manage' });
/** The seeded owner must be known, and the target must not be it. */
const targetsNonSeeded = (c: ActionContext) => c.seeded !== null && c.user.principalId !== c.seeded;
// A Map (not an object literal) so a malformed action such as "constructor" cannot resolve to an
// Object.prototype member; any action without a rule of its own needs user.manage.
const ACTION_RULES = new Map<UserAction, (c: ActionContext) => boolean>([
  ['delete', c => userManage(c) && c.caller.canManageUserTrash === true && !c.self && targetsNonSeeded(c)],
  ['disable', c => c.user.status === 'active' && targetsNonSeeded(c) && userManage(c)],
  ['enable', c => c.user.status === 'disabled' && userManage(c)],
  // The seeded owner may reset its own password, but nobody else may reset it.
  ['reset', c => c.seeded !== null && (c.self || c.user.principalId !== c.seeded) && userManage(c)],
  ['grants', c => hasAdminGrant({ permissions: c.permissions, permission: 'role.manage' })],
  ['email', c => (c.self && hasAdminGrant({ permissions: c.permissions, permission: 'member.manage' })) || userManage(c)],
]);
/** Server trash authority is a required additional check. This portable UI also requires
 * user.manage: member.manage by itself must never reveal actions over operators.
 * Unknown ownership never becomes permission. The member.manage self-email exception does not
 * confer any credential, status or grant authority over other operators. */
export function userActionAllowed({ user, action, permissions, caller, safety }: {
  user: AdminOperator; action: UserAction; permissions: readonly string[];
  caller: CallerInfo | null; safety: UsersSafetyPort;
}, _optional: Record<string, never> = {}): boolean {
  if (!caller || !ownershipAllows({ user, permissions, safety })) return false;
  const context: ActionContext = { user, permissions, caller, seeded: safety.seededOwnerPrincipalId, self: caller.user.id === user.principalId };
  return (ACTION_RULES.get(action) ?? userManage)(context);
}
const PEOPLE_ERROR_COPY: Readonly<Record<string, string>> = Object.freeze({
  FORBIDDEN: 'You do not have permission to do that.', GRANT_EXCEEDS_ISSUER: 'You cannot grant a permission you do not hold.',
  RESOURCE_CONFLICT: 'That username is already in use.', OWNER_REQUIRED: 'The workspace must keep at least one active owner.',
  SELF_DELETE: 'You cannot delete your own account.', USER_IN_TRASH: 'This user is in the Trash; restore them first.',
  USERNAME_IN_TRASH: 'A user with this username is in the Trash; restore or delete them permanently first.',
});
export function describePeopleError({ error, fallback }: { error: unknown; fallback: string }, _optional: Record<string, never> = {}): string {
  const code = errorCode({ error });
  // Own keys only: a server code such as "constructor" must not resolve to an Object.prototype member.
  if (code !== undefined && Object.hasOwn(PEOPLE_ERROR_COPY, code)) return PEOPLE_ERROR_COPY[code]!;
  return errorMessageOr({ error, fallback });
}
export function grantLabel({ ids, records }: { ids: readonly string[]; records: readonly { id: string; name: string }[] }, _optional: Record<string, never> = {}) {
  // Unknown grant ids stay visible: dropping them would conceal dangling references.
  const byId = new Map(records.map(r => [r.id, r.name]));
  return ids.map(id => byId.get(id) ?? id).join(', ') || 'none';
}
