import { createControllerStore } from '../../core/module/controller-store.js';
import type { RootKeyPort } from '../ports.js';
import type { RootKeyStatus, RootKeyPreview, RootKeyResult } from '../models.js';
import { ROOT_KEY_PERMISSION, START_FRESH_CONFIRMATION, isRootKeyLocked } from '../rules.js';
export function createRootKeyController({ api, permissions = [] }: { api: RootKeyPort; permissions?: readonly string[] }, _optional = {}) {
  const granted = permissions.includes(ROOT_KEY_PERMISSION);
  const store = createControllerStore({ initial: { status: null as RootKeyStatus | null, preview: null as RootKeyPreview | null, token: '', confirm: '', loading: false, saving: false, error: null as string | null, result: null as string | null, confirming: false } }); let generation = 0;
  const allowed = () => granted && !store.signal.aborted;
  async function load(_required: Record<string, never>, _optional = {}) {
    if (!allowed()) return; const ticket = ++generation; store.set({ patch: { loading: true } });
    try { const status = await api.status({}, { signal: store.signal }); if (ticket === generation) store.set({ patch: { status, error: null } }); }
    catch { if (ticket === generation) store.set({ patch: { error: 'Root key status unavailable' } }); }
    finally { if (ticket === generation) store.set({ patch: { loading: false } }); }
  }
  async function execute(run: () => Promise<RootKeyResult>, result: string) {
    if (!allowed() || store.getSnapshot().saving) return false; store.set({ patch: { saving: true, error: null } });
    try { const response = await run(); store.set({ patch: { token: '', confirm: '', preview: null, confirming: false, result: response.affectedWebhooks?.length ? `${result} Update receivers: ${response.affectedWebhooks.map(w => `${w.label} (${w.targetUrl})`).join(', ')}` : result } }); await load({}); return !store.signal.aborted; }
    catch { store.set({ patch: { error: 'Recovery refused. Check the host key configuration.' } }); return false; }
    finally { store.set({ patch: { saving: false } }); }
  }
  return {
    getSnapshot: store.getSnapshot, subscribe: store.subscribe, load,
    setToken({ value }: { value: string }, _optional = {}) { if (allowed() && !store.getSnapshot().saving) store.set({ patch: { token: value } }); },
    setConfirm({ value }: { value: string }, _optional = {}) { if (allowed() && !store.getSnapshot().saving) store.set({ patch: { confirm: value } }); },
    generate(_required: Record<string, never>, _optional = {}) {
      const status = store.getSnapshot().status;
      // No rotate/replace: replacing an active key would orphan every secret sealed under it.
      if (!status || status.active || status.state !== 'missing') return Promise.resolve(false);
      return execute(() => api.generate({}, { signal: store.signal }), 'Root key ready');
    },
    importToken(_required: Record<string, never>, _optional = {}) { const token = store.getSnapshot().token.trim(); return token && isRootKeyLocked({ status: store.getSnapshot().status }) ? execute(() => api.importToken({ token }, { signal: store.signal }), 'Unlocked. Saved credentials work again.') : Promise.resolve(false); },
    async preview(_required: Record<string, never>, _optional = {}) {
      if (!allowed() || !isRootKeyLocked({ status: store.getSnapshot().status }) || store.getSnapshot().saving || store.getSnapshot().loading) return false;
      const ticket = ++generation; store.set({ patch: { loading: true, preview: null, confirm: '', error: null } });
      try { const preview = await api.previewStartFresh({}, { signal: store.signal }); if (ticket !== generation || !allowed()) return false; store.set({ patch: { preview, confirming: true } }); return true; }
      catch { if (ticket === generation) store.set({ patch: { error: 'Recovery preview unavailable' } }); return false; }
      finally { if (ticket === generation) store.set({ patch: { loading: false } }); }
    },
    startFresh(_required: Record<string, never>, _optional = {}) { const state = store.getSnapshot(); if (!isRootKeyLocked({ status: state.status }) || !state.preview || !state.confirming || state.confirm !== START_FRESH_CONFIRMATION) return Promise.resolve(false); return execute(() => api.startFresh({ confirm: state.confirm }, { signal: store.signal }), 'Done. Re-enter removed credentials.'); },
    cancel(_required: Record<string, never>, _optional = {}) { if (!store.getSnapshot().saving) { generation++; store.set({ patch: { confirming: false, preview: null, confirm: '', loading: false } }); } },
    dispose(_required: Record<string, never> = {}, _optional = {}) { generation++; store.dispose(); },
  };
}
