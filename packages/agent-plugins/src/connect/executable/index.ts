/**
 * @agent-note A host that imports this entry must install the optional peer `@cfworker/json-schema`.
 * `register.ts` builds the tool projection from `../../lifecycle/tools/projection.js`, which imports
 * it by value, so without it this import fails with ERR_MODULE_NOT_FOUND for `@cfworker/json-schema`.
 */
export { registerAgentPluginExecutableTools } from './register.js';
export { createAgentPluginDisclosure, APPROVAL_FAMILY_BY_EFFECT, type AgentPluginDisclosureSource } from './approval.js';
export { createFrozenConnectionAccounts, confirmedTokenOptions, createGuardedPluginHttp, createAgentPluginToolCapabilities, HTTPS_ONLY_MESSAGE, UNDECLARED_ORIGIN_MESSAGE, RESPONSE_TOO_LARGE_MESSAGE, UNAPPROVED_CONNECTION_MESSAGE } from './host-capabilities.js';
export type { AgentPluginConnectionTarget, AgentPluginConnectionAccess, AgentPluginArtifactWriter, AgentPluginRateLimiter, AgentPluginStateReaderFor, AgentPluginApiOriginsFor, FrozenConnectionAccounts, AgentPluginExecutableContributionRegistry, AgentPluginExecutableContributions, AgentPluginExecutableRuntimeHost, ApplyAgentPluginApproval, AgentPluginApprovalFamily, ApplyAgentPluginPolicy, AgentPluginDisclosureMessages, AgentPluginExecutableRegistrationRequired } from './ports.js';
