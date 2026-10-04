import { createControllerStore } from '../../core/module/controller-store.js';
import type { SecurityApiPort } from '../ports.js';
import type { CredentialSummary, CredentialProvider, CredentialDraft, CredentialKind, CredentialCategory, CredentialInput } from '../models.js';
import { blankCredentialDraft, buildCredentialPatch, credentialStore, validateCredentialDraft, writePermission, credentialLabel } from '../rules.js';
export function createAccessTokensController({ api, permissions = [] }: { api: SecurityApiPort; permissions?: readonly string[] }, _optional = {}) {
  const grants = new Set(permissions);
  const store = createControllerStore({ initial: { rows: [] as readonly CredentialSummary[], providers: [] as readonly CredentialProvider[], draft: null as CredentialDraft | null, loading: false, saving: false, error: null as string | null, errors: {} as Readonly<Record<string, string>>, query: '', category: 'all' as CredentialCategory | 'all' } });
  let generation = 0;
  const allowed = (kind: CredentialKind) => !store.signal.aborted && grants.has('security.read') && grants.has(writePermission({ kind }));
  async function load(_required: Record<string, never>, _optional = {}) {
    if (store.signal.aborted || !grants.has('security.read')) return;
    const ticket = ++generation; store.set({ patch: { loading: true } });
    // Independent stores retain their own successful results; one unavailable store cannot hide the rest.
    const kinds = ['publish', 'source-control', 'custom'] as const;
    const tasks = kinds.map(async kind => {
      try { const rows = await credentialStore({ api, kind }).list({}, { signal: store.signal }); if (ticket === generation) { const errors = { ...store.getSnapshot().errors }; delete errors[kind]; store.set({ patch: { rows: Object.freeze([...store.getSnapshot().rows.filter(r => r.kind !== kind), ...rows]), errors } }); } }
      catch { if (ticket === generation) store.set({ patch: { errors: { ...store.getSnapshot().errors, [kind]: 'Credential store unavailable' } } }); }
    });
    tasks.push((async () => { try { const providers = await api.providers({}, { signal: store.signal }); if (ticket === generation) store.set({ patch: { providers, error: null } }); } catch { if (ticket === generation) store.set({ patch: { error: 'Provider catalog unavailable' } }); } })());
    await Promise.all(tasks); if (ticket === generation) store.set({ patch: { loading: false } });
  }
  function begin({ row, kind, providerId }: { row?: CredentialSummary; kind?: CredentialKind; providerId?: string }, _optional = {}) {
    const k = row?.kind ?? kind ?? 'custom'; if (!allowed(k) || store.getSnapshot().saving) return;
    const draft = row ? { ...blankCredentialDraft({ kind: row.kind, providerId: row.providerId }), id: row.id, label: credentialLabel({ row, providers: store.getSnapshot().providers }), category: row.category ?? (row.kind === 'publish' ? 'hosting' : row.kind === 'source-control' ? 'source-control' : 'general'), baseUrl: row.baseUrl ?? '', additionalHosts: row.additionalHosts?.join('\n') ?? '', username: row.username ?? '' } : blankCredentialDraft({ kind: k, ...(providerId ? { providerId } : {}) });
    store.set({ patch: { draft, error: null } });
  }
  async function save(_required: Record<string, never>, _optional = {}) {
    const state = store.getSnapshot(), draft = state.draft; if (!draft || !allowed(draft.kind) || state.saving) return false;
    const error = validateCredentialDraft({ draft, rows: state.rows, providers: state.providers }); if (error) { store.set({ patch: { error } }); return false; }
    const patch = buildCredentialPatch({ draft, providers: state.providers }); const target = credentialStore({ api, kind: draft.kind }); store.set({ patch: { saving: true, error: null } });
    try {
      const row = draft.id ? await target.update({ id: draft.id, patch }, { signal: store.signal }) : await target.create(patch as CredentialInput, { signal: store.signal });
      // Clear accepted secrets before any later read can fail. A successful save must never leave a saved secret visible.
      store.set({ patch: { draft: null, rows: Object.freeze([...store.getSnapshot().rows.filter(r => !(r.kind === row.kind && r.id === row.id)), row]) } });
      // First-create default assignment can change siblings; the server owns that invariant.
      await load({}); return !store.signal.aborted;
    } catch { store.set({ patch: { error: 'Unable to save credential' } }); return false; }
    finally { store.set({ patch: { saving: false } }); }
  }
  async function write({ row, remove }: { row: CredentialSummary; remove: boolean }) {
    if (!allowed(row.kind) || store.getSnapshot().saving) return false; store.set({ patch: { saving: true, error: null } });
    try {
      const target = credentialStore({ api, kind: row.kind });
      if (remove) await target.remove({ id: row.id }, { signal: store.signal }); else await target.update({ id: row.id, patch: { isDefault: true } }, { signal: store.signal });
      // Remove/default can promote another row. Refetch rather than duplicating server promotion rules.
      await load({}); return !store.signal.aborted;
    } catch { store.set({ patch: { error: 'Unable to update credential' } }); return false; }
    finally { store.set({ patch: { saving: false } }); }
  }
  return {
    getSnapshot: store.getSnapshot, subscribe: store.subscribe, load, begin, save,
    setDraft({ patch }: { patch: Partial<Omit<CredentialDraft, 'kind' | 'id' | 'providerId'>> }, _optional = {}) { const draft = store.getSnapshot().draft; if (draft && allowed(draft.kind) && !store.getSnapshot().saving) store.set({ patch: { draft: { ...draft, ...patch } } }); },
    cancel(_required: Record<string, never>, _optional = {}) { if (!store.getSnapshot().saving) store.set({ patch: { draft: null, error: null } }); },
    filter({ query, category }: { query?: string; category?: CredentialCategory | 'all' }, _optional = {}) { store.set({ patch: { ...(query !== undefined ? { query } : {}), ...(category ? { category } : {}) } }); },
    remove({ row }: { row: CredentialSummary }, _optional = {}) { return write({ row, remove: true }); },
    makeDefault({ row }: { row: CredentialSummary }, _optional = {}) { if (row.kind === 'custom') return Promise.resolve(false); return write({ row, remove: false }); },
    dispose(_required: Record<string, never> = {}, _optional = {}) { generation++; store.dispose(); },
  };
}
