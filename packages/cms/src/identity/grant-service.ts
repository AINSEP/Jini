import type { UUID } from "../core/ports.js";
import { authorize, resolveEffectivePermissions, type AuthorizeDeps } from "./authorize.js";
import type { AuthServiceDeps } from "./auth-service.js";
import type { IdentityRepos } from "./ports.js";
import {
  GrantExceedsIssuerError,
  IdentityConflictError,
  IdentityForbiddenError,
  IdentityNotFoundError,
  IdentityValidationError,
  type PolicyPermissionRecord,
  type PolicyRecord,
  type PrincipalPolicyRecord,
  type PrincipalRecord,
  type PrincipalRoleRecord,
  type RoleRecord,
  type UserRecord,
} from "./types.js";
import { normalizeUsername } from "./username.js";
import { validatePasswordPolicy } from "./password-policy.js";

/**
 * @file Human grant-writing transitions (state.spec.md §3): `CREATE_USER`,
 * `CREATE_ROLE`, `CREATE_POLICY`, `ASSIGN_ROLE`, `ATTACH_POLICY`.
 *
 * Purpose:
 * The only usable identity principal before this file was the seeded owner —
 * there was no API path to create a second user or grant/change permissions.
 * These five functions are that path, following `auth-service.ts`'s exact
 * shape (`{ deps: AuthServiceDeps, input: {...} }`, one exported async
 * function per transition, plain `Error` subclasses for control flow).
 *
 * Out of scope (deferred, see the dispatch directive): `ISSUE_API_KEY`,
 * `CREATE_PRINCIPAL` (api_key/agent principal creation), agent/api_key
 * delegation, `WRITE_POLICY_PERMISSION`, `DISABLE_PRINCIPAL`.
 *
 * Architectural role:
 * Ordinary core functions, not ports (mirrors `auth-service.ts`'s reasoning —
 * grant-writing logic has one implementation). Each function calls
 * `authorize()`/`resolveEffectivePermissions()` from `authorize.ts` itself
 * (rather than pushing the gate into the route layer, the way
 * `members/disable.ts`'s route does) so the caller-permission gate and the
 * INV-07 clamp are exercised directly by unit tests, no HTTP harness needed.
 */

/**
 * Assemble the `AuthorizeDeps` bag `authorize()`/`resolveEffectivePermissions()` expect from the
 * flat `IdentityRepos` bag. Exported so `admin-crud-service.ts`'s new transitions
 * (`ENABLE_PRINCIPAL`/`UPDATE_USER`/`RESET_USER_PASSWORD`/`UPDATE_ROLE`/`UPDATE_POLICY`/
 * `DELETE_ROLE`/`DELETE_POLICY`/`WRITE_POLICY_PERMISSION`/`DISABLE_PRINCIPAL`) reuse the identical
 * gate/clamp logic rather than duplicating it — same file-split reasoning `auth-service.ts` and
 * `grant-service.ts` already use (one shared helper set, two transition files).
 */
export function authorizeDepsFrom(repos: IdentityRepos): AuthorizeDeps {
  return {
    principals: repos.principals,
    principalRoles: repos.principalRoles,
    rolePolicies: repos.rolePolicies,
    principalPolicies: repos.principalPolicies,
    policyPermissions: repos.policyPermissions,
  };
}

/**
 * Fail-closed caller-permission gate shared by every transition in this file.
 * Throws `IdentityForbiddenError` (403 `FORBIDDEN`) unless the caller holds
 * at least one of `permissions` (an OR gate — `CREATE_USER` accepts either
 * `user.manage` or `member.manage`, state.spec §3).
 *
 * @complexity O(p) `authorize()` calls, p = `permissions.length` (1 or 2 in
 * every caller this pass) — each itself O(resolveEffectivePermissions), see
 * that function's doc.
 * @overallScore 100
 */
export async function assertCallerHasAnyPermission(required: {
  deps: AuthServiceDeps;
  workspaceId: UUID;
  callerPrincipalId: UUID;
  permissions: readonly string[];
}): Promise<void> {
  const { deps, workspaceId, callerPrincipalId, permissions } = required;

  let lastReason = "no_grant";
  for (const permission of permissions) {
    const result = await authorize({
      deps: authorizeDepsFrom(deps.repos),
      principalId: callerPrincipalId,
      permission,
      context: { workspaceId },
    });
    if (result.allowed) return;
    lastReason = result.reason;
  }

  throw new IdentityForbiddenError(
    `principal '${callerPrincipalId}' is not authorized for any of [${permissions.join(", ")}]`,
    permissions.join("|"),
    lastReason
  );
}

