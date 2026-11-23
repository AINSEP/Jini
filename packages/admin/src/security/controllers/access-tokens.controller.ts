import { createControllerStore } from '@jini-ai/core/admin-runtime';
import type { SecurityApiPort } from '../ports.js';
import type { CredentialSummary, CredentialProvider, CredentialDraft, CredentialKind, CredentialCategory, CredentialInput, CredentialStoreSnapshot } from '../models.js';
import type { AdminPublishCredentialVerification, AdminPublishExecutionMode } from '@jini-ai/core/contracts/site/api-security-api-types';
import { blankCredentialDraft, buildCredentialPatch, credentialCategory, credentialStore, validateCredentialDraft, writePermission, credentialLabel } from '../rules.js';
/** An edit draft never carries the saved secret: token and extra values start blank. */
function draftFromRow({ row, providers }: { row: CredentialSummary; providers: readonly CredentialProvider[] }, _optional = {}): CredentialDraft {
  return { ...blankCredentialDraft({ kind: row.kind, providerId: row.providerId }), id: row.id, label: credentialLabel({ row, providers }), category: credentialCategory({ row }), baseUrl: row.baseUrl ?? '', additionalHosts: row.additionalHosts?.join('\n') ?? '', username: row.username ?? '' };
}
function createAccessTokenStore() {
  return createControllerStore({ initial: { rows: [] as readonly CredentialSummary[], providers: [] as readonly CredentialProvider[], draft: null as CredentialDraft | null, executionMode: null as AdminPublishExecutionMode | null, verifications: {} as Readonly<Record<string, AdminPublishCredentialVerification>>, loading: false, saving: false, error: null as string | null, errors: {} as Readonly<Record<string, string>>, query: '', category: 'all' as CredentialCategory | 'all' } });
}
/** `snapshot` carries store-level facts (the publish `executionMode`); a port with only `list` still loads. */
async function readStore({ api, kind, signal }: { api: SecurityApiPort; kind: CredentialKind; signal: AbortSignal }, _optional = {}): Promise<CredentialStoreSnapshot> {
  const target = credentialStore({ api, kind });
  return target.snapshot ? target.snapshot({}, { signal }) : { rows: await target.list({}, { signal }) };
}
/** The server keeps a verify result in memory only, so a refetch drops it from rows; the controller remembers it per row. */
function rememberVerification({ verifications, row }: { verifications: Readonly<Record<string, AdminPublishCredentialVerification>>; row: CredentialSummary }, _optional = {}) {
  return row.lastVerification ? { verifications: { ...verifications, [`${row.kind}:${row.id}`]: row.lastVerification } } : {};
}
/** Source control first, then publish (the category order), whichever catalog settles first. */
function mergeCatalog({ current, kind, found }: { current: readonly CredentialProvider[]; kind: 'publish' | 'source-control'; found: readonly CredentialProvider[] }, _optional = {}) {
  return Object.freeze((['source-control', 'publish'] as const).flatMap(k => (k === kind ? found : current).filter(p => p.kind === k)));
}
function createCredentialLoader(
  api: SecurityApiPort,
  store: ReturnType<typeof createAccessTokenStore>,
  { grants, nextGeneration, isCurrent }: { grants: Set<string>; nextGeneration: () => number; isCurrent: (ticket: number) => boolean },
) {
  return async function load(_required: Record<string, never>, _optional = {}) {
    if (store.signal.aborted || !grants.has('security.read')) return;
    const ticket = nextGeneration(); store.set({ patch: { loading: true } });
    // Independent stores retain their own successful results; one unavailable store cannot hide the rest.
    const kinds = ['publish', 'source-control', 'custom'] as const;
    const tasks = kinds.map(async kind => {
      try { const { rows, executionMode } = await readStore({ api, kind, signal: store.signal }); if (isCurrent(ticket)) { const errors = { ...store.getSnapshot().errors }; delete errors[kind]; store.set({ patch: { rows: Object.freeze([...store.getSnapshot().rows.filter(r => r.kind !== kind), ...rows]), errors, ...(executionMode ? { executionMode } : {}) } }); } }
      catch { if (isCurrent(ticket)) store.set({ patch: { errors: { ...store.getSnapshot().errors, [kind]: 'Credential store unavailable' } } }); }
    });
    // The two catalogs load independently: one failing leaves the other shown.
    const catalogs = (['publish', 'source-control'] as const).map(async kind => {
      try { const found = await api.providers({ kind }, { signal: store.signal }); if (isCurrent(ticket)) store.set({ patch: { providers: mergeCatalog({ current: store.getSnapshot().providers, kind, found }) } }); return true; } catch { return false; }
    });
    tasks.push((async () => { const ok = await Promise.all(catalogs); if (isCurrent(ticket)) store.set({ patch: { error: ok.every(Boolean) ? null : 'Provider catalog unavailable' } }); })());
    await Promise.all(tasks); if (isCurrent(ticket)) store.set({ patch: { loading: false } });
  }
}

