/** Deprecated re-export: import these from `@jini-ai/core/contracts/site/agent-plugins-lifecycle`; removed at the next major. */
export type { PluginManifestAuthor } from "@jini-ai/core/contracts/site/agent-plugins-lifecycle";
export {
  AGENT_PLUGINS_MCP_SCHEMA_URL,
  AGENT_PLUGINS_SCHEMA_URL,
  PLUGIN_MANIFEST_FILENAME,
  PLUGIN_MCP_MANIFEST_FILENAME,
  PLUGIN_SKILLS_DIRNAME,
  isMcpManifest,
  isPluginManifest,
  validatePluginManifest,
  validateMcpManifest,
} from './manifest.js';
export type { AgentPluginIdentityReadOptions, LegacyAgentPluginIdentity, McpManifest, McpServerEntry, PluginManifest } from './manifest.js';
