import type { ISODateTime, UUID } from "@jini-ai/core/primitives";

/**
 * @file Core domain types for the `user-management` library.
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
 * the full target schema so those transitions are additive later,
 * not a repaint.
 */

/** Every actor is one of these. Only `user`/`system` are populated this pass. */
export type PrincipalKind = "user" | "agent" | "api_key" | "system";

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

/** Raised on a malformed identity input (blank username, etc.). */
export class IdentityValidationError extends Error {
  constructor({ message }: { message: string }, optional: ErrorOptions = {}) {
    super(message, optional);
  }
}
/** Raised when a referenced principal/user/role/policy is not found. */
export class IdentityNotFoundError extends Error {
  constructor({ message }: { message: string }, optional: ErrorOptions = {}) {
    super(message, optional);
  }
}
/**
 * Raised on a unique-constraint clash (duplicate `username` in a workspace). Also
 * raised by `deleteRole`/`deletePolicy` (`admin-crud-service.ts`) when the target still has
 * live references — the same 409 `RESOURCE_CONFLICT` shape, a `details.field`
 * distinguishes the two cases at the route layer (errors.spec.md §3).
 * See docs/decisions/DR-001-identity-and-session-boundary.md.
 */
export class IdentityConflictError extends Error {
  constructor({ message }: { message: string }, optional: ErrorOptions = {}) {
    super(message, optional);
  }
}
/** Raised by `login` on bad credentials, a disabled principal, or a blank field. See docs/decisions/DR-001-identity-and-session-boundary.md. */
export class AuthInvalidCredentialsError extends Error {
  constructor({ message }: { message: string }, optional: ErrorOptions = {}) {
    super(message, optional);
  }
}

/**
 * — raised by `disablePrincipal` when the target is the seeded owner
 * principal, or when disabling would drop the workspace's active owner-`*` count to zero. Maps to
 * 409 `OWNER_REQUIRED` (errors.spec.md §2) — a pre-existing registered code that had no HTTP
 * emission site until this amendment gave `DISABLE_PRINCIPAL` a route.
 * See docs/decisions/DR-001-identity-and-session-boundary.md.
 */
export class OwnerRequiredError extends Error {
  constructor({ message }: { message: string }, optional: ErrorOptions = {}) {
    super(message, optional);
  }
}

/**
 * — raised by `writePolicyPermission` when the permission string is
 * not in the registered catalog. Maps to 400 `PERMISSION_UNKNOWN` (errors.spec.md §2) — kept
 * distinct from `IdentityValidationError` (plain `VALIDATION_ERROR`) so the route can emit the
 * correct typed code without string-matching the message.
 * See docs/decisions/DR-001-identity-and-session-boundary.md.
 */
export class PermissionUnknownError extends Error {
  constructor({ message }: { message: string }, optional: ErrorOptions = {}) {
    super(message, optional);
  }
}

/**
 * Raised when a grant-writing transition's caller-permission gate fails
 * (e.g. `ASSIGN_ROLE` called by a principal without `role.manage`). Maps to
 * 403 `FORBIDDEN` (errors.spec.md §2) — distinct from `GrantExceedsIssuerError`,
 * which is the clamp on the *grant's contents*, not the base gate.
 * See docs/decisions/DR-001-identity-and-session-boundary.md.
 */
export class IdentityForbiddenError extends Error {
  readonly permission: string;
  readonly reason: string;

  constructor({ message, permission, reason }: { message: string; permission: string; reason: string }, optional: ErrorOptions = {}) {
    super(message, optional);
    this.permission = permission;
    this.reason = reason;
  }
}

/**
 * Raised when a grant-writing transition (`ASSIGN_ROLE`, `ATTACH_POLICY`, and
 * future `ISSUE_API_KEY`/`WRITE_POLICY_PERMISSION`) would confer a permission
 * the caller does not itself hold unconstrained ( grant-authority
 * clamp, feature.spec.md). Maps to 403 `GRANT_EXCEEDS_ISSUER`
 * (errors.spec.md §2/§3) — `offendingPermissions` is the exact `details`
 * payload shape that error code specifies.
 * See docs/decisions/DR-001-identity-and-session-boundary.md.
 */
export class GrantExceedsIssuerError extends Error {
  readonly offendingPermissions: string[];

  constructor({ message, offendingPermissions }: { message: string; offendingPermissions: string[] }, optional: ErrorOptions = {}) {
    super(message, optional);
    this.offendingPermissions = offendingPermissions;
  }
}

/** Raised before a guarded mutation when its host has not bound atomic identity storage. */
export class IdentityTransactionRequiredError extends Error {
  constructor(required: Record<string, never>, optional: ErrorOptions = {}) {
    super("identity mutation requires a transaction port", optional);
  }
}
