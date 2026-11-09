/** @agent-note Sign-in contracts and values for hosted MCP connections; the host fulfills every port and passes the same repository instance the store uses. Imports only `@jini-ai/core` and this package. */
export type * from './contracts.js';
export { createHostedMcpSignInService, createDeviceAuthorizationStore } from './sign-in.js';
export { createSharedExternalMcpOAuth, type SharedExternalMcpOwner, type SharedSignInOwner, type SharedSignInBindings, type SharedSignInAttachments, type SharedSignInTransaction, type SharedSignInIssuingContext, type SharedMcpConfiguration } from './shared-sign-in.js';