/** True iff `effectiveRows` contains an unconstrained hold of `permission` — an exact match with
 * `resourceType`/`constraintJson` both null, or the owner wildcard `*` (which counts as an
 * unconstrained hold of every permission, INV-07). */
function holdsUnconstrained(effectiveRows: readonly PolicyPermissionRecord[], permission: string): boolean {
  const hasWildcard = effectiveRows.some(
    (row) => row.permission === "*" && row.resourceType == null && row.constraintJson == null
  );
  if (hasWildcard) return true;
  return effectiveRows.some(
    (row) => row.permission === permission && row.resourceType == null && row.constraintJson == null
  );
}

/**
 * The INV-07 grant-authority clamp (feature.spec.md, state.spec §3
 * `ASSIGN_ROLE`/`ATTACH_POLICY` rows): every permission in `conferredPermissions`
 * must be a matching effective row the caller holds unconstrained
 * (`resourceType`/`constraintJson` both null; owner's `*` qualifies for all).
 * A permission held only conditionally (resource-scoped or constraint-bound)
 * cannot be delegated. Throws `GrantExceedsIssuerError` (403
 * `GRANT_EXCEEDS_ISSUER`) naming every offending permission, and writes no
 * grant row (caller does the write only after this resolves).
 *
 * @complexity O(resolveEffectivePermissions) + O(k) local filtering, k =
 * `conferredPermissions.length` (bounded by one role's/policy's permission
 * rows — a handful, per `identity/INFO.md`'s scale assumptions).
 * @overallScore 100
 */
export async function assertGrantClamp(required: {
  deps: AuthServiceDeps;
  workspaceId: UUID;
  callerPrincipalId: UUID;
  conferredPermissions: readonly string[];
}): Promise<void> {
  const { deps, workspaceId, callerPrincipalId, conferredPermissions } = required;
  const distinctPermissions = [...new Set(conferredPermissions)];
  if (distinctPermissions.length === 0) return;

  const effectiveRows = await resolveEffectivePermissions({
    deps: authorizeDepsFrom(deps.repos),
    principalId: callerPrincipalId,
    workspaceId,
  });

  const offendingPermissions = distinctPermissions.filter(
    (permission) => !holdsUnconstrained(effectiveRows, permission)
  );
  if (offendingPermissions.length > 0) {
    throw new GrantExceedsIssuerError(
      `principal '${callerPrincipalId}' cannot grant permission(s) it does not hold unconstrained: ${offendingPermissions.join(", ")}`,
      offendingPermissions
    );
  }
}

/**
 * `ASSIGN_ROLE`/`ATTACH_POLICY`'s shared human-target-only rule (AC-25b):
 * machine (`api_key`/`system`) principal authority is set solely at
 * issuance, never mutated by a later human-grant transition. Throws
 * `IdentityValidationError` (400 `VALIDATION_ERROR`) for a non-`user` or
 * missing target — this check runs *before* the INV-07 clamp (AC-25's note:
 * "does not reach this clamp").
 */
async function findAssignableTargetOrThrow(required: {
  deps: AuthServiceDeps;
  workspaceId: UUID;
  principalId: UUID;
  transitionName: "ASSIGN_ROLE" | "ATTACH_POLICY";
}): Promise<PrincipalRecord> {
  const { deps, workspaceId, principalId, transitionName } = required;
  const target = await deps.repos.principals.findById({ workspaceId, id: principalId });
  if (!target) {
    throw new IdentityNotFoundError(`principal '${principalId}' was not found`);
  }
  if (target.kind !== "user") {
    throw new IdentityValidationError(
      `${transitionName} target must be a human (kind='user') principal, got kind='${target.kind}'`
    );
  }
  return target;
}

/**
 * `CREATE_USER` (state.spec §3, REQ-01/MF-1). Atomically mints a NEW
 * `kind='user'` principal and its `users` row — the `principalId` is always
 * generated here, never caller-supplied, so this transition can never attach
 * a credential to a pre-existing principal (the MF-1 privilege-escalation
 * class: an earlier draft let an admin bind a password to the seeded owner
 * principal and log in as owner). Gated by `user.manage` OR `member.manage`
 * (admin onboarding, AC-22).
 *
 * "Atomically" here means structurally, not via a DB transaction — the
 * in-memory adapters have no cross-repo transaction (same disclosed gap as
 * `seed.ts`/`executeCommand`'s compensating-rollback path). The invariant
 * that actually matters (no credential ever attaches to an existing
 * principal) holds regardless, because `principalId` is generated inline and
 * the password is hashed before either row is written, so a hashing failure
 * leaves no orphan principal. A future SQLite adapter wraps both writes in
 * one real transaction (port/adapter rule-of-two) without changing this contract.
 *
 * @complexity O(1) — one permission check, one username lookup, one hash,
 * two saves.
 * @overallScore 100
 */
