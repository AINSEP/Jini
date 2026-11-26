import type { AgentPluginLayout } from "@jini-ai/core/contracts/headless/plugin-host";
import type { ConnectDeps } from "./contracts.js";
import type { AgentPluginMcpProjectionPorts } from "./ports.js";
import type { AgentPluginMcpContext } from "../site/service-ports.js";

export function resolveAgentPluginConnectRedirectUri({ configuredOrigin, derivedOrigin, serverId, callbackPath }: { configuredOrigin: string | undefined; derivedOrigin: string | undefined; serverId: string; callbackPath: string }, _optional = {}): string | undefined {
  const configured = configuredOrigin?.trim();
  let origin: string | undefined;
  if (configured) {
    try {
      const url = new URL(configured);
      // `URL.origin` is the string "null" for a non-http(s) scheme — never a usable redirect origin.
      origin = url.protocol === "http:" || url.protocol === "https:" ? url.origin : undefined;
    } catch {
      origin = undefined;
    }
  }
  origin ??= derivedOrigin || undefined;
  if (!origin) return undefined;
  return `${origin}${callbackPath}/${encodeURIComponent(serverId)}`;
}

/** Old deps -> portable deps: projections bound once (same pair/identity rule as the host shims), the
 * activation/installed defaults read lazily exactly as the pre-seam body did. Getters stay lazy:
 * `routeDeps.mcp` is first read on first use, i.e. after the permission check, as before the seam. */
export function createAgentPluginConnectDeps(required: {
  host: ConnectDeps["host"];
  isPluginEnabled: (required: { workspaceRoot: string; pluginId: string }) => Promise<boolean>;
  resolveInstalledPlugin: (required: { workspaceId: string; pluginId: string; agentPluginLayout: AgentPluginLayout }) => ReturnType<ConnectDeps["resolveInstalledPlugin"]>;
  projectMcp(context: Omit<ConnectDeps["mcp"], keyof AgentPluginMcpProjectionPorts> & AgentPluginMcpContext): ConnectDeps["mcp"];
}, _optional = {}) {
  return (routeDeps: Omit<ConnectDeps, "host" | "isPluginEnabled" | "resolveInstalledPlugin" | "mcp"> & {
    agentPluginLayout: AgentPluginLayout;
    isPluginEnabled?: ConnectDeps["isPluginEnabled"];
    resolveInstalledPlugin?: ConnectDeps["resolveInstalledPlugin"];
    mcp: Omit<ConnectDeps["mcp"], keyof AgentPluginMcpProjectionPorts> & AgentPluginMcpContext;
  }, _optional = {}): ConnectDeps => {
    let mcp: ConnectDeps["mcp"] | undefined;
    const deps = Object.assign(Object.defineProperties({}, Object.getOwnPropertyDescriptors(routeDeps)), {
      isPluginEnabled: (pluginId: string) => routeDeps.isPluginEnabled ? routeDeps.isPluginEnabled(pluginId)
        : required.isPluginEnabled({ workspaceRoot: routeDeps.agentPluginLayout.forWorkspace({ workspaceId: routeDeps.workspaceId }).root, pluginId }),
      resolveInstalledPlugin: (pluginId: string) => routeDeps.resolveInstalledPlugin ? routeDeps.resolveInstalledPlugin(pluginId)
        : required.resolveInstalledPlugin({ workspaceId: routeDeps.workspaceId, pluginId, agentPluginLayout: routeDeps.agentPluginLayout }),
      host: required.host,
    });
    return Object.defineProperty(deps, "mcp", { get: () => (mcp ??= required.projectMcp(routeDeps.mcp)), enumerable: true, configurable: true }) as ConnectDeps;
  };
}
