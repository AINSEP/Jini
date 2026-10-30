import type { MembersApiPort, MembersRefreshPort } from '../ports.js';
import type { MembersState, MemberRowState } from '../models.js';
import { hasAdminGrant, describePeopleError } from '../people.rules.js';
import { createControllerStore } from './controller-store.js';
const emptyRow: MemberRowState = Object.freeze({ disabling: false, resending: false, error: null, notice: null });
/** Separate list and detail generations prevent stale errors/spinners from painting onto a
 * different row, including collapse/reopen of the same row. Refresh invalidates cached detail. */
export function createMembersController({ api }: { api: MembersApiPort }, { permissions = [], refresh }: { permissions?: readonly string[]; refresh?: MembersRefreshPort } = {}) {
  const grants = Object.freeze([...permissions]);
  const store = createControllerStore<MembersState>({ initial: { members: null, error: null, rows: {}, expandedId: null, detailById: {}, detailError: null, detailLoadingId: null, pending: null, confirming: false } });
  const read = store.getSnapshot, call = store.call, set = (patch: Partial<MembersState>) => store.set({ patch });
  let listGeneration = 0, detailGeneration = 0;
  const report = (error: unknown, fallback: string) => describePeopleError({ error, fallback });
  const list = () => read({}).members ?? [];
  const row = (id: string) => list().find(m => m.id === id);
  function stateFor({ id }: { id: string }, _optional: Record<string, never> = {}) { return read({}).rows[id] ?? emptyRow; }
  function patchRow(id: string, patch: Partial<MemberRowState>) { set({ rows: Object.freeze({ ...read({}).rows, [id]: Object.freeze({ ...stateFor({ id }), ...patch }) }) }); }
  const gate = () => store.active({}) && hasAdminGrant({ permissions: grants, permission: 'member.manage' });
  async function loadDetail(id: string) {
    ++detailGeneration;
    const generation = detailGeneration; set({ detailLoadingId: id, detailError: null });
    try {
      const { member } = await api.getMember({ id }, call);
      if (generation === detailGeneration && read({}).expandedId === id) {
        set({ detailById: Object.freeze({ ...read({}).detailById, [id]: Object.freeze({ ...member }) }) });
      }

    } catch (error) {
      if (generation === detailGeneration && read({}).expandedId === id) {
        set({ detailError: report(error, 'Failed to load member detail.') });
      }
    }
    finally {
      if (generation === detailGeneration) {
        set({ detailLoadingId: null });
      }
    }
  }
  async function load(_required: Record<string, never>, _optional: Record<string, never> = {}) {
    if (!store.active({})) {
      return;
    }
    ++listGeneration;
    const generation = listGeneration;
    set({ error: null });
    try {
      const { members } = await api.listMembers({}, call);
      if (generation !== listGeneration || !store.active({})) {
        return;
      }

      ++detailGeneration;
      set({ members: Object.freeze(members.map(m => Object.freeze({ ...m }))), detailById: {}, detailError: null, detailLoadingId: null });
      const id = read({}).expandedId;
      if (id && row(id)) {
        await loadDetail(id);
      }
      else if (id) {
        set({ expandedId: null });
      } else {
        // With no expanded member, there is no detail selection to reconcile.
      }

    } catch (error) {
      if (generation === listGeneration) {
        set({ error: report(error, 'failed to load members') });
      }
    }
  }
  async function toggleDetail({ id }: { id: string }, _optional: Record<string, never> = {}) {
    if (!store.active({}) || !row(id)) {
      return;
    }

    ++detailGeneration;
    const next = read({}).expandedId === id ? null : id;
    set({ expandedId: next, detailError: null, detailLoadingId: null });
    if (next && !read({}).detailById[next]) {
      await loadDetail(next);
    }

  }
  async function resendSignInLink({ id }: { id: string }, _optional: Record<string, never> = {}) {
    const member = row(id); if (!member || !gate() || stateFor({ id }).resending) {
      return false;
    }

    patchRow(id, { resending: true, error: null, notice: null });
    let sent = false;
    try { await api.requestMemberMagicLink({ email: member.email }, call); patchRow(id, { notice: 'Sign-in link sent.' }); sent = store.active({}); }
    catch (error) { patchRow(id, { error: report(error, 'Failed to send sign-in link.') }); }
    finally { patchRow(id, { resending: false }); }
    return sent;
  }
  async function confirmDestructive(_required: Record<string, never>, _optional: Record<string, never> = {}) {
    const target = read({}).pending;
    if (!target || !gate() || read({}).confirming || !row(target.id)) {
      return false;
    }

    set({ confirming: true }); patchRow(target.id, { disabling: true, error: null, notice: null });
    let disabled = false;
    try {
      const { member } = await api.disableMember({ id: target.id }, call);
      // Invalidate older reads before applying the write response, including the cached detail.
      ++listGeneration; ++detailGeneration;
      set({
        members: Object.freeze(list().map(m => m.id === member.id ? Object.freeze({ ...member }) : m)),
        detailById: Object.freeze({ ...read({}).detailById, [member.id]: Object.freeze({ ...member }) }), detailLoadingId: null
      });
      patchRow(target.id, { notice: 'Member disabled.' }); disabled = store.active({});
    } catch (error) { patchRow(target.id, { error: report(error, 'Failed to disable member.') }); }
    finally {
      patchRow(target.id, { disabling: false }); if (read({}).pending === target) {
        set({ pending: null });
      }
      set({ confirming: false });
    }
    return disabled;
  }
  const unsubscribe = refresh?.subscribe({ onRefresh: () => { void load({}); } });
  return {
    getSnapshot: store.getSnapshot, subscribe: store.subscribe, load, stateFor, toggleDetail, resendSignInLink, confirmDestructive,
    requestDestructive({ id }: { id: string }, _optional: Record<string, never> = {}) {
      const member = row(id); if (gate() && member && member.status !== 'disabled' && !read({}).confirming) {
        set({ pending: Object.freeze({ ...member }) });
      }
    },
    cancelDestructive(_required: Record<string, never>, _optional: Record<string, never> = {}) {
      if (!read({}).confirming) {
        set({ pending: null });
      }
    },
    dispose(_required: Record<string, never> = {}, _optional: Record<string, never> = {}) { unsubscribe?.(); store.dispose({}); ++listGeneration; ++detailGeneration; },
  };
}
export type MembersController = ReturnType<typeof createMembersController>;
