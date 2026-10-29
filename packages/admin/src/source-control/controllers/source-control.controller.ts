import { createControllerStore } from '../../core/module/controller-store.js';
import type { SourceControlApiPort } from '../ports.js';
import type { SourceControlState, SourceControlDraft, SourceControlCredential, SourceControlConnection, SourceControlProviderInfo } from '../models.js';
import { blankSourceControlDraft, sourceControlProviders, defaultSourceControlCredential, sourceControlReady, buildSourceControlConnection, sourceControlSummary, sourceControlErrorMessage } from '../rules.js';
/** The provider and draft a save would submit, or null when the loaded state cannot accept a save for `providerId`. */
function readySaveTarget({ state, providerId }: { state: SourceControlState; providerId: string }): { info: SourceControlProviderInfo; draft: SourceControlDraft } | null {
  const draft = state.drafts[providerId] ?? blankSourceControlDraft({});
  const info = sourceControlProviders({ providers: state.providers, credentials: state.credentials }).find(p => p.id === providerId);
  return state.loaded && !draft.saving && info && sourceControlReady({ info, draft }) ? { info, draft } : null;
}
/** Replaces the row with `summary`'s id in place, or appends `summary` when it is new. */
function spliceCredential({ credentials, summary }: { credentials: readonly SourceControlCredential[]; summary: SourceControlCredential }): readonly SourceControlCredential[] {
  // Preserve server order: the first row is the defensive default when no row is marked default.
  return Object.freeze(credentials.some(c => c.id === summary.id) ? credentials.map(c => c.id === summary.id ? summary : c) : [...credentials, summary]);
}
export function createSourceControlController({ api, permissions = [] }: { api: SourceControlApiPort; permissions?: readonly string[] }, _optional = {}) {
  const grants = new Set(permissions), store = createControllerStore<SourceControlState>({ initial: { providers: [], credentials: [], drafts: {}, loading: false, loaded: false, error: null, catalogError: null } });
  let generation = 0, credentialRevision = 0;
  const canRead = () => !store.signal.aborted && grants.has('source-control.read');
  const canWrite = () => canRead() && grants.has('source-control.credentials.write');
  function patchDraft(id: string, patch: Partial<SourceControlDraft>) { const state = store.getSnapshot(); store.set({ patch: { drafts: { ...state.drafts, [id]: { ...(state.drafts[id] ?? blankSourceControlDraft({})), ...patch } } } }); }
  async function load(_required: Record<string, never>, _optional = {}) {
    if (!canRead()) return;
    generation += 1;
    const ticket = generation, revision = credentialRevision; store.set({ patch: { loading: true } });
    // Catalog failure must not hide saved connections; retain each successful store independently.
    await Promise.all([
      (async () => { try { const credentials = await api.list({}, { signal: store.signal }); if (ticket === generation && revision === credentialRevision) store.set({ patch: { credentials: credentials.map(row => sourceControlSummary({ row })), loaded: true, error: null } }); } catch { if (ticket === generation) store.set({ patch: { error: 'Connections unavailable' } }); } })(),
      (async () => { try { const providers = await api.providers({}, { signal: store.signal }); if (ticket === generation) store.set({ patch: { providers, catalogError: null } }); } catch { if (ticket === generation) store.set({ patch: { catalogError: 'Provider catalog unavailable' } }); } })(),
    ]); if (ticket === generation) store.set({ patch: { loading: false } });
  }
  /** Replaces the provider's current default credential, or creates one labelled 'default'. */
  function writeCredential({ current, connection }: { current: SourceControlCredential | undefined; connection: SourceControlConnection }) {
    return current ? api.update({ id: current.id, patch: { connection } }, { signal: store.signal }) : api.create({ label: 'default', connection }, { signal: store.signal });
  }
  async function save({ providerId }: { providerId: string }, _optional = {}) {
    const state = store.getSnapshot(), target = canWrite() ? readySaveTarget({ state, providerId }) : null;
    if (!target) return false;
    const current = defaultSourceControlCredential({ credentials: state.credentials, providerId }), connection = buildSourceControlConnection(target); patchDraft(providerId, { saving: true, error: null });
    try {
      const row = await writeCredential({ current, connection });
      if (store.signal.aborted) return false;
      credentialRevision++;
      // One round trip per write: splice the summary, then erase accepted secret drafts immediately.
      store.set({ patch: { credentials: spliceCredential({ credentials: store.getSnapshot().credentials, summary: sourceControlSummary({ row }) }) } }); patchDraft(providerId, blankSourceControlDraft({})); return true;
    } catch (error) { patchDraft(providerId, { saving: false, error: sourceControlErrorMessage({ error }) }); return false; }
  }
  return { getSnapshot: store.getSnapshot, subscribe: store.subscribe, load, save,
    setToken({ providerId, value }: { providerId: string; value: string }, _optional = {}) { if (canWrite() && !store.getSnapshot().drafts[providerId]?.saving) patchDraft(providerId, { token: value }); },
    setField({ providerId, name, value }: { providerId: string; name: string; value: string }, _optional = {}) { const draft = store.getSnapshot().drafts[providerId] ?? blankSourceControlDraft({}); if (canWrite() && !draft.saving) patchDraft(providerId, { values: { ...draft.values, [name]: value } }); },
    dispose(_required: Record<string, never> = {}, _optional = {}) { generation++; store.set({ patch: { drafts: {} } }); store.dispose(); },
  };
}
