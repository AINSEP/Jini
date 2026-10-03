/**
 * @module @jini-ai/registry
 *
 * Root barrel for pluggable content-registry backend implementations
 * (`static`/`github`/`database`) plus the shared version-resolution helpers
 * they build on. Wire types (`RegistryEntry`, `RegistryManifest`,
 * `RegistryBackend`, ...) live in `@jini-ai/protocol`; this package only adds
 * concrete backend logic, matching concern-owned storage adapters' split (protocol defines
 * the port, a leaf package implements adapters against it).

 * Archived provenance rationale:
 * ## Why a new package instead of folding into `@jini/core` or `@jini/sqlite`
 *
 * The task brief suggested `@jini/core` as a likely home. Read `@jini/core`'s
 * own `archived provenance ledger` first: its charter is explicitly composition-only — "a
 * from-scratch implementation of the typed composition contract... there is
 * nothing to port" — it holds zero concrete port/adapter implementations
 * today (`token.ts`/`pack.ts`/`bindings.ts`/`daemon.ts` are all pure DI
 * machinery). Adding stateful backend classes (in-memory, GitHub-PR-mutating,
 * sqlite-backed) would be a first-of-its-kind widening of that charter, which
 * reads as exactly the kind of ad-hoc scope creep extraction-plan.md §9 warns
 * against ("a new kernel token requires a kernel invariant, not merely a need
 * discovered by the first consumer").
 *
 * `@jini/sqlite` was the other candidate (it already holds one concrete
 * `better-sqlite3`-backed adapter, `event-log.ts`, implementing `@jini/daemon`'s
 * `EventLog` port). But `@jini/sqlite`'s own archived provenance ledger scopes it
 * specifically to durable adapters for daemon/core kernel ports; a registry
 * backend is not a kernel port and two of the three backends here
 * (`static`/`github`) have no sqlite dependency at all.
 *
 * Instead this follows the same shape as `@jini/sqlite` itself: `@jini/protocol`
 * defines the pure wire types and the `RegistryBackend` port (already true
 * before this change — see "What already existed" below); this new leaf
 * package holds concrete backend implementations against that port, exactly
 * as `@jini/sqlite` holds concrete `EventLog` implementations against
 * `@jini/daemon`'s port.
 *
 * ## 2026-10-02 registry merge and object arguments (dbpkg-registry)
 *
 * The catalog-builder subpath keeps descriptor enumeration, source classification,
 * search vocabulary and clock policy behind host ports. Its SQLite bridge lives in
 * `src/tool-catalog-builder/sqlite.ts`, separately from the provider-free barrel,
 * so a browser or alternate search backend never acquires a storage dependency.
 * The bridge borrows its connection; the caller allocates one database per independent
 * snapshot and owns retirement. Reusing the same database intentionally reseeds that
 * shared snapshot rather than allocating or closing an implicit default database.
 *
 * All existing public export names are retained. Functions and constructors now take
 * required argument objects followed by optional argument objects; no old-shape
 * wrappers or aliases were added. Backend methods match the current protocol port.
 * `src/ports.ts` defines database, HTTP and clock seams. The GitHub client passes the
 * existing QUICK timeout to its required transport port, which owns timeout error
 * and cancellation behavior. Default timestamps still use the system clock. SQL,
 * transaction boundaries, canonical signing bytes, BM25 weights and error messages
 * for valid argument shapes remain unchanged. Unknown trust/backend modes now fail
 * closed through the existing protocol schemas.
 *
 * No rationale comment was removed by this job. Manifest/barrel/changelog merge
 * proposals and cross-package caller needs are recorded in
 * `dbpkg-registry-merge-needs.json` and `dbpkg-registry-handoff.md`. The existing dirty
 * manifest, root barrel and changelog remain owned by their previous writers.
 * Tests are written; execution, typecheck, build and packaging are UNPROVEN because
 * the owner explicitly deferred verification. No version change or lockfile edit.
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
