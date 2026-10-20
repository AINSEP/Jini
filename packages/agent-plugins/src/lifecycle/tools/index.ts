/**
 * @file Public surface of `@jini-ai/agent-plugins/lifecycle/tools`: executable Agent Plugin tools.
 * A separate subpath because it needs the optional `@cfworker/json-schema` peer; consumers of
 * `./lifecycle` alone do not. The plugin tool contract arrives as host ports, never an import. See this folder's README.md.
 */
export { parseAgentPluginToolsFile, type AgentPluginToolDescriptor, type AgentPluginToolEffect } from './manifest.js';
export { defineAgentPluginToolContribution, type AgentPluginToolModule, type LoadedAgentPluginTool } from './definition.js';
export {
  openCapabilitySession, REVOKED_MESSAGE, WITHHELD_OUTPUT_MESSAGE, WITHHELD_ERROR_MESSAGE, createIssuedTokenMemories, type IssuedTokenMemories,
  type AgentPluginToolCapabilities, type AgentPluginToolCapabilitiesPort, type AgentPluginToolCapabilityScope,
  type AgentPluginHttpOptions, type AgentPluginLimitResult, type AgentPluginStateReader, type AgentPluginStateValue,
} from './capabilities.js';
export {
  createAgentPluginToolProjection, type AgentPluginToolDisclosure, type AgentPluginToolProjectionPorts,
  type AgentPluginToolSnapshot, type AgentPluginContractTool, type AgentPluginToolInvocation,
} from './projection.js';
