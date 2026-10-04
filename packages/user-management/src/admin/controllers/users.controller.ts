import type { UsersApiPort, UsersSafetyPort } from '../ports.js';
import type { AdminOperator, CallerInfo, UsersState, UsersDraft, UserAction } from '../models.js';
import { hasAdminGrant, userActionAllowed, describePeopleError } from '../people.rules.js';
import { createControllerStore } from './controller-store.js';
const initial: UsersState = {
  users: null, roles: null, policies: null, caller: null, error: null, rowError: null, formError: null,
  grantError: null, passwordError: null, notice: null, formOpen: false, saving: false, grantSaving: false,
  expandedId: null, rowSavingId: null, pending: null, confirming: false,
  username: '', email: '', password: '', editEmail: '', pendingRoleId: '', pendingPolicyId: '',
  newPassword: '', confirmPassword: '', showNewPassword: false, showConfirmPassword: false,
};
function snapshotUser(user: AdminOperator): AdminOperator {
  return Object.freeze({ ...user, roleIds: Object.freeze([...user.roleIds]), policyIds: Object.freeze([...user.policyIds]) });
}
/** Users, roles and policies refresh together. Only the caller read is best-effort: failure keeps
 * all caller-dependent actions closed. Each panel transition invalidates both success and error
 * settlements, including close/reopen of the same row. Password resets do not refresh the table. */
