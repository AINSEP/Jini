import { createControllerStore } from '../../core/module/controller-store.js';
import type { AgentPluginsApiPort } from '../ports.js';
import type { AgentPluginFilesState } from '../models.js';
import { agentPluginFilesSnapshot, selectAgentPluginFile, AGENT_PLUGINS_READ } from '../rules.js';
import { agentPluginsMessagesEn as m } from '../messages.en.js';
export function createAgentPluginFilesController({ api, permissions = [] }: { api: AgentPluginsApiPort; permissions?: readonly string[] }, _optional = {}) {
  const store = createControllerStore<AgentPluginFilesState>({ initial: { pluginId: null, listing: null, loading: false, error: null, selectedPath: '' } });
  let generation = 0, pending: AbortController | null = null;
  function cancel() { generation++; pending?.abort(); pending = null; }
  return {
    getSnapshot: store.getSnapshot, subscribe: store.subscribe,
    async open({ pluginId }: { pluginId: string }, _optional = {}) {
      if (store.signal.aborted || !permissions.includes(AGENT_PLUGINS_READ)) return;
      cancel(); const ticket = generation, abort = new AbortController(); pending = abort;
      store.set({ patch: { pluginId, listing: null, loading: true, error: null, selectedPath: '' } });
      try {
        const result = await api.files({ pluginId }, { signal: abort.signal });
        if (ticket !== generation || store.signal.aborted) return;
        if (result.pluginId !== pluginId) throw new Error('Invalid files response');
        const listing = agentPluginFilesSnapshot({ listing: result });
        store.set({ patch: { listing, selectedPath: selectAgentPluginFile({ files: listing.files, path: '' })?.relativePath ?? '' } });
      } catch { if (ticket === generation) store.set({ patch: { error: m.fileError } }); }
      finally { if (ticket === generation) { pending = null; store.set({ patch: { loading: false } }); } }
    },
    select({ path }: { path: string }, _optional = {}) { if (store.signal.aborted) return; store.set({ patch: { selectedPath: selectAgentPluginFile({ files: store.getSnapshot().listing?.files ?? [], path })?.relativePath ?? '' } }); },
    close(_required: Record<string, never>, _optional = {}) { cancel(); store.set({ patch: { pluginId: null, listing: null, loading: false, error: null, selectedPath: '' } }); },
    dispose(_required: Record<string, never> = {}, _optional = {}) { cancel(); store.set({ patch: { pluginId: null, listing: null, selectedPath: '' } }); store.dispose(); },
  };
}
