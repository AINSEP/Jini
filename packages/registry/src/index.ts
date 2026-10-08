/**
 * @module @jini-ai/registry
 * Concrete static/GitHub/database backends implement the protocol-owned RegistryBackend port.
 * Keep them outside composition-only core and kernel-store adapters: registry storage is a
 * feature concern, and static/GitHub backends need no SQLite dependency.
 * Catalog-building enumeration, classification, search vocabulary and clock policy are host ports.
 * Its SQLite bridge is a separate entry so browser/alternate-search consumers remain storage-free.
 * The bridge borrows its connection; hosts own snapshot allocation and retirement. Reusing one
 * database deliberately reseeds that snapshot, never allocates/closes an implicit default.
 * Public functions/constructors take required and optional argument objects; backend methods follow
 * the protocol port. The required GitHub transport owns QUICK timeout/cancellation behavior.
 * Signing bytes, transaction boundaries and BM25 policy stay at their owning implementations;
 * protocol schemas reject unknown trust/backend modes rather than guessing.
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

export type { RegistryDatabasePort } from './ports.js';
