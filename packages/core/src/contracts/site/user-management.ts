import type { UUID } from "../../primitives/ids.js";
import type { ISODateTime } from "../../primitives/time.js";

/**
 * @file Identity and RBAC record and repository-port contracts. Additive copy of the type
 * declarations in `@jini-ai/user-management` (`core/types.ts`, `core/ports.ts`) with their full
 * structural closure; that package keeps its identical declarations, its error classes, its runtime
 * policy and its exports until the paired cutover.
 *
 * Type-only definitions for the principal-centric identity & authorization model: every actor
 * (human user, AI agent, API key, system) is rooted as a `PrincipalRecord`; humans get RBAC
 * (`roles` -> `policies` -> permissions); machines get direct policy grants (`principal_policies`).
 * Dependency-inversion seams (port/adapter rule-of-two) for the identity/RBAC tables, plus
 * `PasswordHasherPort` — the hashing seam behind which argon2id lives.
 *
 * `authorize()` itself is deliberately NOT a port (one evaluator). Interfaces and types only — no
 * feature logic.
 */

/**
 * Every actor is one of these. `member` is a host's public-site sign-up (a front-end account, not an
 * operator): it may hold a principal row for identity and audit, but `principalKindMayExercisePermission`
 * (`principal-kind-policy.ts`) bars it from every operator permission, so `authorize()` denies it
 * whatever grants reach it.
 */
export type PrincipalKind = "user" | "agent" | "api_key" | "system" | "member";

/** Disable-only lifecycle — there is no hard-delete state. See docs/decisions/DR-001-identity-and-session-boundary.md. */
export type PrincipalStatus = "active" | "disabled";

/**
 * Root identity row for every actor. `change_set.actorId` references
 * a principal by composite `(workspaceId, id)`.
 * See docs/decisions/DR-001-identity-and-session-boundary.md.
 */
export interface PrincipalRecord {
  id: UUID;
  workspaceId: UUID;
  kind: PrincipalKind;
  displayName: string;
  status: PrincipalStatus;
  disabledAt?: ISODateTime | undefined;
  createdAt: ISODateTime;
}

/**
 * Human auth credentials. A `UserRecord` is only ever created together with a
 * NEW `kind='user'` principal in the same transaction — never
 * attached to a pre-existing principal. `username` is unique per workspace,
 * compared case-insensitively and Unicode-NFC-normalized (behavior.spec §5).
 * See docs/decisions/DR-001-identity-and-session-boundary.md.
 */
export interface UserRecord {
  principalId: UUID;
  workspaceId: UUID;
  /** Stored pre-normalized (NFC + lowercase) so lookups are direct equality. */
  username: string;
  email?: string | undefined;
  /** argon2id hash; the raw password is never stored. See docs/decisions/DR-001-identity-and-session-boundary.md. */
  passwordHash: string;
  lastLoginAt?: ISODateTime | undefined;
}

/**
 * Revocable server-side session. `tokenHash` is a hash of the opaque
 * bearer value carried by the `HttpOnly`/`SameSite=Strict` cookie; the raw
 * token is never persisted. Lifetime is an **absolute** expiry fixed
 * at creation (behavior.spec §4) — no sliding renewal in v1.
 * See docs/decisions/DR-001-identity-and-session-boundary.md.
 */
export interface SessionRecord {
  id: UUID;
  workspaceId: UUID;
  principalId: UUID;
  tokenHash: string;
  createdAt: ISODateTime;
  expiresAt: ISODateTime;
  revokedAt?: ISODateTime;
  ip?: string | undefined;
  userAgent?: string | undefined;
}

/** Named RBAC role. Built-ins are seeded `isBuiltin=true`, immutable. See docs/decisions/DR-001-identity-and-session-boundary.md. */
export interface RoleRecord {
  id: UUID;
  workspaceId: UUID;
  name: string;
  isBuiltin: boolean;
}

/**
 * A permission bundle. `isFrozen` is reserved for the API-key
 * issuance-snapshot mechanism — out of scope this pass, so
 * every policy built here is `isFrozen=false`; the field exists so the schema
 * is additive-ready, not a later repaint.
 * See docs/decisions/DR-001-identity-and-session-boundary.md.
 */
export interface PolicyRecord {
  id: UUID;
  workspaceId: UUID;
  name: string;
  description?: string | undefined;
  isBuiltin: boolean;
  isFrozen: boolean;
}

/**
 * A single permission carried by a policy. `resourceType`
 * null = unscoped; non-null = matches only when it equals `context.entityType`
 * `constraintJson` non-null and uninterpretable => fail-closed
 * deny — the v1 evaluator interprets no constraint shape, so any
 * non-null value here is treated as "cannot interpret."
 * See docs/decisions/DR-001-identity-and-session-boundary.md.
 */