export function createAccessTokensController({ api, permissions = [] }: { api: SecurityApiPort; permissions?: readonly string[] }, _optional = {}) {
  const grants = new Set(permissions);
  const store = createAccessTokenStore();
  let generation = 0;
  const allowed = (kind: CredentialKind) => !store.signal.aborted && grants.has('security.read') && grants.has(writePermission({ kind }));
  const load = createCredentialLoader(api, store, { grants, nextGeneration: () => ++generation, isCurrent: ticket => ticket === generation });
  function begin({ row, kind, providerId }: { row?: CredentialSummary; kind?: CredentialKind; providerId?: string }, _optional = {}) {
    const k = row?.kind ?? kind ?? 'custom'; if (!allowed(k) || store.getSnapshot().saving) return;
    const draft = row ? draftFromRow({ row, providers: store.getSnapshot().providers }) : blankCredentialDraft({ kind: k, ...(providerId ? { providerId } : {}) });
    store.set({ patch: { draft, error: null } });
  }
  async function save(_required: Record<string, never>, _optional = {}) {
    const state = store.getSnapshot(), draft = state.draft; if (!draft || !allowed(draft.kind) || state.saving) return false;
    const error = validateCredentialDraft({ draft, rows: state.rows, providers: state.providers }); if (error) { store.set({ patch: { error } }); return false; }
    const patch = buildCredentialPatch({ draft, providers: state.providers }); const target = credentialStore({ api, kind: draft.kind });
    return mutate({ failure: 'Unable to save credential', run: async () => {
      const row = draft.id ? await target.update({ id: draft.id, patch }, { signal: store.signal }) : await target.create(patch as CredentialInput, { signal: store.signal });
      // Clear accepted secrets before any later read can fail. A successful save must never leave a saved secret visible.
      store.set({ patch: { draft: null, rows: Object.freeze([...store.getSnapshot().rows.filter(r => !(r.kind === row.kind && r.id === row.id)), row]), ...rememberVerification({ verifications: store.getSnapshot().verifications, row }) } });
    } });
  }
  async function write({ row, remove }: { row: CredentialSummary; remove: boolean }) {
    if (!allowed(row.kind) || store.getSnapshot().saving) return false;
    return mutate({ failure: 'Unable to update credential', run: async () => {
      const target = credentialStore({ api, kind: row.kind });
      if (remove) await target.remove({ id: row.id }, { signal: store.signal }); else await target.update({ id: row.id, patch: { isDefault: true } }, { signal: store.signal });
    } });
  }
  /** Re-checks one saved publish credential; the result is kept per row and the refetch heals `accountLabel`. */
  async function verify({ row }: { row: CredentialSummary }, _optional = {}) {
    const check = credentialStore({ api, kind: row.kind }).verify; if (!check || !allowed(row.kind) || store.getSnapshot().saving) return false;
    return mutate({ failure: 'Unable to check credential', run: async () => {
      const lastVerification = await check({ id: row.id }, { signal: store.signal });
      store.set({ patch: rememberVerification({ verifications: store.getSnapshot().verifications, row: { ...row, lastVerification } }) });
    } });
  }
  /** Shared write lifecycle: one write at a time, a fixed failure message, and a refetch after success. */
  async function mutate({ run, failure }: { run: () => Promise<void>; failure: string }, _optional = {}) {
    store.set({ patch: { saving: true, error: null } }); let ok = false;
    try {
      await run();
      // First-create default assignment can change siblings; the server owns that invariant.
      // Remove/default can promote another row. Refetch rather than duplicating server promotion rules.
      await load({}); ok = !store.signal.aborted;
    } catch { store.set({ patch: { error: failure } }); }
    finally { store.set({ patch: { saving: false } }); }
    return ok;
  }
  return {
    getSnapshot: store.getSnapshot, subscribe: store.subscribe, load, begin, save, verify,
    setDraft({ patch }: { patch: Partial<Omit<CredentialDraft, 'kind' | 'id' | 'providerId'>> }, _optional = {}) { const draft = store.getSnapshot().draft; if (draft && allowed(draft.kind) && !store.getSnapshot().saving) store.set({ patch: { draft: { ...draft, ...patch } } }); },
    cancel(_required: Record<string, never>, _optional = {}) { if (!store.getSnapshot().saving) store.set({ patch: { draft: null, error: null } }); },
    filter({ query, category }: { query?: string; category?: CredentialCategory | 'all' }, _optional = {}) { store.set({ patch: { ...(query !== undefined ? { query } : {}), ...(category ? { category } : {}) } }); },
    remove({ row }: { row: CredentialSummary }, _optional = {}) { return write({ row, remove: true }); },
    makeDefault({ row }: { row: CredentialSummary }, _optional = {}) { if (row.kind === 'custom') return Promise.resolve(false);
      return write({ row, remove: false }); },
    dispose(_required: Record<string, never> = {}, _optional = {}) { generation++; store.dispose(); },
  };
}
