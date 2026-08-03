/**
 * @file Public surface (barrel) for the `identity` library (ADR-021 / SPEC-006).
 *
 * A module's public contract is its `index.ts` (ADR-009 §1) — deep imports
 * from outside this directory should go through here.
 */
export type {
  PrincipalKind,
  PrincipalStatus,
  PrincipalRecord,
  UserRecord,
  SessionRecord,
  RoleRecord,
  PolicyRecord,
  PolicyPermissionRecord,
  RolePolicyRecord,
  PrincipalRoleRecord,
  PrincipalPolicyRecord,
} from "./types.js";

export {
  IdentityValidationError,
  IdentityNotFoundError,
  IdentityConflictError,
  AuthInvalidCredentialsError,
  IdentityForbiddenError,
  GrantExceedsIssuerError,
  OwnerRequiredError,
  PermissionUnknownError,
} from "./types.js";

export type {
  PrincipalRepoPort,
  UserRepoPort,
  SessionRepoPort,
  RoleRepoPort,
  PolicyRepoPort,
  PolicyPermissionRepoPort,
  RolePolicyRepoPort,
  PrincipalRoleRepoPort,
  PrincipalPolicyRepoPort,
  IdentityRepos,
  PasswordHasherPort,
} from "./ports.js";

export {
  InMemoryPrincipalRepo,
  InMemoryUserRepo,
  InMemorySessionRepo,
  InMemoryRoleRepo,
  InMemoryPolicyRepo,
  InMemoryPolicyPermissionRepo,
  InMemoryRolePolicyRepo,
  InMemoryPrincipalRoleRepo,
  InMemoryPrincipalPolicyRepo,
} from "./repo.memory.js";

/**
 * No concrete `PasswordHasherPort` implementation is exported here, deliberately. The reference
 * adapter is argon2id, a native module: shipping it from this entry point would make a compiled
 * binary a hard requirement of importing the identity domain — including for a host that only
 * wants the types, the authorization rules, or the in-memory repositories. Hosts construct their
 * own hasher and pass it as `deps.hasher`; the port is the contract, not the algorithm. A shared
 * argon2 adapter belongs in `../server` once that layer exists.
 */

export {
  authorize,
  resolveEffectivePermissions,
  type AuthorizeContext,
  type AuthorizeResult,
  type AuthorizeDeps,
} from "./authorize.js";

export {
  login,
  logout,
  validateSession,
  getEffectivePermissions,
  SESSION_TTL_MS,
  type AuthServiceDeps,
} from "./auth-service.js";

export { seedIdentity, type SeedIdentityDeps, type SeedIdentityInput, type SeedIdentityResult } from "./seed.js";

export {
  createUser,
  createRole,
  createPolicy,
  assignRole,
  attachPolicy,
  /** Exported so the assistant's read-only identity tools gate on the SAME caller-permission
   * helper the mutating transitions use, rather than re-implementing the OR gate (ADR-021 §2). */
  assertCallerHasAnyPermission,
} from "./grant-service.js";

/** The agent-tool surface for this domain (see `agent-tools.ts` for what is deliberately omitted). */
export {
  identityAgentToolCatalog,
  type AgentToolDefinition as IdentityAgentToolDefinition,
  type AgentToolSideEffect as IdentityAgentToolSideEffect,
} from "./agent-tools.js";
export { parseIdentityToolInput, type IdentityToolInputResult } from "./agent-tool-input.js";

/** SPEC-006 0.6.0 — the users/roles/policies admin CRUD-completion amendment. */
export {
  disablePrincipal,
  enablePrincipal,
  updateUser,
  resetUserPassword,
  updateRole,
  updatePolicy,
  deleteRole,
  deletePolicy,
  writePolicyPermission,
} from "./admin-crud-service.js";

/**
 * There is no wiring/composition export here, deliberately. Assembling concrete repositories into
 * a dependency bag names a specific database handle, which would put one host's persistence choice
 * on this library's public contract and drag that host's schema into every consumer's dependency
 * closure. Hosts compose their own; this entry point exports the ports they compose against.
 */

export { normalizeUsername } from "./username.js";

export {
  registerPermission,
  listPermissions,
  isKnownPermission,
  permissionCatalog,
  type PermissionDescriptor,
} from "./permissions.js";

/**
 * ADR-PIPE-012: the shared deprecate-old/grant-new permission migration
 * mechanism. Sibling remediation ADRs (Members/Analytics/Integrations)
 * register their own `{from, to}` pair via `registerPermissionMigration`
 * rather than hand-rolling a divergent copy (ADR-PIPE-012 Enforcement).
 */
export {
  registerPermissionMigration,
  listPermissionMigrations,
  migrateDeprecatedPermissionGrants,
  type PermissionMigration,
  type MigrateDeprecatedPermissionGrantsDeps,
  type MigrateDeprecatedPermissionGrantsResult,
} from "./permission-migrations.js";

/**
 * The agent-tool wiring for this domain.
 *
 * `IdentityToolDeps` is declared structurally rather than derived from any host's request-scoped
 * dependency bag, which is what lets a host satisfy it by passing whatever object it already has —
 * the shape is the contract, so no host type needs to be named here.
 */
export {
  buildIdentityRegistrations,
  identityDerivedRisk,
  type IdentityToolDeps,
} from "./tool-registrations.js";