export interface PolicyPermissionRecord {
  id: UUID;
  workspaceId: UUID;
  policyId: UUID;
  /** Dotted catalog permission string, or `"*"` (owner built-in policy only). */
  permission: string;
  resourceType?: string | null;
  constraintJson?: string | null;
}

/** Role -> policy join. Not user-writable in v1 — seed-only rows. See docs/decisions/DR-001-identity-and-session-boundary.md. */
export interface RolePolicyRecord {
  id: UUID;
  workspaceId: UUID;
  roleId: UUID;
  policyId: UUID;
}

/** Principal -> role join, the human grant path. See docs/decisions/DR-001-identity-and-session-boundary.md. */
export interface PrincipalRoleRecord {
  id: UUID;
  workspaceId: UUID;
  principalId: UUID;
  roleId: UUID;
}

/** Principal -> policy direct grant, the machine grant path. See docs/decisions/DR-001-identity-and-session-boundary.md. */
export interface PrincipalPolicyRecord {
  id: UUID;
  workspaceId: UUID;
  principalId: UUID;
  policyId: UUID;
}

export interface PrincipalRepoPort {
  findById(required: { workspaceId: UUID; id: UUID }): Promise<PrincipalRecord | null>;
  list(required: { workspaceId: UUID }): Promise<PrincipalRecord[]>;
  save(record: PrincipalRecord): Promise<void>;
  /** Atomically insert by (workspaceId, id), or return the unchanged existing row.
   * Durable adapters must enforce uniqueness in storage across connections/processes.
   * Optional for existing hosts; ensurePrincipal fails closed without this capability. */
  insertIfAbsent?(required: { record: PrincipalRecord }, optional?: Record<string, never>): Promise<PrincipalRecord>;
}

export interface UserRepoPort {
  findByPrincipalId(required: { workspaceId: UUID; principalId: UUID }): Promise<UserRecord | null>;
  /** `username` must already be normalized (NFC + lowercase) by the caller. */
  findByUsername(required: { workspaceId: UUID; username: string }): Promise<UserRecord | null>;
  /** All `users` rows in the workspace (Users admin screen listing). Not paginated in v1 — matches `PrincipalRepoPort.list`/`RoleRepoPort.list`/`PolicyRepoPort.list`. */
  list(required: { workspaceId: UUID }): Promise<UserRecord[]>;
  save(record: UserRecord): Promise<void>;
  /** Set only `lastLoginAt` on an existing row (no-op when gone), so a concurrent password reset is never reverted by a stale snapshot. */
  recordLogin(required: { workspaceId: UUID; principalId: UUID; lastLoginAt: ISODateTime }): Promise<void>;
}

export interface SessionRepoPort {
  findById(required: { workspaceId: UUID; id: UUID }): Promise<SessionRecord | null>;
  findByTokenHash(required: { workspaceId: UUID; tokenHash: string }): Promise<SessionRecord | null>;
  save(record: SessionRecord): Promise<void>;
  /** Server-side revocation (logout, disable-cascade). Idempotent. */
  revoke(required: { workspaceId: UUID; id: UUID; revokedAt: ISODateTime }): Promise<void>;
  /** — every session bound to a principal, active or not (`RESET_USER_PASSWORD`
   * revokes each active one; unlike `DISABLE_PRINCIPAL`, which needs no session enumeration because
   * `validateSession`'s status check already invalidates every session for a disabled principal).
 * See docs/decisions/DR-002-grant-authority-and-admin-safety.md.
 */
  listByPrincipalId(required: { workspaceId: UUID; principalId: UUID }): Promise<SessionRecord[]>;
}

export interface RoleRepoPort {
  findById(required: { workspaceId: UUID; id: UUID }): Promise<RoleRecord | null>;
  findByName(required: { workspaceId: UUID; name: string }): Promise<RoleRecord | null>;
  list(required: { workspaceId: UUID }): Promise<RoleRecord[]>;
  save(record: RoleRecord): Promise<void>;
  /**. Callers must apply the is_builtin + zero-reference guards
   * themselves (see `admin-crud-service.ts`'s `deleteRole`) — this method performs the row deletion
   * only, no business rule (mirrors `WorkspaceRepoPort.delete`'s convention).
 * See docs/decisions/DR-002-grant-authority-and-admin-safety.md.
 */
  delete(required: { workspaceId: UUID; id: UUID }): Promise<void>;
}

export interface PolicyRepoPort {
  findById(required: { workspaceId: UUID; id: UUID }): Promise<PolicyRecord | null>;
  findByName(required: { workspaceId: UUID; name: string }): Promise<PolicyRecord | null>;
  list(required: { workspaceId: UUID }): Promise<PolicyRecord[]>;
  save(record: PolicyRecord): Promise<void>;
  /**. See `RoleRepoPort.delete`'s doc — same "no business rule here"
   * contract.
 * See docs/decisions/DR-002-grant-authority-and-admin-safety.md.
 */
  delete(required: { workspaceId: UUID; id: UUID }): Promise<void>;
}

