import type { ISODateTime, UUID } from "../core/ports.js";

/**
 * @file Core domain types for the `identity` library (ADR-021 / SPEC-006).
 *
 * Purpose:
 * Type-only definitions for the principal-centric identity & authorization
 * model: every actor (human user, AI agent, API key, system) is rooted as a
 * `PrincipalRecord`; humans get RBAC (`roles` -> `policies` -> permissions);
 * machines get direct policy grants (`principal_policies`). Mirrors the
 * `features/post` / `members` conventions: records + workspace-scoped ports
 * live in `ports.ts`, no feature logic here.
 *
 * Scope note (core path, this pass):
 * `agent`/`api_key` principal *lifecycle* transitions (CREATE_PRINCIPAL,
 * ISSUE_API_KEY, ASSIGN_ROLE, ATTACH_POLICY, WRITE_POLICY_PERMISSION,
 * DISABLE_PRINCIPAL) are OUT of scope for this pass (deferred — see the
 * Programmer handoff). The `kind` enum and table shapes are still built to
 * the full ADR-021 §9 target schema so those transitions are additive later,
 * not a repaint.
 */

/** Every actor is one of these. Only `user`/`system` are populated this pass. */
export type PrincipalKind = "user" | "agent" | "api_key" | "system";

/** Disable-only lifecycle (REQ-11/INV-02) — there is no hard-delete state. */
export type PrincipalStatus = "active" | "disabled";

/**
 * Root identity row for every actor (REQ-01). `change_set.actorId` references
 * a principal by composite `(workspaceId, id)` (REQ-10/INV-01).
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
 * NEW `kind='user'` principal in the same transaction (REQ-01, MF-1) — never
 * attached to a pre-existing principal. `username` is unique per workspace,
 * compared case-insensitively and Unicode-NFC-normalized (behavior.spec §5).
 */
export interface UserRecord {
  principalId: UUID;
  workspaceId: UUID;
  /** Stored pre-normalized (NFC + lowercase) so lookups are direct equality. */
  username: string;
  email?: string | undefined;
  /** argon2id hash; the raw password is never stored (INV-05). */
  passwordHash: string;
  lastLoginAt?: ISODateTime | undefined;
}

/**
 * Revocable server-side session (REQ-06). `tokenHash` is a hash of the opaque
 * bearer value carried by the `HttpOnly`/`SameSite=Strict` cookie; the raw
 * token is never persisted (INV-05). Lifetime is an **absolute** expiry fixed
 * at creation (behavior.spec §4, RT-004) — no sliding renewal in v1.
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

/** Named RBAC role (REQ-02). Built-ins are seeded `isBuiltin=true`, immutable (INV-06). */
export interface RoleRecord {
  id: UUID;
  workspaceId: UUID;
  name: string;
  isBuiltin: boolean;
}

/**
 * A permission bundle (REQ-02). `isFrozen` is reserved for the API-key
 * issuance-snapshot mechanism (REQ-08/F-054-01) — out of scope this pass, so
 * every policy built here is `isFrozen=false`; the field exists so the schema
 * is additive-ready, not a later repaint.
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
 * A single permission carried by a policy (REQ-02/REQ-03). `resourceType`
 * null = unscoped; non-null = matches only when it equals `context.entityType`
 * (REQ-04/AC-14). `constraintJson` non-null and uninterpretable => fail-closed
 * deny (INV-03/AC-09) — the v1 evaluator interprets no constraint shape, so any
 * non-null value here is treated as "cannot interpret."
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

/** Role -> policy join (REQ-02/REQ-10). Not user-writable in v1 (F-053-02) — seed-only rows. */
export interface RolePolicyRecord {
  id: UUID;
  workspaceId: UUID;
  roleId: UUID;
  policyId: UUID;
}

/** Principal -> role join, the human grant path (REQ-02/REQ-10). */
export interface PrincipalRoleRecord {
  id: UUID;
  workspaceId: UUID;
  principalId: UUID;
  roleId: UUID;
}

/** Principal -> policy direct grant, the machine grant path (REQ-02/REQ-08/REQ-10). */
export interface PrincipalPolicyRecord {
  id: UUID;
  workspaceId: UUID;
  principalId: UUID;
  policyId: UUID;
}

/** Raised on a malformed identity input (blank username, etc.). */
export class IdentityValidationError extends Error {}
/** Raised when a referenced principal/user/role/policy is not found. */
export class IdentityNotFoundError extends Error {}
/**
 * Raised on a unique-constraint clash (duplicate `username` in a workspace, AC-19). SPEC-006 0.6.0:
 * also raised by `deleteRole`/`deletePolicy` (`admin-crud-service.ts`) when the target still has
 * live references (INV-09, AC-31) — the same 409 `RESOURCE_CONFLICT` shape, a `details.field`
 * distinguishes the two cases at the route layer (errors.spec.md §3).
 */
export class IdentityConflictError extends Error {}
/** Raised by `login()` on bad credentials, a disabled principal, or a blank field (AC-02). */
export class AuthInvalidCredentialsError extends Error {}

/**
 * SPEC-006 0.6.0 (REQ-11/INV-08) — raised by `disablePrincipal` when the target is the seeded owner
 * principal, or when disabling would drop the workspace's active owner-`*` count to zero. Maps to
 * 409 `OWNER_REQUIRED` (errors.spec.md §2) — a pre-existing registered code that had no HTTP
 * emission site until this amendment gave `DISABLE_PRINCIPAL` a route.
 */
export class OwnerRequiredError extends Error {}

/**
 * SPEC-006 0.6.0 (REQ-03/INV-07) — raised by `writePolicyPermission` when the permission string is
 * not in the registered catalog. Maps to 400 `PERMISSION_UNKNOWN` (errors.spec.md §2) — kept
 * distinct from `IdentityValidationError` (plain `VALIDATION_ERROR`) so the route can emit the
 * correct typed code without string-matching the message.
 */
export class PermissionUnknownError extends Error {}

/**
 * Raised when a grant-writing transition's caller-permission gate fails
 * (e.g. `ASSIGN_ROLE` called by a principal without `role.manage`). Maps to
 * 403 `FORBIDDEN` (errors.spec.md §2) — distinct from `GrantExceedsIssuerError`,
 * which is the INV-07 clamp on the *grant's contents*, not the base gate.
 */
export class IdentityForbiddenError extends Error {
  readonly permission: string;
  readonly reason: string;

  constructor(message: string, permission: string, reason: string) {
    super(message);
    this.permission = permission;
    this.reason = reason;
  }
}

/**
 * Raised when a grant-writing transition (`ASSIGN_ROLE`, `ATTACH_POLICY`, and
 * future `ISSUE_API_KEY`/`WRITE_POLICY_PERMISSION`) would confer a permission
 * the caller does not itself hold unconstrained (INV-07 grant-authority
 * clamp, feature.spec.md). Maps to 403 `GRANT_EXCEEDS_ISSUER`
 * (errors.spec.md §2/§3) — `offendingPermissions` is the exact `details`
 * payload shape that error code specifies.
 */
export class GrantExceedsIssuerError extends Error {
  readonly offendingPermissions: string[];

  constructor(message: string, offendingPermissions: string[]) {
    super(message);
    this.offendingPermissions = offendingPermissions;
  }
}
