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
function createUsersState({ api, safety }: { api: UsersApiPort; safety: UsersSafetyPort }, permissions: readonly string[], options: {
  openOwnPasswordReset: boolean;
  onOwnPasswordResetClosed: ((required: Record<string, never>, optional?: Record<string, never>) => void) | undefined;
}) {
  const grants = Object.freeze([...permissions]);
  const store = createControllerStore<UsersState>({ initial });
  const set = (patch: Partial<UsersState>) => store.set({ patch });
  const read = store.getSnapshot, call = store.call;
  const row = (principalId: string) => read({}).users?.find(u => u.principalId === principalId);
  const report = (error: unknown, fallback: string) => describePeopleError({ error, fallback });
  const generations = { listGeneration: 0, panelGeneration: 0, draftGeneration: 0, deepLinkAttempted: false, openedViaDeepLink: false };
  const callerPromise: { current: Promise<void> | null } = { current: null };
  return { api, safety, grants, store, set, read, call, row, report, generations, callerPromise, ...options };
}

type UsersContext = ReturnType<typeof createUsersState>;

function createUserPanelWrites(api: UsersApiPort, call: ReturnType<typeof createControllerStore<UsersState>>['call']) {
  /** Per-kind panel writes: the authority checked, the selection that must be present, the call,
   * and the selection cleared on success (email keeps its field, but still notifies). */
  const panelWrites: Readonly<Record<'email' | 'role' | 'policy', {
    action: UserAction; fallback: string; cleared: Partial<UsersState>;
    missing: (s: Readonly<UsersState>) => boolean; write: (principalId: string, s: Readonly<UsersState>) => Promise<unknown>;
  }>> = {
    email: {
      action: 'email', fallback: 'failed to update email', cleared: {}, missing: () => false,
      write: (principalId, s) => api.updateUser({ principalId }, { ...call, email: s.editEmail })
    },
    role: {
      action: 'grants', fallback: 'failed to assign role', cleared: { pendingRoleId: '' }, missing: s => !s.pendingRoleId,
      write: (principalId, s) => api.assignRole({ principalId, roleId: s.pendingRoleId }, call)
    },
    policy: {
      action: 'grants', fallback: 'failed to attach policy', cleared: { pendingPolicyId: '' }, missing: s => !s.pendingPolicyId,
      write: (principalId, s) => api.attachPolicy({ principalId, policyId: s.pendingPolicyId }, call)
    },
  };
  return panelWrites;
}

type PanelWrite = ReturnType<typeof createUserPanelWrites>[keyof ReturnType<typeof createUserPanelWrites>];
type Pending = NonNullable<UsersState['pending']>;

function createUserAuthority(ctx: UsersContext) {
  const { safety, grants, store, read, row } = ctx;
  return function allowed({ principalId, action }: { principalId: string; action: UserAction }, _optional: Record<string, never> = {}) {
    const user = row(principalId);
    return store.active({}) && !!user && userActionAllowed({ user, action, permissions: grants, caller: read({}).caller, safety });
  };
}

function createUserGate(ctx: UsersContext, deps: { allowed: ReturnType<typeof createUserAuthority> }) {
  const { set, read } = ctx;
  const { allowed } = deps;
  return function gate(principalId: string, action: UserAction) {
    if (read({}).confirming || !allowed({ principalId, action })) { set({ rowError: 'You do not have permission to do that.' }); return false; } return true;
  };
}

function createUserDestructiveRequest(ctx: UsersContext, deps: { gate: ReturnType<typeof createUserGate> }) {
  const { set, read, row } = ctx;
  const { gate } = deps;
  return function requestDestructive({ principalId, kind }: { principalId: string; kind: 'disable' | 'delete' | 'reset' }, _optional: Record<string, never> = {}) {
    if (read({}).rowSavingId || !gate(principalId, kind)) return;
    const user = row(principalId)!;
    set({
      pending: Object.freeze({ kind, user: snapshotUser(user) }), rowError: null, passwordError: null,
      newPassword: '', confirmPassword: '', showNewPassword: false, showConfirmPassword: false
    });
  };
}

