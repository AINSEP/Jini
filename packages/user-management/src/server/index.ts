/** Node identity services and adapters; host wiring stays outside this package. */
// Hosts compose concrete repositories and inject their dependency bags. Exporting database-specific
// composition here would put one host's handle and schema in every consumer's dependency closure.
export * from "./auth-service.js";
export * from "./authorize.js";
export * from "./grant-service.js";
export * from "./admin-crud-service.js";
export * from "./seed.js";
export * from "./repo.memory.js";
export * from "./repo.memory-transactions.js";
export * from "./password-policy.js";
export * from "./hasher.js";
export * from "./username.js";
export * from "./permission-migrations.js";
export {
  identityAgentToolCatalog,
  type IdentityAgentToolDefinition,
} from "./agent-tools.js";
export { parseIdentityToolInput, type IdentityToolInputResult } from "./agent-tool-input.js";

export * from "./session-tokens.js";

export { buildIdentityRegistrations, identityDerivedRisk, type IdentityToolDeps } from "./agent-tool-registrations.js";

export { defaultUserManagementMessages, type UserManagementMessages } from "./messages.js";
