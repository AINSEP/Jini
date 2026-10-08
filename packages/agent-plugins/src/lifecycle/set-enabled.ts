/** Extracted from the host plugin lifecycle. Effects are supplied per host context. */
import { createActivationModule } from "./activation.js";
import { createResolveAgentPluginRefsModule } from "./resolve-agent-plugin-refs.js";
import type { AgentPluginLifecyclePorts } from "./ports.js";

/**
 * The id named is not installed in this workspace. A distinct class rather than a bare `Error` so
 * each caller can map it to its own boundary's vocabulary — 404 `AGENT_PLUGIN_NOT_FOUND` at the
 * admin route, `ToolInputError` at the tool — without either one string-matching a message.
 */
export class AgentPluginNotInstalledError extends Error {
  constructor({ pluginId }: { readonly pluginId: string }) {
    super(`agent plugin '${pluginId}' is not installed in this workspace`);
    this.name = "AgentPluginNotInstalledError";
  }
}

export interface SetAgentPluginEnabledInput {
  readonly workspaceId: string;
  readonly pluginId: string;
  readonly enabled: boolean;

  /** Recorded as the activation record's updatedBy. The authenticated principal, never a constant. */
  readonly actor: string;
}

export interface SetAgentPluginEnabledResult {
  readonly pluginId: string;

  /** As actually written and read back, not as requested. */
  readonly enabled: boolean;
}

function buildModule(ports: AgentPluginLifecyclePorts) {
  const { setAgentPluginActivation } = createActivationModule(ports);
  const { listInstalledPlugins } = createResolveAgentPluginRefsModule(ports);
  async function setAgentPluginEnabled(input: SetAgentPluginEnabledInput): Promise<SetAgentPluginEnabledResult> {
    const workspaceLayout = ports.layout.forWorkspace({ workspaceId: input.workspaceId });
    const installed = await listInstalledPlugins(workspaceLayout.root);
    if (!installed.some((plugin) => plugin.pluginId === input.pluginId)) {
      throw new AgentPluginNotInstalledError({ pluginId: input.pluginId });
    }

    const written = await setAgentPluginActivation({
      workspaceRoot: workspaceLayout.root,
      pluginId: input.pluginId,
      enabled: input.enabled,
      actor: input.actor,
    });

    return { pluginId: input.pluginId, enabled: written.plugins[input.pluginId]?.enabled ?? input.enabled };
  }

  return { setAgentPluginEnabled };
}

const instances = new WeakMap<AgentPluginLifecyclePorts, ReturnType<typeof buildModule>>();
/** Internal composition; one state/queue instance per injected host context. */
export function createSetEnabledModule(ports: AgentPluginLifecyclePorts) {
  let instance = instances.get(ports);
  if (!instance) { instance = buildModule(ports); instances.set(ports, instance); }
  return instance;
}