export interface PolicyPermissionRepoPort {
  listByPolicyId(required: { workspaceId: UUID; policyId: UUID }): Promise<PolicyPermissionRecord[]>;
  save(record: PolicyPermissionRecord): Promise<void>;
  /** — cascades a `DELETE_POLICY` to the deleted policy's OWN
   * `policy_permissions` rows only (never a different policy's rows, state.spec §3's `DELETE_POLICY`
   * row).
 * See docs/decisions/DR-002-grant-authority-and-admin-safety.md.
 */
  deleteByPolicyId(required: { workspaceId: UUID; policyId: UUID }): Promise<void>;
  /** — removes ONE permission row by its own id, the inverse of `save`. Deliberately keyed by
   * `id` alone (plus the workspace scope every port call carries): `removePolicyPermission` proves
   * the row belongs to the named policy via `listByPolicyId` BEFORE calling this, so a
   * policy-scoped delete signature here would only duplicate a check the caller has already done
   * against rows it is holding.
 * See docs/decisions/DR-002-grant-authority-and-admin-safety.md.
 */
  delete(required: { workspaceId: UUID; id: UUID }): Promise<void>;
}

export interface RolePolicyRepoPort {
  listByRoleId(required: { workspaceId: UUID; roleId: UUID }): Promise<RolePolicyRecord[]>;
  save(record: RolePolicyRecord): Promise<void>;
  /** — the policy-side reference check `deletePolicy` needs (: no
   * writer creates such a row for a non-built-in policy today, but the guard checks for real —
   * defensive against that constraint ever being lifted, not a assumption baked into the guard).
 * See docs/decisions/DR-002-grant-authority-and-admin-safety.md.
 */
  listByPolicyId(required: { workspaceId: UUID; policyId: UUID }): Promise<RolePolicyRecord[]>;
}

export interface PrincipalRoleRepoPort {
  listByPrincipalId(required: { workspaceId: UUID; principalId: UUID }): Promise<PrincipalRoleRecord[]>;
  save(record: PrincipalRoleRecord): Promise<void>;
  /** — the reference check `deleteRole` needs. See docs/decisions/DR-002-grant-authority-and-admin-safety.md. */
  listByRoleId(required: { workspaceId: UUID; roleId: UUID }): Promise<PrincipalRoleRecord[]>;
}

export interface PrincipalPolicyRepoPort {
  listByPrincipalId(required: { workspaceId: UUID; principalId: UUID }): Promise<PrincipalPolicyRecord[]>;
  save(record: PrincipalPolicyRecord): Promise<void>;
  /** — the reference check `deletePolicy` needs; this is the
   * reference source that matters in practice (`ATTACH_POLICY` does write these rows for
   * non-built-in policies, unlike `role_policies`).
 * See docs/decisions/DR-002-grant-authority-and-admin-safety.md.
 */
  listByPolicyId(required: { workspaceId: UUID; policyId: UUID }): Promise<PrincipalPolicyRecord[]>;
}

/**
 * Atomic identity work over the repositories bound to this port. Commit on resolution;
 * roll back every write on rejection. Guard reads and all competing grant/status/reference
 * writers must be serialized within the workspace, including writers outside a transaction.
 * SQL adapters must bind these repositories to the transaction connection and acquire locks
 * sufficient to prevent phantom owner/reference rows; a bare read-committed transaction is
 * insufficient. Nested runs join the current unit of work.
 */
export interface IdentityTransactionPort {
  run<T>(required: { workspaceId: UUID; execute: () => Promise<T> }): Promise<T>;
}


/**
 * The nine identity repo ports, bagged for the functions in this library that
 * need several of them at once (`authorize`, seeding, the auth service).
 * Composition roots (`server/app.ts` / `server/deps.ts`) assemble this from
 * individual `RouteDeps` fields.
 */
export interface IdentityRepos {
  /** Required by guarded mutations; omission fails closed rather than weakening isolation. */
  transactions: IdentityTransactionPort;
  principals: PrincipalRepoPort;
  users: UserRepoPort;
  sessions: SessionRepoPort;
  roles: RoleRepoPort;
  policies: PolicyRepoPort;
  policyPermissions: PolicyPermissionRepoPort;
  rolePolicies: RolePolicyRepoPort;
  principalRoles: PrincipalRoleRepoPort;
  principalPolicies: PrincipalPolicyRepoPort;
}

/**
 * Password hashing seam. `argon2` (native argon2id bindings) is the
 * v1 adapter — see `hasher.ts`. Declared as a port per the spec's own
 * "rule-of-two candidate" language; only one real adapter exists this pass.
 * See docs/decisions/DR-002-grant-authority-and-admin-safety.md.
 */
export interface PasswordHasherPort {
  hash(required: { password: string }): Promise<string>;
  verify(required: { hash: string; password: string }): Promise<boolean>;
}