export function createUsersController({ api, safety }: { api: UsersApiPort; safety: UsersSafetyPort }, {
  permissions = [], openOwnPasswordReset = false, onOwnPasswordResetClosed,
}: { permissions?: readonly string[]; openOwnPasswordReset?: boolean; onOwnPasswordResetClosed?: (required: Record<string, never>, optional?: Record<string, never>) => void } = {}) {
  const grants = Object.freeze([...permissions]);
  const store = createControllerStore<UsersState>({ initial });
  const set = (patch: Partial<UsersState>) => store.set({ patch });
  const read = store.getSnapshot, call = store.call;
  let listGeneration = 0, panelGeneration = 0, draftGeneration = 0, deepLinkAttempted = false, openedViaDeepLink = false;
  let callerPromise: Promise<void> | null = null;
  const row = (principalId: string) => read({}).users?.find(u => u.principalId === principalId);
  const report = (error: unknown, fallback: string) => describePeopleError({ error, fallback });
  function allowed({ principalId, action }: { principalId: string; action: UserAction }, _optional: Record<string, never> = {}) {
    const user = row(principalId);
    return store.active({}) && !!user && userActionAllowed({ user, action, permissions: grants, caller: read({}).caller, safety });
  }
  function gate(principalId: string, action: UserAction) {
    if (read({}).confirming || !allowed({ principalId, action })) { set({ rowError: 'You do not have permission to do that.' }); return false; } return true;
  }
  function requestDestructive({ principalId, kind }: { principalId: string; kind: 'disable' | 'delete' | 'reset' }, _optional: Record<string, never> = {}) {
    if (read({}).rowSavingId || !gate(principalId, kind)) return;
    const user = row(principalId)!;
    set({ pending: Object.freeze({ kind, user: snapshotUser(user) }), rowError: null, passwordError: null,
      newPassword: '', confirmPassword: '', showNewPassword: false, showConfirmPassword: false });
  }
  function maybeDeepLink() {
    const s = read({}); if (!openOwnPasswordReset || deepLinkAttempted || !s.users || !s.caller) return;
    const own = row(s.caller.user.id); if (!own) return;
    deepLinkAttempted = true;
    if (allowed({ principalId: own.principalId, action: 'reset' })) { requestDestructive({ principalId: own.principalId, kind: 'reset' }); openedViaDeepLink = true; }
  }
  function close() {
    set({ pending: null, newPassword: '', confirmPassword: '', passwordError: null, showNewPassword: false, showConfirmPassword: false });
    if (openedViaDeepLink) { openedViaDeepLink = false; onOwnPasswordResetClosed?.({}); }
  }
  async function load(_required: Record<string, never>, _optional: Record<string, never> = {}) {
    if (!store.active({})) return;
    const generation = ++listGeneration; set({ error: null });
    try {
      const [u, r, p] = await Promise.all([api.listUsers({}, call), api.listRoles({}, call), api.listPolicies({}, call)]);
      if (generation !== listGeneration || !store.active({})) return;
      set({ users: Object.freeze(u.users.map(snapshotUser)), roles: Object.freeze(r.roles.map(r => Object.freeze({ ...r }))), policies: Object.freeze(p.policies.map(p => Object.freeze({ ...p }))) });
      maybeDeepLink();
    } catch (error) { if (generation === listGeneration) set({ error: report(error, 'failed to load users') }); }
  }
  async function loadCaller(_required: Record<string, never>, _optional: Record<string, never> = {}) {
    if (!store.active({})) return;
    if (!callerPromise) callerPromise = (async () => {
      try {
        const caller = await api.me({}, call);
        if (!store.active({}) || !caller.user || typeof caller.user.id !== 'string' || !caller.user.id) return;
        const safeCaller: CallerInfo = Object.freeze({ user: Object.freeze({ ...caller.user }), canManageUserTrash: caller.canManageUserTrash === true,
          ...(caller.effectivePermissions ? { effectivePermissions: Object.freeze([...caller.effectivePermissions]) } : {}) });
        set({ caller: safeCaller }); maybeDeepLink();
      } catch { /* Best-effort identity: unknown defaults to no affordance, including delete. */ }
    })();
    await callerPromise;
  }
  async function createUser(_required: Record<string, never>, _optional: Record<string, never> = {}) {
    const s = read({}); if (!store.active({}) || s.saving || s.confirming || !hasAdminGrant({ permissions: grants, permission: 'user.manage' })) return false;
    const draft = draftGeneration; set({ saving: true, formError: null });
    try {
      await api.createUser({ username: s.username, password: s.password }, { ...call, ...(s.email ? { email: s.email } : {}) });
      if (draft === draftGeneration) set({ username: '', email: '', password: '', formOpen: false });
      await load({}); return store.active({});
    } catch (error) { set({ formError: report(error, 'failed to create user') }); return false; }
    finally { set({ saving: false }); }
  }
  function toggleExpanded({ principalId }: { principalId: string }, _optional: Record<string, never> = {}) {
    if (!store.active({}) || !row(principalId)) return;
    ++panelGeneration;
    // A stale grant cannot clear a newer panel's selection or busy flag. Reset on switching.
    set({ expandedId: read({}).expandedId === principalId ? null : principalId, editEmail: row(principalId)!.email ?? '', pendingRoleId: '', pendingPolicyId: '', grantError: null, grantSaving: false });
  }
  async function savePanel({ principalId, kind }: { principalId: string; kind: 'email' | 'role' | 'policy' }, _optional: Record<string, never> = {}) {
    const s = read({}), action = kind === 'email' ? 'email' : 'grants';
    if (s.grantSaving || s.expandedId !== principalId || !gate(principalId, action)) return false;
    if ((kind === 'role' && !s.pendingRoleId) || (kind === 'policy' && !s.pendingPolicyId)) return false;
    const generation = panelGeneration, draft = draftGeneration;
    set({ grantSaving: true, grantError: null });
    try {
      if (kind === 'email') await api.updateUser({ principalId }, { ...call, email: s.editEmail });
      else if (kind === 'role') await api.assignRole({ principalId, roleId: s.pendingRoleId }, call);
      else await api.attachPolicy({ principalId, policyId: s.pendingPolicyId }, call);
      if (generation === panelGeneration && draft === draftGeneration) set(kind === 'role' ? { pendingRoleId: '' } : kind === 'policy' ? { pendingPolicyId: '' } : {});
      await load({}); return store.active({});
    } catch (error) { if (generation === panelGeneration) set({ grantError: report(error, `failed to ${kind === 'email' ? 'update email' : kind === 'role' ? 'assign role' : 'attach policy'}`) }); return false; }
    finally { if (generation === panelGeneration) set({ grantSaving: false }); }
  }
  async function enableUser({ principalId }: { principalId: string }, _optional: Record<string, never> = {}) {
    if (read({}).rowSavingId || !gate(principalId, 'enable')) return false;
    set({ rowSavingId: principalId, rowError: null });
    try { await api.enableUser({ principalId }, call); await load({}); return store.active({}); }
    catch (error) { set({ rowError: report(error, 'failed to change status') }); return false; }
    finally { if (read({}).rowSavingId === principalId) set({ rowSavingId: null }); }
  }
  async function confirmDestructive(_required: Record<string, never>, _optional: Record<string, never> = {}) {
    const s = read({}), target = s.pending;
    if (!target || s.confirming || s.rowSavingId || !gate(target.user.principalId, target.kind)) return false;
    if (target.kind === 'reset' && (!s.newPassword || s.newPassword !== s.confirmPassword)) return false;
    set({ confirming: true, rowError: null, passwordError: null }); let success = false;
    try {
      const principalId = target.user.principalId;
      if (target.kind === 'reset') {
        await api.resetUserPassword({ principalId, password: s.newPassword }, call);
        set({ notice: principalId === s.caller?.user.id ? 'Password changed. Sign in again with your new password.' : `Password reset for "${target.user.username}" — every active session for this user was revoked.` });
      } else {
        if (target.kind === 'disable') await api.disableUser({ principalId }, call); else await api.deleteUser({ principalId }, call);
        await load({});
      }
      success = true; return store.active({});
    } catch (error) {
      set(target.kind === 'reset' ? { passwordError: report(error, 'failed to reset password') } : { rowError: report(error, `failed to ${target.kind} user`) }); return false;
    } finally {
      // Reset stays open on failure so the operator can retry the exact typed credential.
      if (store.active({}) && read({}).pending === target && (success || target.kind !== 'reset')) close();
      set({ confirming: false });
    }
  }
  return {
    getSnapshot: store.getSnapshot, subscribe: store.subscribe, allowed,
    load, loadCaller, createUser, toggleExpanded, savePanel, enableUser, requestDestructive, confirmDestructive,
    cancelDestructive(_required: Record<string, never>, _optional: Record<string, never> = {}) { if (!read({}).confirming) close(); },
    setFormOpen({ open }: { open: boolean }, _optional: Record<string, never> = {}) { set({ formOpen: open }); },
    setDraft({ patch }: { patch: Partial<UsersDraft> }, _optional: Record<string, never> = {}) { ++draftGeneration; set(patch); },
    togglePasswordVisible({ field }: { field: 'new' | 'confirm' }, _optional: Record<string, never> = {}) { set(field === 'new' ? { showNewPassword: !read({}).showNewPassword } : { showConfirmPassword: !read({}).showConfirmPassword }); },
    dispose(_required: Record<string, never> = {}, _optional: Record<string, never> = {}) { set({ password: '', newPassword: '', confirmPassword: '', pending: null }); store.dispose({}); ++listGeneration; ++panelGeneration; },
  };
}
export type UsersController = ReturnType<typeof createUsersController>;
