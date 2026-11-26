import { AgentPluginUpdateError, type AgentPluginMcpProvisioningPort } from '@jini-ai/agent-plugins/lifecycle';
import type { provisionAgentPluginMcpServers, resolveAgentPluginMcpServers } from '../connect/federate-mcp.js';
import type { AgentPluginLayout } from "@jini-ai/core/contracts/headless/plugin-host";

type ProvisionDeps = import('./service-ports.js').AgentPluginMcpContext & Pick<import('./service-ports.js').AgentPluginMcpPort, 'repo' | 'saveServer'> & Partial<Pick<import('./service-ports.js').AgentPluginMcpPort, 'notifyRosterChanged'>>;
export type UpdateMcpDeps = {
  workspaceId: string; agentPluginLayout: AgentPluginLayout;
  mcp: ProvisionDeps;
  /** Announces the changed roster so live runtimes reload; the composition root binds
   *  `notifyExternalMcpRosterChanged`. A port rather than a value import: a feature module may not
   *  value-import `#src/assistant/` (`domain-no-direct-tool-registration.boundary.test.ts`), the
   *  same seam `apply-tool-renames.ts` uses. */
  notifyExternalMcpRosterChanged: () => Promise<void>;
};
/** What a host hands over: the scope always, the MCP store and roster ports only when it bound them. */
export type UpdateMcpHostDeps = Pick<UpdateMcpDeps, "workspaceId" | "agentPluginLayout"> & Partial<UpdateMcpDeps>;

/** Update provisioning uses the existing MCP owner and roster reload. It must succeed before
 * the update commits; existing credentials and reviewed permissions stay with that owner.
 * @complexity O(s), candidate MCP servers. Running MCP requests may fail during roster reload.
 */
export function createAgentPluginUpdateEffects(
  { deps, actor, resolveServers, provisionServers }: { deps: UpdateMcpDeps; actor: string;
    resolveServers(input: Omit<Parameters<typeof resolveAgentPluginMcpServers>[0], 'lifecycle'>): ReturnType<typeof resolveAgentPluginMcpServers>;
    provisionServers(deps: ProvisionDeps, input: Omit<Parameters<typeof provisionAgentPluginMcpServers>[0], 'deps' | 'classifyTrust' | 'messages'>): ReturnType<typeof provisionAgentPluginMcpServers>;
  },
  _optional = {},
): AgentPluginMcpProvisioningPort {
  const unsupported = async (): Promise<never> => { throw new Error('Use the shared activation/removal owner.'); };
  return {
    provision: async ({ workspaceId, installed }) => {
      const servers = await resolveServers({ agentPluginLayout: deps.agentPluginLayout, workspaceId, pluginId: installed.pluginId });
      const result = await provisionServers(deps.mcp, { workspaceId, pluginId: installed.pluginId, servers, principalId: actor });
      // A named refusal, so the route answers 409 with this code rather than a redacted 500. The lifecycle
      // owner rolls the update back before it rethrows this, so the message can say so.
      if (result.failed.length) throw new AgentPluginUpdateError({ code: 'PLUGIN_MCP_PROVISION_FAILED', message: 'The new version\'s MCP servers could not be set up; the previous version was restored.' });
    },
    notifyRosterChanged: async () => deps.notifyExternalMcpRosterChanged(),
    setEnabled: unsupported,
    remove: unsupported,
  };
}

/** The update's MCP deps from what the host bound. A missing one is a host wiring fault, not the
 *  caller's, so this throws a plain error (redacted to the model and to HTTP clients).
 *  @complexity O(1). */
export function requireUpdateMcpDeps({ deps }: { deps: UpdateMcpHostDeps }, _optional: Record<string, never> = {}): UpdateMcpDeps {
  const { workspaceId, agentPluginLayout, mcp, notifyExternalMcpRosterChanged } = deps;
  const unbound = () => new Error("Agent Plugin update is unavailable: the host did not bind its MCP provisioning.");
  if (!mcp?.repo || !mcp.saveServer || !notifyExternalMcpRosterChanged) throw unbound();
  return { workspaceId, agentPluginLayout, mcp, notifyExternalMcpRosterChanged };
}

/**
 * The composed lifecycle's MCP port, used by boot recovery to re-provision a restored revision's
 * servers. The lifecycle is bound before the external-MCP store exists in the composition root, so
 * the deps are read when recovery calls, not when this is built. Without this binding recovery
 * still restores the bytes but leaves the plugin switched off (Jini's degraded outcome).
 * @complexity O(1) to build; each call as {@link createAgentPluginUpdateEffects}.
 */
export function createDeferredAgentPluginUpdateEffects(
  { resolveDeps, actor, resolveServers, provisionServers }: {
    resolveDeps: () => UpdateMcpHostDeps; actor: string;
    resolveServers: Parameters<typeof createAgentPluginUpdateEffects>[0]['resolveServers'];
    provisionServers: Parameters<typeof createAgentPluginUpdateEffects>[0]['provisionServers'];
  },
  _optional = {},
): AgentPluginMcpProvisioningPort {
  const effects = () => createAgentPluginUpdateEffects({ deps: requireUpdateMcpDeps({ deps: resolveDeps() }), actor, resolveServers, provisionServers });
  return {
    // Async so a host missing a dep rejects the call (a failed provision) instead of throwing synchronously.
    provision: async (input) => effects().provision(input),
    notifyRosterChanged: async (input) => effects().notifyRosterChanged(input),
    setEnabled: async (input) => effects().setEnabled(input),
    remove: async (input) => effects().remove(input),
  };
}
