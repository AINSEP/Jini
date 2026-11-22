/** @agent-note Node entry: values for hosted MCP connections. Types come from `@jini-ai/core/contracts/hosted-mcp`; the host wires these values into its store, plugin and sign-in seams. No other Jini package is imported. */
export * from "./vocabulary.js";
export * from "./auth.js";
export { parseExternalMcpJsonArray, externalMcpAdmissionRevision, externalMcpAccessSnapshot, readExternalMcpToolGrants, validateExternalMcpToolNames, parseAllowedToolNames, parseWriteAllowedToolNames } from "./access.js";
export { ExternalMcpValidationError } from "./validation-error.js";
export { ExternalMcpSecretStoreUnconfiguredError } from "./unconfigured-error.js";
export { hostedMcpProjections } from "./projections.js";
export type * from "./store-ports.js";
export { externalMcpVaultEnvelope, externalMcpVaultRecord, sealExternalMcpVaultPayload, openExternalMcpVaultPayload, persistExternalMcpVaultEnvelope, deleteExternalMcpVaultEnvelope,
  EXTERNAL_MCP_VAULT_VERSION, EXTERNAL_MCP_OAUTH_PAYLOAD_VERSION, hydrateExternalMcpOAuthPayload, openExternalMcpOAuthPayload, sealExternalMcpOAuthPayload } from "./vault.js";
export type { Identity, Kind } from "./vault.js";
export { applyExternalMcpAccess, saveExternalMcpServer, deleteExternalMcpServer } from "./store.js";
export type { HostedMcpStoreDeps } from "./store.js";
export { parseEnvBlock, parseArgs, parseOAuthScopes } from "./store-input.js";
export { normalizeExternalMcpAccessToken } from "./store-credentials.js";
export { externalMcpRecordHasStoredToken, listExternalMcpServerViews } from "./store-view.js";
export { readEnabledExternalMcpConfigs, toResolvedFederatedConnections } from "./store-config.js";
export { InMemoryExternalMcpServerRepo } from "./store.memory.js";
export * from "./revocation.js";
export * from "./connection-gate.js";
export * from "./probe.js";
export * from "./pinned-capability.js";
