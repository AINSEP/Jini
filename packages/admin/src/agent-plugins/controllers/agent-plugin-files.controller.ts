import { createControllerStore } from '../../core/module/controller-store.js';
import type { AgentPluginsApiPort } from '../ports.js';
import type { AgentPluginFiles, AgentPluginFilesState, AgentPluginPackageFile } from '../models.js';
import { agentPluginFilesSnapshot, selectAgentPluginFile, AGENT_PLUGINS_READ } from '../rules.js';
import { agentPluginsMessagesEn as m } from '../messages.en.js';
const selectedPathIn = ({ files, path }: { files: readonly AgentPluginPackageFile[]; path: string }, _optional = {}) => selectAgentPluginFile({ files, path })?.relativePath ?? '';
export function createAgentPluginFilesController({ api, permissions = [] }: { api: AgentPluginsApiPort; permissions?: readonly string[] }, _optional = {}) {
  const store = createControllerStore<AgentPluginFilesState>({ initial: { pluginId: null, listing: null, loading: false, error: null, selectedPath: '' } });
  let generation = 0, pending: AbortController | null = null;
  function cancel() { generation++; pending?.abort(); pending = null; }
  const canRead = () => !store.signal.aborted && permissions.includes(AGENT_PLUGINS_READ);
  function accept({ pluginId, result }: { pluginId: string; result: AgentPluginFiles }, _optional = {}) {
    if (result.pluginId !== pluginId) throw new Error(`Files response was for plugin "${result.pluginId}", expected "${pluginId}"`);
    const listing = agentPluginFilesSnapshot({ listing: result });
    store.set({ patch: { listing, selectedPath: selectedPathIn({ files: listing.files, path: '' }) } });
  }
  return {
    getSnapshot: store.getSnapshot, subscribe: store.subscribe,
    async open({ pluginId }: { pluginId: string }, _optional = {}) {
      if (!canRead()) return;
      cancel(); const ticket = generation, abort = new AbortController(); pending = abort;
      store.set({ patch: { pluginId, listing: null, loading: true, error: null, selectedPath: '' } });
      try {
        const result = await api.files({ pluginId }, { signal: abort.signal });
        // Disposal cancels first (bumping generation), so a stale ticket also covers a disposed store.
        if (ticket === generation) accept({ pluginId, result });
      } catch { if (ticket === generation) store.set({ patch: { error: m.fileError } }); }
      finally { if (ticket === generation) { pending = null; store.set({ patch: { loading: false } }); } }
    },
    // A disposed store already ignores writes, so no separate disposed check is needed here.
    select({ path }: { path: string }, _optional = {}) { store.set({ patch: { selectedPath: selectedPathIn({ files: store.getSnapshot().listing?.files ?? [], path }) } }); },
    close(_required: Record<string, never>, _optional = {}) { cancel(); store.set({ patch: { pluginId: null, listing: null, loading: false, error: null, selectedPath: '' } }); },
    dispose(_required: Record<string, never> = {}, _optional = {}) { cancel(); store.set({ patch: { pluginId: null, listing: null, selectedPath: '' } }); store.dispose(); },
  };
}
