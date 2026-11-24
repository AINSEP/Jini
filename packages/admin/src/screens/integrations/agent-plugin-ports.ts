import type { AgentPluginFiles, AgentPluginListRow } from "../../agent-plugins/models.js";

/** The outcome of installing (or updating) an Agent Plugin from an uploaded archive. */
export interface AgentPluginInstallResult {
  alreadyInstalled: boolean;
  warnings?: string[];
  agentPlugin: AgentPluginListRow | null;
}

/** What the Agent Plugins install flow needs from its host: upload an archive and hash a file. */
export interface AgentPluginInstallPort {
  installZip(required: { file: File; sha256: string; replace?: boolean; update?: { pluginId: string; expectedOldDigest: string } }, optional?: Record<string, never>): Promise<AgentPluginInstallResult>;
  sha256(required: { file: File }, optional?: Record<string, never>): Promise<string>;
}

/** What the Agent Plugins list needs from its host: read the installed rows, switch one on/off, read its files. */
export interface AgentPluginsPort {
  listAgentPlugins(): Promise<{ agentPlugins: AgentPluginListRow[] }>;
  setAgentPluginEnabled(required: { pluginId: string; input: { enabled: boolean } }, optional?: Record<string, never>): Promise<{ agentPlugin: AgentPluginListRow }>;
  getAgentPluginFiles(required: { pluginId: string }, optional?: Record<string, never>): Promise<AgentPluginFiles>;
}