export async function createUser(required: {
  deps: AuthServiceDeps;
  input: { workspaceId: UUID; callerPrincipalId: UUID; username: string; email?: string | undefined; password: string };
}): Promise<{ principal: PrincipalRecord; user: UserRecord }> {
  const { deps, input } = required;

  await assertCallerHasAnyPermission({
    deps,
    workspaceId: input.workspaceId,
    callerPrincipalId: input.callerPrincipalId,
    permissions: ["user.manage", "member.manage"],
  });

  const username = normalizeUsername(input.username ?? "");
  if (!username || !input.password) {
    throw new IdentityValidationError("username and password are required");
  }
  // NIST SP 800-63B length-only policy (MSG-04) — never reaches seed.ts's owner password, see
  // password-policy.ts's own header for why that separation is deliberate.
  const passwordError = validatePasswordPolicy(input.password);
  if (passwordError) {
    throw new IdentityValidationError(passwordError);
  }

  const existingUser = await deps.repos.users.findByUsername({ workspaceId: input.workspaceId, username });
  if (existingUser) {
    throw new IdentityConflictError(`username '${username}' is already in use`);
  }

  const passwordHash = await deps.hasher.hash(input.password);
  const nowIso = deps.clock.nowIso();
  const principalId = deps.idGen.newId();

  const principal: PrincipalRecord = {
    id: principalId,
    workspaceId: input.workspaceId,
    kind: "user",
    displayName: username,
    status: "active",
    createdAt: nowIso,
  };
  const user: UserRecord = {
    principalId,
    workspaceId: input.workspaceId,
    username,
    email: input.email,
    passwordHash,
  };

  await deps.repos.principals.save(principal);
  await deps.repos.users.save(user);

  return { principal, user };
}

/**
 * `CREATE_ROLE` (state.spec §3). Gated by `role.manage`. Always mints
 * `isBuiltin=false` — built-ins are SEED-only and immutable (INV-06).
 *
 * Deviation from the state.spec §3 table (disclosed): that row lists
 * `name`, `description?` jointly for `CREATE_ROLE`/`CREATE_POLICY`, but
 * `RoleRecord` (types.ts, frozen before this task) has no `description`
 * field — only `PolicyRecord` does. `createRole` therefore takes `name`
 * only; `createPolicy` below takes both.
 *
 * @complexity O(1) — one permission check, one save.
 * @overallScore 100
 */
export async function createRole(required: {
  deps: AuthServiceDeps;
  input: { workspaceId: UUID; callerPrincipalId: UUID; name: string };
}): Promise<{ role: RoleRecord }> {
  const { deps, input } = required;

  await assertCallerHasAnyPermission({
    deps,
    workspaceId: input.workspaceId,
    callerPrincipalId: input.callerPrincipalId,
    permissions: ["role.manage"],
  });

  const name = (input.name ?? "").trim();
  if (!name) {
    throw new IdentityValidationError("role name is required");
  }

  const role: RoleRecord = {
    id: deps.idGen.newId(),
    workspaceId: input.workspaceId,
    name,
    isBuiltin: false,
  };
  await deps.repos.roles.save(role);
  return { role };
}

/**
 * `CREATE_POLICY` (state.spec §3). Gated by `role.manage`. Always mints
 * `isBuiltin=false` and `isFrozen=false` — only the (out-of-scope this pass)
 * `ISSUE_API_KEY` transition ever mints `isFrozen=true` policies.
 *
 * @complexity O(1) — one permission check, one save.
 * @overallScore 100
 */
export async function createPolicy(required: {
  deps: AuthServiceDeps;
  input: { workspaceId: UUID; callerPrincipalId: UUID; name: string; description?: string | undefined };
}): Promise<{ policy: PolicyRecord }> {
  const { deps, input } = required;

  await assertCallerHasAnyPermission({
    deps,
    workspaceId: input.workspaceId,
    callerPrincipalId: input.callerPrincipalId,
    permissions: ["role.manage"],
  });

  const name = (input.name ?? "").trim();
  if (!name) {
    throw new IdentityValidationError("policy name is required");
  }

  const policy: PolicyRecord = {
    id: deps.idGen.newId(),
    workspaceId: input.workspaceId,
    name,
    description: input.description,
    isBuiltin: false,
    isFrozen: false,
  };
  await deps.repos.policies.save(policy);
  return { policy };
}

