import { createControllerStore } from '@jini-ai/core/admin-runtime';
import type { OtherCredentialsPort, SecurityRefreshSignal } from '../ports.js';
import type { OtherCredentialSummary, OtherStoreId } from '../models.js';
import { OTHER_STORES, otherWritePermission } from '../rules.js';
import { credentialFailureText, type DescribeCredentialError } from '../credential-failure.js';
/** Host collaborators (SEC-14): the content-refresh subscription and the failure describer. */
export interface OtherCredentialsControllerOptions { readonly refreshSignal?: SecurityRefreshSignal | undefined; readonly describeError?: DescribeCredentialError | undefined }
const rowKey = (row: Pick<OtherCredentialSummary, 'store' | 'id'>) => `${row.store}:${row.id}`;
function without<T>(record: Readonly<Record<string, T>>, key: string) { const next = { ...record }; delete next[key]; return next; }
function createOtherStore() {
  return createControllerStore({ initial: { rows: [] as readonly OtherCredentialSummary[], drafts: {} as Readonly<Record<string, string>>, errors: {} as Readonly<Record<string, string>>,
    // `loaded`: stores whose last read settled, so an empty one is a fact a placeholder may state.
    // `pending` / `rowErrors`: per-row write feedback, keyed `store:id`.
    rowErrors: {} as Readonly<Record<string, string>>, loaded: {} as Readonly<Record<string, boolean>>, pending: null as string | null, loading: false, saving: false } });
}
export function createOtherCredentialsController({ api, permissions = [] }: { api: OtherCredentialsPort; permissions?: readonly string[] }, { refreshSignal, describeError }: OtherCredentialsControllerOptions = {}) {
  const grants = new Set(permissions); let generation = 0;
  const store = createOtherStore();
  async function read(id: OtherStoreId, ticket: number) {
    try { const rows = await api.list({ store: id }, { signal: store.signal }); if (ticket === generation) { const s = store.getSnapshot(); store.set({ patch: { rows: [...s.rows.filter(r => r.store !== id), ...rows], errors: without(s.errors, id), loaded: { ...s.loaded, [id]: true } } }); } }
    catch { if (ticket === generation) { const s = store.getSnapshot(); store.set({ patch: { errors: { ...s.errors, [id]: 'Credential store unavailable' }, loaded: without(s.loaded, id) } }); } }
  }
  async function load(_required: Record<string, never>, _optional = {}) {
    if (store.signal.aborted || !grants.has('security.read')) return;
    generation += 1;
    const ticket = generation; store.set({ patch: { loading: true } });
    await Promise.all(OTHER_STORES.map(id => read(id, ticket))); if (ticket === generation) store.set({ patch: { loading: false } });
  }
  const unsubscribe = refreshSignal?.subscribe({ onRefresh: () => { void load({}); } });
  // One serial lane: whole-map media writes must read only after the previous write/refetch settled.
  // This is tab-local; cross-session races still require a server concurrency check.
  let lane = Promise.resolve();
  async function attempt(row: OtherCredentialSummary, remove: boolean, token: string) {
    const key = rowKey(row);
    store.set({ patch: { saving: true, pending: key } });
    // One exit after `finally`: a catch that returned left a fall-through path nothing could take.
    let saved = false;
    try {
      if (remove) await api.remove({ store: row.store, id: row.id }, { signal: store.signal }); else await api.replace({ store: row.store, id: row.id, token }, { signal: store.signal });
      const s = store.getSnapshot(); store.set({ patch: { drafts: without(s.drafts, key), rowErrors: without(s.rowErrors, key) } });
      await read(row.store, generation); saved = !store.signal.aborted;
    } catch (error) {
      // The submitted token is an exact secret: whatever the describer returns, it is cut out.
      store.set({ patch: { rowErrors: { ...store.getSnapshot().rowErrors, [key]: credentialFailureText({ error, fallback: 'Unable to update credential', secrets: [token] }, { describeError }) } } });
    } finally { store.set({ patch: { saving: false, pending: null } }); }
    return saved;
  }
  function write(row: OtherCredentialSummary, remove: boolean) {
    const permitted = grants.has('security.read') && grants.has(otherWritePermission({ store: row.store }));
    if (store.signal.aborted || !permitted || (!remove && !row.supportsReplace)) return Promise.resolve(false);
    const token = store.getSnapshot().drafts[rowKey(row)]?.trim() ?? ''; if (!remove && !token) return Promise.resolve(false);
    const run = lane.then(() => (store.signal.aborted ? false : attempt(row, remove, token))); lane = run.then(() => undefined); return run;
  }
  return {
    getSnapshot: store.getSnapshot, subscribe: store.subscribe, load,
    setDraft({ key, token }: { key: string; token: string }, _optional = {}) { if (!store.signal.aborted && !store.getSnapshot().saving) store.set({ patch: { drafts: { ...store.getSnapshot().drafts, [key]: token } } }); },
    replace({ row }: { row: OtherCredentialSummary }, _optional = {}) { return write(row, false); },
    remove({ row }: { row: OtherCredentialSummary }, _optional = {}) { return write(row, true); },
    dispose(_required: Record<string, never> = {}, _optional = {}) { generation++; unsubscribe?.(); store.dispose(); },
  };
}
