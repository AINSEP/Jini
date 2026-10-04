import { createControllerStore } from '../../core/module/controller-store.js';
import type { AgentPluginsApiPort } from '../ports.js';
import type { AgentPluginsState, AgentPluginActivationInput, AgentPluginDisableRequest } from '../models.js';
import { agentPluginSummary, AGENT_PLUGINS_READ, AGENT_PLUGINS_WRITE } from '../rules.js';
import { agentPluginsMessagesEn as m } from '../messages.en.js';

export function createAgentPluginsController({ api, permissions = [] }: { api: AgentPluginsApiPort; permissions?: readonly string[] }, _optional = {}) {
  const grants = new Set(permissions);
  const store = createControllerStore<AgentPluginsState>({ initial: { plugins: null, loading: false, error: null, actionError: null, busyIds: [], expandedIds: [], pendingDisable: null, inspectedId: null } });
  let generation = 0, revision = 0;
  const canRead = () => !store.signal.aborted && grants.has(AGENT_PLUGINS_READ);
  const canWrite = () => canRead() && grants.has(AGENT_PLUGINS_WRITE);
  const rowFor = (id: string) => store.getSnapshot().plugins?.find(p => p.pluginId === id);
  async function load(_required: Record<string, never>, _optional = {}) {
    if (!canRead()) return; const ticket = ++generation, version = revision;
    store.set({ patch: { loading: true, error: null } });
    try {
      const plugins = await api.list({}, { signal: store.signal });
      // Older reads cannot overwrite accepted writes; each updated row replaces itself once.
      if (ticket !== generation || store.signal.aborted) return;
      if (version === revision) {
        const rows = Object.freeze(plugins.map(row => agentPluginSummary({ row })));
        const state = store.getSnapshot();
        store.set({ patch: { plugins: rows, inspectedId: rows.some(p => p.pluginId === state.inspectedId) ? state.inspectedId : null, pendingDisable: rows.some(p => p.pluginId === state.pendingDisable?.pluginId && p.enabled) ? state.pendingDisable : null, expandedIds: state.expandedIds.filter(id => rows.some(p => p.pluginId === id)) } });
      }
    } catch { if (ticket === generation) store.set({ patch: { error: m.loadError } }); }
    finally { if (ticket === generation) store.set({ patch: { loading: false } }); }
  }
  async function setEnabled(input: AgentPluginActivationInput, _optional = {}) {
    const row = rowFor(input.pluginId), state = store.getSnapshot();
    if (!canWrite() || !row || row.enabled === input.enabled || state.busyIds.includes(input.pluginId)) return false;
    store.set({ patch: { busyIds: [...state.busyIds, input.pluginId], actionError: null } });
    try {
      const updated = await api.setEnabled(input, { signal: store.signal });
      if (store.signal.aborted) return false;
      if (updated.pluginId !== input.pluginId) throw new Error('Invalid activation response');
      revision++;
      // No optimistic flip: independent rows always splice into the newest snapshot.
      const current = store.getSnapshot();
      store.set({ patch: { plugins: Object.freeze((current.plugins ?? []).map(p => p.pluginId === updated.pluginId ? agentPluginSummary({ row: updated }) : p)) } });
      return true;
    } catch { store.set({ patch: { actionError: m.actionError } }); return false; }
    finally { store.set({ patch: { busyIds: store.getSnapshot().busyIds.filter(id => id !== input.pluginId) } }); }
  }
  return {
    getSnapshot: store.getSnapshot, subscribe: store.subscribe, load, setEnabled,
    requestDisable(input: AgentPluginDisableRequest, _optional = {}) {
      if (canWrite() && !store.getSnapshot().pendingDisable && rowFor(input.pluginId)?.enabled && !store.getSnapshot().busyIds.includes(input.pluginId)) store.set({ patch: { pendingDisable: { ...input } } });
    },
    cancelDisable(_required: Record<string, never>, _optional = {}) { const p = store.getSnapshot().pendingDisable; if (!p || store.getSnapshot().busyIds.includes(p.pluginId)) return; store.set({ patch: { pendingDisable: null } }); },
    async confirmDisable(_required: Record<string, never>, _optional = {}) {
      const pending = store.getSnapshot().pendingDisable;
      if (!pending || !canWrite() || !rowFor(pending.pluginId)?.enabled) { store.set({ patch: { pendingDisable: null } }); return false; }
      if (store.getSnapshot().busyIds.includes(pending.pluginId)) return false;
      // Explicit false, never invert a stale plugin object captured when the dialog opened.
      const accepted = await setEnabled({ pluginId: pending.pluginId, enabled: false });
      if (accepted) store.set({ patch: { pendingDisable: null } });
      return accepted;
    },
    toggleExpanded({ pluginId }: { pluginId: string }, _optional = {}) { if (!canRead() || !rowFor(pluginId)) return; const ids = store.getSnapshot().expandedIds; store.set({ patch: { expandedIds: ids.includes(pluginId) ? ids.filter(id => id !== pluginId) : [...ids, pluginId] } }); },
    inspect({ pluginId }: { pluginId: string }, _optional = {}) { if (canRead() && rowFor(pluginId)) store.set({ patch: { inspectedId: pluginId } }); },
    closeInspector(_required: Record<string, never>, _optional = {}) { store.set({ patch: { inspectedId: null } }); },
    dispose(_required: Record<string, never> = {}, _optional = {}) { generation++; store.set({ patch: { pendingDisable: null, inspectedId: null, busyIds: [] } }); store.dispose(); },
  };
}
