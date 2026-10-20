/**
 * @file Public surface of `@jini-ai/agent-plugins/lifecycle/tools`: executable Agent Plugin tools.
 * A separate subpath because it needs the optional `@cfworker/json-schema` and `@jini-ai/plugins`
 * peers; consumers of `./lifecycle` alone do not. See this folder's README.md.
 */
export { parseAgentPluginToolsFile, type AgentPluginToolDescriptor, type AgentPluginToolEffect } from './manifest.js';
export { defineAgentPluginToolContribution, type AgentPluginToolModule, type LoadedAgentPluginTool } from './definition.js';
export {
  openCapabilitySession, REVOKED_MESSAGE, WITHHELD_OUTPUT_MESSAGE, WITHHELD_ERROR_MESSAGE,
  type AgentPluginToolCapabilities, type AgentPluginToolCapabilitiesPort, type AgentPluginToolCapabilityScope,
  type AgentPluginHttpOptions, type AgentPluginLimitResult,
} from './capabilities.js';
export { createAgentPluginToolProjection, type AgentPluginToolDisclosure } from './projection.js';
