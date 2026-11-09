/** @agent-note Node entry: values for hosted MCP connections. Types come from `@jini-ai/core/contracts/hosted-mcp`; the host wires these values into its store, plugin and sign-in seams. No other Jini package is imported. */
export * from "./vocabulary.js";
export * from "./auth.js";
export * from "./access.js";
export { ExternalMcpValidationError } from "./validation-error.js";
export { ExternalMcpSecretStoreUnconfiguredError } from "./unconfigured-error.js";
export { hostedMcpProjections } from "./projections.js";