function createUserDeepLink(ctx: UsersContext, deps: { allowed: ReturnType<typeof createUserAuthority>; requestDestructive: ReturnType<typeof createUserDestructiveRequest> }) {
  const { read, row, generations, openOwnPasswordReset } = ctx;
  const { allowed, requestDestructive } = deps;
  return function maybeDeepLink() {
    const s = read({}); if (!openOwnPasswordReset || generations.deepLinkAttempted || !s.users || !s.caller) return;
    const own = row(s.caller.user.id); if (!own) return;
    generations.deepLinkAttempted = true;
    if (allowed({ principalId: own.principalId, action: 'reset' })) { requestDestructive({ principalId: own.principalId, kind: 'reset' }); generations.openedViaDeepLink = true; }
  };
}

function createUserDialogClose(ctx: UsersContext) {
  const { set, generations, onOwnPasswordResetClosed } = ctx;
  return function close() {
    set({ pending: null, newPassword: '', confirmPassword: '', passwordError: null, showNewPassword: false, showConfirmPassword: false });
    if (generations.openedViaDeepLink) { generations.openedViaDeepLink = false; onOwnPasswordResetClosed?.({}); }
  };
}

function createUserLoader(ctx: UsersContext, deps: { maybeDeepLink: ReturnType<typeof createUserDeepLink> }) {
  const { api, store, set, call, report, generations } = ctx;
  const { maybeDeepLink } = deps;
  return async function load(_required: Record<string, never>, _optional: Record<string, never> = {}) {
    if (!store.active({})) return;
    ++generations.listGeneration;
    const generation = generations.listGeneration; set({ error: null });
    try {
      const [u, r, p] = await Promise.all([api.listUsers({}, call), api.listRoles({}, call), api.listPolicies({}, call)]);
      if (generation !== generations.listGeneration || !store.active({})) return;
      set({ users: Object.freeze(u.users.map(snapshotUser)), roles: Object.freeze(r.roles.map(r => Object.freeze({ ...r }))), policies: Object.freeze(p.policies.map(p => Object.freeze({ ...p }))) });
      maybeDeepLink();
    } catch (error) { if (generation === generations.listGeneration) set({ error: report(error, 'failed to load users') }); }
  };
}

function createUserCallerLoader(ctx: UsersContext, deps: { maybeDeepLink: ReturnType<typeof createUserDeepLink> }) {
  const { api, store, set, call, callerPromise } = ctx;
  const { maybeDeepLink } = deps;
  return async function loadCaller(_required: Record<string, never>, _optional: Record<string, never> = {}) {
    if (!store.active({})) return;
    if (!callerPromise.current) callerPromise.current = (async () => {
      try {
        const caller = await api.me({}, call);
        if (!store.active({}) || !caller.user || typeof caller.user.id !== 'string' || !caller.user.id) return;
        const safeCaller: CallerInfo = Object.freeze({
          user: Object.freeze({ ...caller.user }), canManageUserTrash: caller.canManageUserTrash === true,
          ...(caller.effectivePermissions ? { effectivePermissions: Object.freeze([...caller.effectivePermissions]) } : {})
        });
        set({ caller: safeCaller }); maybeDeepLink();
      } catch { /* Best-effort identity: unknown defaults to no affordance, including delete. */ }
    })();
    await callerPromise.current;
  };
}

function createUserCreator(ctx: UsersContext, deps: { load: ReturnType<typeof createUserLoader> }) {
  const { api, grants, store, set, read, call, report, generations } = ctx;
  const { load } = deps;
  return async function createUser(_required: Record<string, never>, _optional: Record<string, never> = {}) {
    const s = read({}); if (!store.active({}) || s.saving || s.confirming || !hasAdminGrant({ permissions: grants, permission: 'user.manage' })) return false;
    const draft = generations.draftGeneration; set({ saving: true, formError: null });
    let created = false;
    try {
      await api.createUser({ username: s.username, password: s.password }, { ...call, ...(s.email ? { email: s.email } : {}) });
      if (draft === generations.draftGeneration) set({ username: '', email: '', password: '', formOpen: false });
      await load({}); created = store.active({});
    } catch (error) { set({ formError: report(error, 'failed to create user') }); }
    finally { set({ saving: false }); }
    return created;
  };
}

