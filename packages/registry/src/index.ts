/**
 * @module @jini-ai/registry
 *
 * Root barrel for pluggable content-registry backend implementations
 * (`static`/`github`/`database`) plus the shared version-resolution helpers
 * they build on. Wire types (`RegistryEntry`, `RegistryManifest`,
 * `RegistryBackend`, ...) live in `@jini-ai/protocol`; this package only adds
 * concrete backend logic, matching `@jini-ai/sqlite`'s split (protocol defines
 * the port, a leaf package implements adapters against it).
 */
export type { ParsedRegistrySpecifier, ResolvedRegistryEntryVersion } from './versioning.js';
export { parseRegistrySpecifier, resolveRegistryEntryVersion } from './versioning.js';

export type { StaticRegistryBackendOptions } from './static-backend.js';
export { StaticRegistryBackend } from './static-backend.js';

export type { GithubPublishMutation, GithubRegistryBackendOptions, GithubRegistryClient } from './github-backend.js';
export { GithubRegistryBackend } from './github-backend.js';

export type { DatabaseRegistryBackendOptions } from './database-backend.js';
export { DatabaseRegistryBackend, ensureRegistryTables, upsertRegistryEntry } from './database-backend.js';

export type { GithubOidcTrustRoot, RegistryTrustRoot, SignatureVerificationResult } from './trust.js';
export { GITHUB_ACTIONS_OIDC_ISSUER, canonicalRegistrySigningPayload, verifyRegistryEntrySignatures, verifyRegistrySignature } from './trust.js';

export type { GithubApiRegistryClientOptions } from './github-client.js';
export { GithubApiRegistryClient } from './github-client.js';
