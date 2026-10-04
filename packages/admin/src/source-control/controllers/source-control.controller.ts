import { createControllerStore } from '../../core/module/controller-store.js';
import type { SourceControlApiPort } from '../ports.js';
import type { SourceControlState, SourceControlDraft } from '../models.js';
import { blankSourceControlDraft, sourceControlProviders, defaultSourceControlCredential, sourceControlReady, buildSourceControlConnection, sourceControlSummary, sourceControlErrorMessage } from '../rules.js';
export function createSourceControlController({ api, permissions = [] }: { api: SourceControlApiPort; permissions?: readonly string[] }, _optional = {}) {
  const grants = new Set(permissions), store = createControllerStore<SourceControlState>({ initial: { providers: [], credentials: [], drafts: {}, loading: false, loaded: false, error: null, catalogError: null } });
  let generation = 0, credentialRevision = 0;
  const canRead = () => !store.signal.aborted && grants.has('source-control.read');
  const canWrite = () => canRead() && grants.has('source-control.credentials.write');
  function patchDraft(id: string, patch: Partial<SourceControlDraft>) { const state = store.getSnapshot(); store.set({ patch: { drafts: { ...state.drafts, [id]: { ...(state.drafts[id] ?? blankSourceControlDraft({})), ...patch } } } }); }
  async function load(_required: Record<string, never>, _optional = {}) {
    if (!canRead()) return; const ticket = ++generation, revision = credentialRevision; store.set({ patch: { loading: true } });
    // Catalog failure must not hide saved connections; retain each successful store independently.
    await Promise.all([
      (async () => { try { const credentials = await api.list({}, { signal: store.signal }); if (ticket === generation && revision === credentialRevision) store.set({ patch: { credentials: credentials.map(row => sourceControlSummary({ row })), loaded: true, error: null } }); } catch { if (ticket === generation) store.set({ patch: { error: 'Connections unavailable' } }); } })(),
      (async () => { try { const providers = await api.providers({}, { signal: store.signal }); if (ticket === generation) store.set({ patch: { providers, catalogError: null } }); } catch { if (ticket === generation) store.set({ patch: { catalogError: 'Provider catalog unavailable' } }); } })(),
    ]); if (ticket === generation) store.set({ patch: { loading: false } });
  }
  async function save({ providerId }: { providerId: string }, _optional = {}) {
    const state = store.getSnapshot(), draft = state.drafts[providerId] ?? blankSourceControlDraft({});
    const info = sourceControlProviders({ providers: state.providers, credentials: state.credentials }).find(p => p.id === providerId);
    if (!canWrite() || !state.loaded || draft.saving || !info || !sourceControlReady({ info, draft })) return false;
    const current = defaultSourceControlCredential({ credentials: state.credentials, providerId }), connection = buildSourceControlConnection({ info, draft }); patchDraft(providerId, { saving: true, error: null });
    try {
      const row = current ? await api.update({ id: current.id, patch: { connection } }, { signal: store.signal }) : await api.create({ label: 'default', connection }, { signal: store.signal });
      if (store.signal.aborted) return false; credentialRevision++;
      // One round trip per write: splice the summary, then erase accepted secret drafts immediately.
      const credentials = store.getSnapshot().credentials, summary = sourceControlSummary({ row });
      // Preserve server order: the first row is the defensive default when no row is marked default.
      store.set({ patch: { credentials: Object.freeze(credentials.some(c => c.id === row.id) ? credentials.map(c => c.id === row.id ? summary : c) : [...credentials, summary]) } }); patchDraft(providerId, blankSourceControlDraft({})); return true;
    } catch (error) { patchDraft(providerId, { saving: false, error: sourceControlErrorMessage({ error }) }); return false; }
  }
  return { getSnapshot: store.getSnapshot, subscribe: store.subscribe, load, save,
    setToken({ providerId, value }: { providerId: string; value: string }, _optional = {}) { if (canWrite() && !store.getSnapshot().drafts[providerId]?.saving) patchDraft(providerId, { token: value }); },
    setField({ providerId, name, value }: { providerId: string; name: string; value: string }, _optional = {}) { const draft = store.getSnapshot().drafts[providerId] ?? blankSourceControlDraft({}); if (canWrite() && !draft.saving) patchDraft(providerId, { values: { ...draft.values, [name]: value } }); },
    dispose(_required: Record<string, never> = {}, _optional = {}) { generation++; store.set({ patch: { drafts: {} } }); store.dispose(); },
  };
}