function createUserPanelToggle(ctx: UsersContext) {
  const { store, set, read, row, generations } = ctx;
  return function toggleExpanded({ principalId }: { principalId: string }, _optional: Record<string, never> = {}) {
    if (!store.active({}) || !row(principalId)) return;
    ++generations.panelGeneration;
    // A stale grant cannot clear a newer panel's selection or busy flag. Reset on switching.
    set({ expandedId: read({}).expandedId === principalId ? null : principalId, editEmail: row(principalId)!.email ?? '', pendingRoleId: '', pendingPolicyId: '', grantError: null, grantSaving: false });
  };
}

function createUserPanelGuard(deps: { gate: ReturnType<typeof createUserGate> }) {
  const { gate } = deps;
  /** Busy, expanded-row and authority checks run before the selection check, so only a refusal of authority reports. */
  return function panelSavable(s: Readonly<UsersState>, principalId: string, panel: PanelWrite) {
    return !s.grantSaving && s.expandedId === principalId && gate(principalId, panel.action) && !panel.missing(s);
  };
}

function createUserPanelSaver(ctx: UsersContext, deps: { panelSavable: ReturnType<typeof createUserPanelGuard>; load: ReturnType<typeof createUserLoader>; panelWrites: ReturnType<typeof createUserPanelWrites> }) {
  const { store, set, read, report, generations } = ctx;
  const { panelSavable, load, panelWrites } = deps;
  return async function savePanel({ principalId, kind }: { principalId: string; kind: 'email' | 'role' | 'policy' }, _optional: Record<string, never> = {}) {
    const s = read({}), panel = panelWrites[kind];
    if (!panelSavable(s, principalId, panel)) return false;
    const generation = generations.panelGeneration, draft = generations.draftGeneration;
    set({ grantSaving: true, grantError: null });
    let saved = false;
    try {
      await panel.write(principalId, s);
      if (generation === generations.panelGeneration && draft === generations.draftGeneration) set(panel.cleared);
      await load({}); saved = store.active({});
    } catch (error) { if (generation === generations.panelGeneration) set({ grantError: report(error, panel.fallback) }); }
    finally { if (generation === generations.panelGeneration) set({ grantSaving: false }); }
    return saved;
  };
}

function createUserEnabler(ctx: UsersContext, deps: { gate: ReturnType<typeof createUserGate>; load: ReturnType<typeof createUserLoader> }) {
  const { api, store, set, read, call, report } = ctx;
  const { gate, load } = deps;
  return async function enableUser({ principalId }: { principalId: string }, _optional: Record<string, never> = {}) {
    if (read({}).rowSavingId || !gate(principalId, 'enable')) return false;
    set({ rowSavingId: principalId, rowError: null });
    let enabled = false;
    try { await api.enableUser({ principalId }, call); await load({}); enabled = store.active({}); }
    catch (error) { set({ rowError: report(error, 'failed to change status') }); }
    finally { if (read({}).rowSavingId === principalId) set({ rowSavingId: null }); }
    return enabled;
  };
}

function createUserConfirmationGuard(deps: { gate: ReturnType<typeof createUserGate> }) {
  const { gate } = deps;
  /** The pending target when it may be confirmed now; a reset also needs a matching, non-empty pair. */
  return function confirmable(s: Readonly<UsersState>): Pending | null {
    const target = s.pending;
    if (!target || s.confirming || s.rowSavingId || !gate(target.user.principalId, target.kind)) return null;
    if (target.kind === 'reset' && (!s.newPassword || s.newPassword !== s.confirmPassword)) return null;
    return target;
  };
}

function createUserDestroyer(ctx: UsersContext, deps: { load: ReturnType<typeof createUserLoader> }) {
  const { api, set, call } = ctx;
  const { load } = deps;
  return async function destroy(target: Pending, s: Readonly<UsersState>) {
    const principalId = target.user.principalId;
    if (target.kind === 'reset') {
      await api.resetUserPassword({ principalId, password: s.newPassword }, call);
      set({ notice: principalId === s.caller?.user.id ? 'Password changed. Sign in again with your new password.' : `Password reset for "${target.user.username}" — every active session for this user was revoked.` });
      return;
    }
    if (target.kind === 'disable') await api.disableUser({ principalId }, call); else await api.deleteUser({ principalId }, call);
    await load({});
  };
}

