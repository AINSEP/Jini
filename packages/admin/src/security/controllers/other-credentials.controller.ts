import { createControllerStore } from '../../core/module/controller-store.js';
import type { OtherCredentialsPort } from '../ports.js';
import type { OtherCredentialSummary, OtherStoreId } from '../models.js';
import { OTHER_STORES, otherWritePermission } from '../rules.js';
export function createOtherCredentialsController({ api, permissions = [] }: { api: OtherCredentialsPort; permissions?: readonly string[] }, _optional = {}) {
  const grants = new Set(permissions); let generation = 0;
  const store = createControllerStore({ initial: { rows: [] as readonly OtherCredentialSummary[], drafts: {} as Readonly<Record<string, string>>, errors: {} as Readonly<Record<string, string>>, loading: false, saving: false } });
  async function read(id: OtherStoreId, ticket: number) {
    try { const rows = await api.list({ store: id }, { signal: store.signal }); if (ticket === generation) { const errors = { ...store.getSnapshot().errors }; delete errors[id]; store.set({ patch: { rows: [...store.getSnapshot().rows.filter(r => r.store !== id), ...rows], errors } }); } }
    catch { if (ticket === generation) store.set({ patch: { errors: { ...store.getSnapshot().errors, [id]: 'Credential store unavailable' } } }); }
  }
  async function load(_required: Record<string, never>, _optional = {}) {
    if (store.signal.aborted || !grants.has('security.read')) return; const ticket = ++generation; store.set({ patch: { loading: true } });
    await Promise.all(OTHER_STORES.map(id => read(id, ticket))); if (ticket === generation) store.set({ patch: { loading: false } });
  }
  // One serial lane: whole-map media writes must read only after the previous write/refetch settled.
  // This is tab-local; cross-session races still require a server concurrency check.
  let lane = Promise.resolve();
  function write(row: OtherCredentialSummary, remove: boolean) {
    if (store.signal.aborted || !grants.has('security.read') || !grants.has(otherWritePermission({ store: row.store })) || (!remove && !row.supportsReplace)) return Promise.resolve(false);
    const token = store.getSnapshot().drafts[`${row.store}:${row.id}`]?.trim() ?? ''; if (!remove && !token) return Promise.resolve(false);
    const run = lane.then(async () => {
      if (store.signal.aborted) return false; store.set({ patch: { saving: true } });
      try {
        if (remove) await api.remove({ store: row.store, id: row.id }, { signal: store.signal }); else await api.replace({ store: row.store, id: row.id, token }, { signal: store.signal });
        const drafts = { ...store.getSnapshot().drafts }; delete drafts[`${row.store}:${row.id}`]; store.set({ patch: { drafts } });
        await read(row.store, generation); return !store.signal.aborted;
      } catch { store.set({ patch: { errors: { ...store.getSnapshot().errors, [row.store]: 'Unable to update credential' } } }); return false; }
      finally { store.set({ patch: { saving: false } }); }
    }); lane = run.then(() => undefined); return run;
  }
  return {
    getSnapshot: store.getSnapshot, subscribe: store.subscribe, load,
    setDraft({ key, token }: { key: string; token: string }, _optional = {}) { if (!store.signal.aborted && !store.getSnapshot().saving) store.set({ patch: { drafts: { ...store.getSnapshot().drafts, [key]: token } } }); },
    replace({ row }: { row: OtherCredentialSummary }, _optional = {}) { return write(row, false); },
    remove({ row }: { row: OtherCredentialSummary }, _optional = {}) { return write(row, true); },
    dispose(_required: Record<string, never> = {}, _optional = {}) { generation++; store.dispose(); },
  };
}
