import { createControllerStore } from '@jini-ai/core/admin-runtime';
import type { SecurityApiPort } from '../ports.js';
import type { CredentialSummary, CredentialProvider, CredentialDraft, CredentialKind, CredentialCategory, CredentialInput, CredentialStoreSnapshot } from '../models.js';
import type { AdminPublishCredentialVerification, AdminPublishExecutionMode } from '@jini-ai/core/contracts/site/api-security-api-types';
import { credentialFailureText, redactSecrets, type CredentialDraftError, type DescribeCredentialError } from '../credential-failure.js';
import type { SecurityRefreshSignal } from '../ports.js';
import type { SavedCredentialFacts } from '../credential-forms.rules.js';
import { blankCredentialDraft, buildCredentialPatch, credentialCategory, credentialStore, validateCredentialDraft, writePermission, credentialLabel } from '../rules.js';
/** An edit draft never carries the saved secret: token and extra values start blank. */
function draftFromRow({ row, providers }: { row: CredentialSummary; providers: readonly CredentialProvider[] }, _optional = {}): CredentialDraft {
  return { ...blankCredentialDraft({ kind: row.kind, providerId: row.providerId }), id: row.id, label: credentialLabel({ row, providers }), category: credentialCategory({ row }), baseUrl: row.baseUrl ?? '', additionalHosts: row.additionalHosts?.join('\n') ?? '', username: row.username ?? '', ...(row.worksFor ? { worksFor: [...row.worksFor] } : {}) };
}
function createAccessTokenStore() {
  return createControllerStore({ initial: { rows: [] as readonly CredentialSummary[], providers: [] as readonly CredentialProvider[], draft: null as CredentialDraft | null, executionMode: null as AdminPublishExecutionMode | null, verifications: {} as Readonly<Record<string, AdminPublishCredentialVerification>>, projectKeysAvailable: null as boolean | null, keyUse: {} as Readonly<Record<string, { saving: boolean; failed: boolean }>>, loading: false, saving: false, error: null as string | null, errors: {} as Readonly<Record<string, string>>, query: '', category: 'all' as CredentialCategory | 'all' } });
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
/** Store-level facts a snapshot carries; an absent fact keeps the previous value. */
function storeFacts({ facts: { executionMode, projectKeysAvailable } }: { facts: Omit<CredentialStoreSnapshot, 'rows'> }, _optional = {}) {
  return { ...(executionMode ? { executionMode } : {}), ...(projectKeysAvailable !== undefined ? { projectKeysAvailable } : {}) };
}
/** A new custom key goes to the project when the store offers it; the field is sent only when the store said either way. */
function withStorage({ draft, patch, available }: { draft: CredentialDraft; patch: CredentialInput; available: boolean | null }, _optional = {}): CredentialInput {
  return draft.kind === 'custom' && !draft.id && available !== null ? { scope: available ? 'project' : 'site', ...patch } : patch;
}
/** What an edit is compared against: the row as saved, named by the label its draft started from. */
function savedFacts({ draft, rows, providers }: { draft: CredentialDraft; rows: readonly CredentialSummary[]; providers: readonly CredentialProvider[] }, _optional = {}): SavedCredentialFacts | undefined {
  const row = draft.id ? rows.find(r => r.kind === draft.kind && r.id === draft.id) : undefined;
  return row ? { ...row, label: credentialLabel({ row, providers }, { rows }) } : undefined;
}
/** The body the current draft would send; `null` when there is no draft. An edit with nothing changed is `{}`. */
function pendingPatch({ draft, rows, providers }: { draft: CredentialDraft | null; rows: readonly CredentialSummary[]; providers: readonly CredentialProvider[] }, _optional = {}) {
  if (!draft) return null;
  const saved = savedFacts({ draft, rows, providers });
  return buildCredentialPatch({ draft, providers }, saved ? { saved } : {});
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
      try { const { rows, ...facts } = await readStore({ api, kind, signal: store.signal }); if (isCurrent(ticket)) { const errors = { ...store.getSnapshot().errors }; delete errors[kind]; store.set({ patch: { rows: Object.freeze([...store.getSnapshot().rows.filter(r => r.kind !== kind), ...rows]), errors, ...storeFacts({ facts }) } }); } }
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
/** Host collaborators (SEC-14): the content-refresh subscription, the failure describer and the draft token check. */
export interface AccessTokensControllerOptions { readonly refreshSignal?: SecurityRefreshSignal | undefined; readonly describeError?: DescribeCredentialError | undefined; readonly draftError?: CredentialDraftError | undefined }
export function createAccessTokensController({ api, permissions = [] }: { api: SecurityApiPort; permissions?: readonly string[] }, { refreshSignal, describeError, draftError }: AccessTokensControllerOptions = {}) {
  const grants = new Set(permissions);
  const store = createAccessTokenStore();
  let generation = 0;
  const allowed = (kind: CredentialKind) => !store.signal.aborted && grants.has('security.read') && grants.has(writePermission({ kind }));
  const load = createCredentialLoader(api, store, { grants, nextGeneration: () => ++generation, isCurrent: ticket => ticket === generation });
  const unsubscribe = refreshSignal?.subscribe({ onRefresh: () => { void load({}); } });
  function begin({ row, kind, providerId }: { row?: CredentialSummary; kind?: CredentialKind; providerId?: string }, _optional = {}) {
    const k = row?.kind ?? kind ?? 'custom'; if (!allowed(k) || store.getSnapshot().saving) return;
    const draft = row ? draftFromRow({ row, providers: store.getSnapshot().providers }) : blankCredentialDraft({ kind: k, ...(providerId ? { providerId } : {}) });
    store.set({ patch: { draft, error: null } });
  }
  /** The host's draft check: a create must carry a token, an edit may leave it blank. Its copy is cut against the typed draft. */
  function refusedToken({ draft }: { draft: CredentialDraft }, _optional = {}) {
    const text = draftError?.({ value: draft.token }, { required: !draft.id });
    return text ? redactSecrets({ text, secrets: [draft.token] }) : null;
  }
  async function save(_required: Record<string, never>, _optional = {}) {
    const state = store.getSnapshot(), draft = state.draft; if (!draft || !allowed(draft.kind) || state.saving) return false;
    const error = validateCredentialDraft({ draft, rows: state.rows, providers: state.providers }) ?? refusedToken({ draft }); if (error) { store.set({ patch: { error } }); return false; }
    const patch = pendingPatch({ draft, rows: state.rows, providers: state.providers })!; const target = credentialStore({ api, kind: draft.kind });
    // An edit that changes nothing has no diff to send: no write, and the draft stays open.
    if (draft.id && Object.keys(patch).length === 0) return false;
    return mutate({ failure: 'Unable to save credential', secrets: [draft.token, ...Object.values(draft.values)], run: async () => {
      const row = draft.id ? await target.update({ id: draft.id, patch }, { signal: store.signal }) : await target.create(withStorage({ draft, patch: patch as CredentialInput, available: state.projectKeysAvailable }), { signal: store.signal });
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
  function markKeyUse({ id, saving, failed }: { id: string; saving: boolean; failed: boolean }, _optional = {}) { store.set({ patch: { keyUse: { ...store.getSnapshot().keyUse, [id]: { saving, failed } } } }); }
  /** Attaches (`use: true`) or detaches a project key on this site, then refetches its usage. One request per key at a
   * time; a failure stays on that row and leaves the usage as it was. */
  async function attachKey({ row, use }: { row: CredentialSummary; use: boolean }, _optional = {}) {
    if (!api.useProjectKey || row.scope !== 'project' || !allowed(row.kind) || store.getSnapshot().keyUse[row.id]?.saving) return false;
    markKeyUse({ id: row.id, saving: true, failed: false });
    try { await api.useProjectKey({ keyId: row.id, use }, { signal: store.signal }); await load({}); markKeyUse({ id: row.id, saving: false, failed: false }); return true; }
    catch { markKeyUse({ id: row.id, saving: false, failed: true }); return false; }
  }
  /** Shared write lifecycle: one write at a time, a fixed (or host-described, redacted) failure message, and a refetch after success. */
  async function mutate({ run, failure, secrets = [] }: { run: () => Promise<void>; failure: string; secrets?: readonly string[] }, _optional = {}) {
    store.set({ patch: { saving: true, error: null } }); let ok = false;
    try {
      await run();
      // First-create default assignment can change siblings; the server owns that invariant.
      // Remove/default can promote another row. Refetch rather than duplicating server promotion rules.
      await load({}); ok = !store.signal.aborted;
    } catch (error) { store.set({ patch: { error: credentialFailureText({ error, fallback: failure, secrets }, { describeError }) } }); }
    finally { store.set({ patch: { saving: false } }); }
    return ok;
  }
  return {
    getSnapshot: store.getSnapshot, subscribe: store.subscribe, load, begin, save, verify, attachKey,
    /** Whether the current draft has anything to send: a create always does, an edit only once something changed.
     * Only a boolean leaves here, so the typed secret never reaches a view through this read. */
    hasChanges(_required: Record<string, never> = {}, _optional = {}) { const s = store.getSnapshot(); const patch = pendingPatch({ draft: s.draft, rows: s.rows, providers: s.providers }); return patch !== null && (!s.draft?.id || Object.keys(patch).length > 0); },
    setDraft({ patch }: { patch: Partial<Omit<CredentialDraft, 'kind' | 'id' | 'providerId'>> }, _optional = {}) { const draft = store.getSnapshot().draft; if (draft && allowed(draft.kind) && !store.getSnapshot().saving) store.set({ patch: { draft: { ...draft, ...patch } } }); },
    cancel(_required: Record<string, never>, _optional = {}) { if (!store.getSnapshot().saving) store.set({ patch: { draft: null, error: null } }); },
    filter({ query, category }: { query?: string; category?: CredentialCategory | 'all' }, _optional = {}) { store.set({ patch: { ...(query !== undefined ? { query } : {}), ...(category ? { category } : {}) } }); },
    remove({ row }: { row: CredentialSummary }, _optional = {}) { return write({ row, remove: true }); },
    makeDefault({ row }: { row: CredentialSummary }, _optional = {}) { if (row.kind === 'custom') return Promise.resolve(false);
      return write({ row, remove: false }); },
    dispose(_required: Record<string, never> = {}, _optional = {}) { generation++; unsubscribe?.(); store.dispose(); },
  };
}