function createUserDestructiveConfirmation(ctx: UsersContext, deps: { confirmable: ReturnType<typeof createUserConfirmationGuard>; destroy: ReturnType<typeof createUserDestroyer>; close: ReturnType<typeof createUserDialogClose> }) {
  const { store, set, read, report } = ctx;
  const { confirmable, destroy, close } = deps;
  return async function confirmDestructive(_required: Record<string, never>, _optional: Record<string, never> = {}) {
    const s = read({}), target = confirmable(s);
    if (!target) return false;
    set({ confirming: true, rowError: null, passwordError: null }); let success = false, live = false;
    try {
      await destroy(target, s);
      // Read liveness before the close below: its host callback may dispose this controller.
      success = true; live = store.active({});
    } catch (error) {
      set(target.kind === 'reset' ? { passwordError: report(error, 'failed to reset password') } : { rowError: report(error, `failed to ${target.kind} user`) });
    } finally {
      // Reset stays open on failure so the operator can retry the exact typed credential.
      if (store.active({}) && read({}).pending === target && (success || target.kind !== 'reset')) close();
      set({ confirming: false });
    }
    return live;
  };
}

/** Users, roles and policies refresh together. Only the caller read is best-effort: failure keeps
 * all caller-dependent actions closed. Each panel transition invalidates both success and error
 * settlements, including close/reopen of the same row. Password resets do not refresh the table. */
export function createUsersController({ api, safety }: { api: UsersApiPort; safety: UsersSafetyPort }, {
  permissions = [], openOwnPasswordReset = false, onOwnPasswordResetClosed,
}: { permissions?: readonly string[]; openOwnPasswordReset?: boolean; onOwnPasswordResetClosed?: (required: Record<string, never>, optional?: Record<string, never>) => void } = {}) {
  const ctx = createUsersState({ api, safety }, permissions, { openOwnPasswordReset, onOwnPasswordResetClosed });
  const { store, set, read, generations } = ctx;
  const allowed = createUserAuthority(ctx);
  const gate = createUserGate(ctx, { allowed });
  const requestDestructive = createUserDestructiveRequest(ctx, { gate });
  const maybeDeepLink = createUserDeepLink(ctx, { allowed, requestDestructive });
  const close = createUserDialogClose(ctx);
  const load = createUserLoader(ctx, { maybeDeepLink });
  const loadCaller = createUserCallerLoader(ctx, { maybeDeepLink });
  const createUser = createUserCreator(ctx, { load });
  const toggleExpanded = createUserPanelToggle(ctx);
  const panelWrites = createUserPanelWrites(api, ctx.call);
  const panelSavable = createUserPanelGuard({ gate });
  const savePanel = createUserPanelSaver(ctx, { panelSavable, load, panelWrites });
  const enableUser = createUserEnabler(ctx, { gate, load });
  const confirmable = createUserConfirmationGuard({ gate });
  const destroy = createUserDestroyer(ctx, { load });
  const confirmDestructive = createUserDestructiveConfirmation(ctx, { confirmable, destroy, close });
  return {
    getSnapshot: store.getSnapshot, subscribe: store.subscribe, allowed,
    load, loadCaller, createUser, toggleExpanded, savePanel, enableUser, requestDestructive, confirmDestructive,
    cancelDestructive(_required: Record<string, never>, _optional: Record<string, never> = {}) { if (!read({}).confirming) close(); },
    setFormOpen({ open }: { open: boolean }, _optional: Record<string, never> = {}) { set({ formOpen: open }); },
    setDraft({ patch }: { patch: Partial<UsersDraft> }, _optional: Record<string, never> = {}) { ++generations.draftGeneration; set(patch); },
    togglePasswordVisible({ field }: { field: 'new' | 'confirm' }, _optional: Record<string, never> = {}) { set(field === 'new' ? { showNewPassword: !read({}).showNewPassword } : { showConfirmPassword: !read({}).showConfirmPassword }); },
    dispose(_required: Record<string, never> = {}, _optional: Record<string, never> = {}) { set({ password: '', newPassword: '', confirmPassword: '', pending: null }); store.dispose({}); ++generations.listGeneration; ++generations.panelGeneration; },
  };
}
export type UsersController = ReturnType<typeof createUsersController>;