/**
 * `ASSIGN_ROLE` (state.spec §3, REQ-02, AC-24/AC-25). Gated by `role.manage`;
 * target must be a `kind='user'` principal (AC-25b); the INV-07 clamp must
 * pass over every permission carried by the role's policies (AC-24) — so
 * assigning the built-in `owner` role requires the caller to already hold
 * the wildcard `*` (owner-only). No row is written on any rejection.
 *
 * @complexity O(resolveEffectivePermissions) + O(role's rolePolicy count)
 * round trips to gather conferred permissions — both bounded by the small,
 * hand-authored grant graph this system assumes (see `identity/INFO.md`).
 * @overallScore 100
 */
export async function assignRole(required: {
  deps: AuthServiceDeps;
  input: { workspaceId: UUID; callerPrincipalId: UUID; principalId: UUID; roleId: UUID };
}): Promise<{ assignment: PrincipalRoleRecord }> {
  const { deps, input } = required;

  await assertCallerHasAnyPermission({
    deps,
    workspaceId: input.workspaceId,
    callerPrincipalId: input.callerPrincipalId,
    permissions: ["role.manage"],
  });

  await findAssignableTargetOrThrow({
    deps,
    workspaceId: input.workspaceId,
    principalId: input.principalId,
    transitionName: "ASSIGN_ROLE",
  });

  const role = await deps.repos.roles.findById({ workspaceId: input.workspaceId, id: input.roleId });
  if (!role) {
    throw new IdentityNotFoundError(`role '${input.roleId}' was not found`);
  }

  const rolePolicyLinks = await deps.repos.rolePolicies.listByRoleId({
    workspaceId: input.workspaceId,
    roleId: input.roleId,
  });
  const policyPermissionGroups = await Promise.all(
    rolePolicyLinks.map((link) =>
      deps.repos.policyPermissions.listByPolicyId({ workspaceId: input.workspaceId, policyId: link.policyId })
    )
  );
  const conferredPermissions = policyPermissionGroups.flat().map((row) => row.permission);

  await assertGrantClamp({
    deps,
    workspaceId: input.workspaceId,
    callerPrincipalId: input.callerPrincipalId,
    conferredPermissions,
  });

  const assignment: PrincipalRoleRecord = {
    id: deps.idGen.newId(),
    workspaceId: input.workspaceId,
    principalId: input.principalId,
    roleId: input.roleId,
  };
  await deps.repos.principalRoles.save(assignment);
  return { assignment };
}

/**
 * `ATTACH_POLICY` (state.spec §3, REQ-02, AC-24/AC-25). Gated by
 * `role.manage`; target must be a `kind='user'` principal (AC-25b); the
 * INV-07 clamp must pass over every permission the policy carries (AC-24) —
 * attaching the built-in `owner` policy requires the caller to already hold
 * `*` (owner-only). No row is written on any rejection.
 *
 * @complexity O(resolveEffectivePermissions) + O(policy's permission row
 * count) — both bounded, see `assignRole`'s doc.
 * @overallScore 100
 */
export async function attachPolicy(required: {
  deps: AuthServiceDeps;
  input: { workspaceId: UUID; callerPrincipalId: UUID; principalId: UUID; policyId: UUID };
}): Promise<{ attachment: PrincipalPolicyRecord }> {
  const { deps, input } = required;

  await assertCallerHasAnyPermission({
    deps,
    workspaceId: input.workspaceId,
    callerPrincipalId: input.callerPrincipalId,
    permissions: ["role.manage"],
  });

  await findAssignableTargetOrThrow({
    deps,
    workspaceId: input.workspaceId,
    principalId: input.principalId,
    transitionName: "ATTACH_POLICY",
  });

  const policy = await deps.repos.policies.findById({ workspaceId: input.workspaceId, id: input.policyId });
  if (!policy) {
    throw new IdentityNotFoundError(`policy '${input.policyId}' was not found`);
  }

  const permissionRows = await deps.repos.policyPermissions.listByPolicyId({
    workspaceId: input.workspaceId,
    policyId: input.policyId,
  });
  const conferredPermissions = permissionRows.map((row) => row.permission);

  await assertGrantClamp({
    deps,
    workspaceId: input.workspaceId,
    callerPrincipalId: input.callerPrincipalId,
    conferredPermissions,
  });

  const attachment: PrincipalPolicyRecord = {
    id: deps.idGen.newId(),
    workspaceId: input.workspaceId,
    principalId: input.principalId,
    policyId: input.policyId,
  };
  await deps.repos.principalPolicies.save(attachment);
  return { attachment };
}
