/** Named refusal shared by HTTP and tool adapters. */
export class AgentPluginHostIncompatibleError extends Error {
  readonly code = 'PLUGIN_HOST_INCOMPATIBLE';
  constructor(required: { pluginId: string }, _optional: Record<string, never> = {}) {
    super(`Plugin '${required.pluginId}' is not compatible with this host's Agent Plugin contract.`);
    this.name = 'AgentPluginHostIncompatibleError';
  }
}

