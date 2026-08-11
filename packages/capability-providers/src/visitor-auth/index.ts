/**
 * `@jini-ai/capability-providers/visitor-auth`
 *
 * Browser-safe, provider-neutral contracts and pure OAuth/OIDC lifecycle
 * decisions for public-site visitor/social login. This is intentionally
 * distinct from the package root's local username/password `AuthProvider`,
 * admin authentication, MCP client authentication, and API-token integrations.
 *
 * No provider SDK, HTTP client, persistence adapter, secret value, token
 * verifier, account linker, or session implementation is exported here.
 */
export * from './definitions.js';
export * from './lifecycle.js';
export * from './ports.js';
export * from './registry.js';
export * from './tokens.js';
