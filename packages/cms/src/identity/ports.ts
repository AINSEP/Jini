/**
 * @file Port contracts for the `identity` library.
 *
 * Purpose:
 * Dependency-inversion seams (port/adapter rule-of-two) for the identity/RBAC
 * tables, plus `PasswordHasherPort` — the hashing seam behind which argon2id
 * lives (feature.spec.md Dependencies table: "behind a HasherPort, rule-of-two
 * candidate"). Only an in-memory adapter for each repo port ships this pass
 * (matches the disclosed precedent set by members/navigation/integrations/
 * analytics — see `src/server/deps.ts` comments); a SQLite adapter is a later
 * step, not a gap introduced here.
 *
 * `authorize()` itself is deliberately NOT a port (one
 * evaluator) — see `authorize.ts`. `AuthorizeDeps` there is a plain repo bag,
 * not declared here.
 *
 * Interfaces and types only — no feature logic.
 */
import type { ISODateTime, UUID } from "../core/ports.js";
import type {
  PolicyPermissionRecord,
  PolicyRecord,
  PrincipalPolicyRecord,
  PrincipalRecord,
  PrincipalRoleRecord,
  RolePolicyRecord,
  RoleRecord,
  SessionRecord,
  UserRecord,
} from "./types.js";

export interface PrincipalRepoPort {
  findById(required: { workspaceId: UUID; id: UUID }): Promise<PrincipalRecord | null>;
  list(required: { workspaceId: UUID }): Promise<PrincipalRecord[]>;
  save(record: PrincipalRecord): Promise<void>;
}

export interface UserRepoPort {
  findByPrincipalId(required: { workspaceId: UUID; principalId: UUID }): Promise<UserRecord | null>;
  /** `username` must already be normalized (NFC + lowercase) by the caller. */
  findByUsername(required: { workspaceId: UUID; username: string }): Promise<UserRecord | null>;
  /** All `users` rows in the workspace (Users admin screen listing). Not paginated in v1 — matches `PrincipalRepoPort.list`/`RoleRepoPort.list`/`PolicyRepoPort.list`. */
  list(required: { workspaceId: UUID }): Promise<UserRecord[]>;
  save(record: UserRecord): Promise<void>;
}

export interface SessionRepoPort {
  findById(required: { workspaceId: UUID; id: UUID }): Promise<SessionRecord | null>;
  findByTokenHash(required: { workspaceId: UUID; tokenHash: string }): Promise<SessionRecord | null>;
  save(record: SessionRecord): Promise<void>;
  /** Server-side revocation (logout, disable-cascade). Idempotent. */
  revoke(required: { workspaceId: UUID; id: UUID; revokedAt: ISODateTime }): Promise<void>;
  /** REQ-17 — every session bound to a principal, active or not (`RESET_USER_PASSWORD`
   * revokes each active one; unlike `DISABLE_PRINCIPAL`, which needs no session enumeration because
   * `validateSession`'s status check already invalidates every session for a disabled principal). */
  listByPrincipalId(required: { workspaceId: UUID; principalId: UUID }): Promise<SessionRecord[]>;
}

export interface RoleRepoPort {
  findById(required: { workspaceId: UUID; id: UUID }): Promise<RoleRecord | null>;
  findByName(required: { workspaceId: UUID; name: string }): Promise<RoleRecord | null>;
  list(required: { workspaceId: UUID }): Promise<RoleRecord[]>;
  save(record: RoleRecord): Promise<void>;
  /** REQ-19 (INV-09). Callers must apply the is_builtin + zero-reference guards
   * themselves (see `admin-crud-service.ts`'s `deleteRole`) — this method performs the row deletion
   * only, no business rule (mirrors `WorkspaceRepoPort.delete`'s convention). */
  delete(required: { workspaceId: UUID; id: UUID }): Promise<void>;
}

export interface PolicyRepoPort {
  findById(required: { workspaceId: UUID; id: UUID }): Promise<PolicyRecord | null>;
  findByName(required: { workspaceId: UUID; name: string }): Promise<PolicyRecord | null>;
  list(required: { workspaceId: UUID }): Promise<PolicyRecord[]>;
  save(record: PolicyRecord): Promise<void>;
  /** REQ-19 (INV-09). See `RoleRepoPort.delete`'s doc — same "no business rule here"
   * contract. */
  delete(required: { workspaceId: UUID; id: UUID }): Promise<void>;
}

export interface PolicyPermissionRepoPort {
  listByPolicyId(required: { workspaceId: UUID; policyId: UUID }): Promise<PolicyPermissionRecord[]>;
  save(record: PolicyPermissionRecord): Promise<void>;
  /** REQ-19 — cascades a `DELETE_POLICY` to the deleted policy's OWN
   * `policy_permissions` rows only (never a different policy's rows, state.spec §3's `DELETE_POLICY`
   * row). */
  deleteByPolicyId(required: { workspaceId: UUID; policyId: UUID }): Promise<void>;
}

export interface RolePolicyRepoPort {
  listByRoleId(required: { workspaceId: UUID; roleId: UUID }): Promise<RolePolicyRecord[]>;
  save(record: RolePolicyRecord): Promise<void>;
  /** REQ-19 — the policy-side reference check `deletePolicy` needs (F-053-02: no
   * writer creates such a row for a non-built-in policy today, but the guard checks for real —
   * defensive against that constraint ever being lifted, not a assumption baked into the guard). */
  listByPolicyId(required: { workspaceId: UUID; policyId: UUID }): Promise<RolePolicyRecord[]>;
}

export interface PrincipalRoleRepoPort {
  listByPrincipalId(required: { workspaceId: UUID; principalId: UUID }): Promise<PrincipalRoleRecord[]>;
  save(record: PrincipalRoleRecord): Promise<void>;
  /** REQ-19 — the reference check `deleteRole` needs (INV-09). */
  listByRoleId(required: { workspaceId: UUID; roleId: UUID }): Promise<PrincipalRoleRecord[]>;
}

export interface PrincipalPolicyRepoPort {
  listByPrincipalId(required: { workspaceId: UUID; principalId: UUID }): Promise<PrincipalPolicyRecord[]>;
  save(record: PrincipalPolicyRecord): Promise<void>;
  /** REQ-19 — the reference check `deletePolicy` needs (INV-09); this is the
   * reference source that matters in practice (`ATTACH_POLICY` does write these rows for
   * non-built-in policies, unlike `role_policies`). */
  listByPolicyId(required: { workspaceId: UUID; policyId: UUID }): Promise<PrincipalPolicyRecord[]>;
}

/**
 * The nine identity repo ports, bagged for the functions in this library that
 * need several of them at once (`authorize`, seeding, the auth service).
 * Composition roots (`server/app.ts` / `server/deps.ts`) assemble this from
 * individual `RouteDeps` fields.
 */
export interface IdentityRepos {
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
 * Password hashing seam (INV-05). `argon2` (native argon2id bindings) is the
 * v1 adapter — see `hasher.ts`. Declared as a port per the spec's own
 * "rule-of-two candidate" language; only one real adapter exists this pass.
 */
export interface PasswordHasherPort {
  hash(password: string): Promise<string>;
  verify(hash: string, password: string): Promise<boolean>;
}
