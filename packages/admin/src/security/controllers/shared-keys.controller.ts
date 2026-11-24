import { createControllerStore } from '@jini-ai/core/admin-runtime';
import type { AdminCredentialCopyResult, AdminCredentialCopySource } from '@jini-ai/core/contracts/site/api-security-api-types';
import type { SharedKeysPort } from '../ports.js';
/** The fixed Shared Keys group. A key saved on another site joins it before the grant. */
export const SHARED_KEYS_SOURCE = 'shared-keys';
/** Which step failed; the view shows fixed copy for it, never a server or exception message. */
export type SharedKeysFailure = 'load' | 'grant';
function createSharedKeysStore() {
  return createControllerStore({ initial: { open: false, loading: false, pending: false, source: null as AdminCredentialCopySource | null, selectedId: '', results: [] as readonly AdminCredentialCopyResult[], failure: null as SharedKeysFailure | null } });
}
/** One metadata read per open and one approval per key; this never reads or copies a credential value.
 * `onGranted` runs after a successful grant and before the results render (the host's refresh publication). */
export function createSharedKeysController({ port, permissions = [] }: { port: SharedKeysPort; permissions?: readonly string[] }, { onGranted }: { onGranted?: () => void } = {}) {
  const store = createSharedKeysStore();
  // A synchronous flag, not the snapshot's `pending`: a second submit in the same tick must send nothing.
  let busy = false; let opening = 0;
  const allowed = () => !store.signal.aborted && permissions.includes('custom-credentials.write');
  async function open(_required: Record<string, never> = {}, _optional = {}) {
    if (!allowed() || busy) return;
    const ticket = ++opening;
    store.set({ patch: { open: true, loading: true, source: null, selectedId: '', results: [], failure: null } });
    try { const sources = await port.list({}, { signal: store.signal }); if (ticket === opening) store.set({ patch: { source: sources.find(s => s.siteId === SHARED_KEYS_SOURCE) ?? null } }); }
    catch { if (ticket === opening) store.set({ patch: { failure: 'load' } }); }
    finally { if (ticket === opening) store.set({ patch: { loading: false } }); }
  }
  /** The chosen key when it can be granted now: loaded, not locked, nothing in flight. */
  function grantable(_required: Record<string, never> = {}, _optional = {}) {
    const s = store.getSnapshot();
    return busy || s.loading ? undefined : s.source?.keys.find(key => key.id === s.selectedId && !key.locked);
  }
  async function grant(_required: Record<string, never> = {}, _optional = {}) {
    const key = grantable({}); if (!key || !allowed()) return false;
    busy = true; store.set({ patch: { pending: true, failure: null, results: [] } });
    try {
      const results = await port.grant({ sourceSiteId: SHARED_KEYS_SOURCE, ids: [key.id], overwrite: false }, { signal: store.signal });
      onGranted?.(); store.set({ patch: { results } }); return true;
    } catch { store.set({ patch: { failure: 'grant' } }); return false; }
    finally { busy = false; store.set({ patch: { pending: false } }); }
  }
  return {
    getSnapshot: store.getSnapshot, subscribe: store.subscribe, open, grant, grantable,
    select({ id }: { id: string }, _optional = {}) { if (!busy) store.set({ patch: { selectedId: id } }); },
    close(_required: Record<string, never> = {}, _optional = {}) { if (!busy) { opening++; store.set({ patch: { open: false } }); } },
    dispose(_required: Record<string, never> = {}, _optional = {}) { opening++; store.dispose(); },
  };
}
