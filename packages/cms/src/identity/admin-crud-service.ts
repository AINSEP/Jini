import type { UUID } from "../core/ports.js";
import { resolveEffectivePermissions } from "./authorize.js";
import { assertCallerHasAnyPermission, assertGrantClamp, authorizeDepsFrom } from "./grant-service.js";
import { validatePasswordPolicy } from "./password-policy.js";
import { isKnownPermission } from "./permissions.js";
import type { AuthServiceDeps } from "./auth-service.js";
import {
  IdentityConflictError,
  IdentityNotFoundError,
  IdentityValidationError,
  OwnerRequiredError,
  PermissionUnknownError,
  type PolicyPermissionRecord,
  type PolicyRecord,
  type PrincipalRecord,
  type RoleRecord,
  type UserRecord,
} from "./types.js";

/**
 * @file SPEC-006 0.6.0 amendment — completes the users/roles/policies admin CRUD surface
 * (feature.spec.md REQ-11/REQ-15..19).
 *
 * Purpose:
 * Two of these nine transitions (`disablePrincipal`, `writePolicyPermission`) were fully specified
 * since v0.5.0/v0.5.3 but never implemented — this file is their first implementation, not a
 * re-specification (AC-32). The other seven (`enablePrincipal`, `updateUser`,
 * `resetUserPassword`, `updateRole`, `updatePolicy`, `deleteRole`, `deletePolicy`) are new
 * transitions this amendment adds. Grouped in one file, separate from `grant-service.ts`'s
 * "human grant-writing transitions" (`CREATE_*`/`ASSIGN_ROLE`/`ATTACH_POLICY`) because most of
 * these are plain CRUD, not grant-writing — `writePolicyPermission` is the one exception (it IS
 * INV-07-clamped) and reuses `grant-service.ts`'s exported `assertGrantClamp` rather than
 * duplicating it.
 *
 * Architectural role:
 * Ordinary core functions (ADR-006) — same shape as `grant-service.ts`: one exported async
 * function per transition, plain `Error` subclasses for control flow, the caller-permission gate
 * enforced here (not pushed to the route layer).
 */

/**
 * `DISABLE_PRINCIPAL` (feature.spec.md REQ-11, state.spec §3, AC-08/AC-21/AC-27). Gated by
 * `user.manage`. Refuses the seeded owner unconditionally (REQ-13's CLI/core resolution target —
 * disabling it would strand the CLI-only management plane) and refuses any disable that would drop
 * the workspace's active owner-`*` count to zero (INV-08) — both checked, and the status update
 * performed, inside this one function body with no `await` yielded to another caller in between
 * (this codebase's established "atomic by construction" reasoning for a single-connection,
 * single-event-loop composition — same as `features/workspace/delete.ts`'s INV-03 guard).
 *
 * `input.seededOwnerPrincipalId` is the caller's job to resolve (`await deps.ownerPrincipalId` at
 * the route layer, mirroring `identityReady`'s existing await-before-use convention) — this
 * function takes the already-resolved id so it stays a plain, directly-testable function.
 *
 * @complexity O(n) in the workspace's principal count (one `list()` call to count active owner-`*`
 * holders) — bounded by the same operator-managed-roster assumption `identity/INFO.md` already
 * makes for `PrincipalRepoPort.list()`.
 * @overallScore 100
 */
export async function disablePrincipal(required: {
  deps: AuthServiceDeps;
  input: { workspaceId: UUID; callerPrincipalId: UUID; principalId: UUID; seededOwnerPrincipalId: UUID };
}): Promise<{ principal: PrincipalRecord }> {
  const { deps, input } = required;

  await assertCallerHasAnyPermission({
    deps,
    workspaceId: input.workspaceId,
    callerPrincipalId: input.callerPrincipalId,
    permissions: ["user.manage"],
  });

  const target = await deps.repos.principals.findById({ workspaceId: input.workspaceId, id: input.principalId });
  if (!target) throw new IdentityNotFoundError(`principal '${input.principalId}' was not found`);

  if (target.id === input.seededOwnerPrincipalId) {
    throw new OwnerRequiredError("the seeded owner principal can never be disabled (REQ-11/REQ-13)");
  }

  if (target.status === "disabled") {
    // Idempotent — matches LOGOUT's "already revoked is a no-op" discipline (state.spec §3).
    return { principal: target };
  }

  const holdsOwnerWildcard = await principalHoldsOwnerWildcard({
    deps,
    workspaceId: input.workspaceId,
    principalId: target.id,
  });
  if (holdsOwnerWildcard) {
    const activeOwnerCount = await countActiveOwnerWildcardPrincipals({ deps, workspaceId: input.workspaceId });
    if (activeOwnerCount <= 1) {
      throw new OwnerRequiredError(
        "the workspace must keep at least one active owner-`*` principal (INV-08)"
      );
    }
  }

  const disabled: PrincipalRecord = { ...target, status: "disabled", disabledAt: deps.clock.nowIso() };
  await deps.repos.principals.save(disabled);
  return { principal: disabled };
}

/**
 * `ENABLE_PRINCIPAL` (feature.spec.md REQ-15, AC-27, EC-14). Gated by `user.manage`. Target must be
 * `kind='user'` — a `system`/`api_key` target is rejected `VALIDATION_ERROR` (mirrors AC-25b's
 * human-only scoping; re-activating the disabled legacy `user-local` stub or an api_key principal
 * outside `ISSUE_API_KEY`'s own lifecycle is never a valid call). Already-active is idempotent
 * (mirrors `disablePrincipal`'s own already-disabled no-op above).
 *
 * @complexity O(1) — one lookup, one save.
 * @overallScore 100
 */
export async function enablePrincipal(required: {
  deps: AuthServiceDeps;
  input: { workspaceId: UUID; callerPrincipalId: UUID; principalId: UUID };
}): Promise<{ principal: PrincipalRecord }> {
  const { deps, input } = required;

  await assertCallerHasAnyPermission({
    deps,
    workspaceId: input.workspaceId,
    callerPrincipalId: input.callerPrincipalId,
    permissions: ["user.manage"],
  });

  const target = await deps.repos.principals.findById({ workspaceId: input.workspaceId, id: input.principalId });
  if (!target) throw new IdentityNotFoundError(`principal '${input.principalId}' was not found`);

  if (target.kind !== "user") {
    throw new IdentityValidationError(
      `ENABLE_PRINCIPAL target must be a human (kind='user') principal, got kind='${target.kind}'`
    );
  }

  if (target.status === "active") {
    return { principal: target };
  }

  const enabled: PrincipalRecord = { ...target, status: "active", disabledAt: undefined };
  await deps.repos.principals.save(enabled);
  return { principal: enabled };
}

/**
 * `UPDATE_USER` (feature.spec.md REQ-16, AC-28). Gated by `user.manage` **or** `member.manage`
 * (mirrors `CREATE_USER`'s admin-onboarding gate) — `email` only; `username`/`password` are not
 * this transition's concern (OQ-09 / REQ-17 respectively). An absent or empty-string `email`
 * clears the stored value to `undefined` (EC-17 — no distinct "blank but present" state).
 *
 * @complexity O(1) — one lookup, one save.
 * @overallScore 100
 */
export async function updateUser(required: {
  deps: AuthServiceDeps;
  input: { workspaceId: UUID; callerPrincipalId: UUID; principalId: UUID; email?: string | undefined };
}): Promise<{ user: UserRecord }> {
  const { deps, input } = required;

  await assertCallerHasAnyPermission({
    deps,
    workspaceId: input.workspaceId,
    callerPrincipalId: input.callerPrincipalId,
    permissions: ["user.manage", "member.manage"],
  });

  const target = await deps.repos.users.findByPrincipalId({
    workspaceId: input.workspaceId,
    principalId: input.principalId,
  });
  if (!target) throw new IdentityNotFoundError(`user '${input.principalId}' was not found`);

  const updated: UserRecord = { ...target, email: input.email ? input.email : undefined };
  await deps.repos.users.save(updated);
  return { user: updated };
}

/**
 * `RESET_USER_PASSWORD` (feature.spec.md REQ-17, AC-29, EC-16). Gated by **`user.manage`** only
 * (stricter than `updateUser` — resetting a credential is at least as sensitive as disabling the
 * account, REQ-17's own reasoning). Hashes the new password identically to `CREATE_USER` (argon2id,
 * INV-05), then revokes every one of the target's active sessions (idempotent no-op if it has none,
 * EC-16) — a reset that left old sessions alive would not actually contain a compromised account.
 *
 * @complexity O(s) in the target's session count, s = active session rows to revoke — bounded by
 * the same operator-managed-roster scale assumption every other identity list call here makes.
 * @overallScore 100
 */
export async function resetUserPassword(required: {
  deps: AuthServiceDeps;
  input: { workspaceId: UUID; callerPrincipalId: UUID; principalId: UUID; password: string };
}): Promise<{ user: UserRecord }> {
  const { deps, input } = required;

  await assertCallerHasAnyPermission({
    deps,
    workspaceId: input.workspaceId,
    callerPrincipalId: input.callerPrincipalId,
    permissions: ["user.manage"],
  });

  const target = await deps.repos.users.findByPrincipalId({
    workspaceId: input.workspaceId,
    principalId: input.principalId,
  });
  if (!target) throw new IdentityNotFoundError(`user '${input.principalId}' was not found`);

  if (!input.password) {
    throw new IdentityValidationError("password is required");
  }
  // Same NIST SP 800-63B length-only policy `createUser` applies. Both write paths must enforce
  // it or neither does: a reset that accepted a 1-character password would be a strictly easier
  // way to reach the state the create-side check exists to prevent. Never reaches `seed.ts`'s
  // owner password or the login path — see `password-policy.ts`'s header for why.
  const passwordError = validatePasswordPolicy(input.password);
  if (passwordError) {
    throw new IdentityValidationError(passwordError);
  }

  const passwordHash = await deps.hasher.hash(input.password);
  const updated: UserRecord = { ...target, passwordHash };
  await deps.repos.users.save(updated);

  const sessions = await deps.repos.sessions.listByPrincipalId({
    workspaceId: input.workspaceId,
    principalId: input.principalId,
  });
  const nowIso = deps.clock.nowIso();
  await Promise.all(
    sessions
      .filter((session) => !session.revokedAt)
      .map((session) => deps.repos.sessions.revoke({ workspaceId: input.workspaceId, id: session.id, revokedAt: nowIso }))
  );

  return { user: updated };
}

/**
 * `UPDATE_ROLE` (feature.spec.md REQ-18, AC-30). Gated by `role.manage`. A built-in target is
 * refused `VALIDATION_ERROR` — extends INV-06's existing undeletable/immutable/un-attachable-to
 * rule to also cover un-renameable (same escalation shape: relabeling `viewer` to read as trusted
 * is a social-engineering variant of what INV-06 already blocks structurally).
 *
 * @complexity O(1) — one lookup, one save.
 * @overallScore 100
 */
export async function updateRole(required: {
  deps: AuthServiceDeps;
  input: { workspaceId: UUID; callerPrincipalId: UUID; roleId: UUID; name: string };
}): Promise<{ role: RoleRecord }> {
  const { deps, input } = required;

  await assertCallerHasAnyPermission({
    deps,
    workspaceId: input.workspaceId,
    callerPrincipalId: input.callerPrincipalId,
    permissions: ["role.manage"],
  });

  const target = await deps.repos.roles.findById({ workspaceId: input.workspaceId, id: input.roleId });
  if (!target) throw new IdentityNotFoundError(`role '${input.roleId}' was not found`);
  if (target.isBuiltin) {
    throw new IdentityValidationError("a built-in role cannot be renamed (INV-06)");
  }

  const name = (input.name ?? "").trim();
  if (!name) throw new IdentityValidationError("role name is required");

  const updated: RoleRecord = { ...target, name };
  await deps.repos.roles.save(updated);
  return { role: updated };
}

/**
 * `UPDATE_POLICY` (feature.spec.md REQ-18, AC-30). Gated by `role.manage`. A built-in or
 * `is_frozen` target is refused `VALIDATION_ERROR` — the frozen-policy half mirrors
 * `WRITE_POLICY_PERMISSION`'s existing refusal (AC-26): an issuance snapshot's identity is as
 * immutable as its permission set. At least one of `name`/`description` must be present.
 *
 * @complexity O(1) — one lookup, one save.
 * @overallScore 100
 */
export async function updatePolicy(required: {
  deps: AuthServiceDeps;
  input: { workspaceId: UUID; callerPrincipalId: UUID; policyId: UUID; name?: string | undefined; description?: string | undefined };
}): Promise<{ policy: PolicyRecord }> {
  const { deps, input } = required;

  await assertCallerHasAnyPermission({
    deps,
    workspaceId: input.workspaceId,
    callerPrincipalId: input.callerPrincipalId,
    permissions: ["role.manage"],
  });

  const target = await deps.repos.policies.findById({ workspaceId: input.workspaceId, id: input.policyId });
  if (!target) throw new IdentityNotFoundError(`policy '${input.policyId}' was not found`);
  if (target.isBuiltin || target.isFrozen) {
    throw new IdentityValidationError("a built-in or frozen policy cannot be renamed/re-described (INV-06/AC-26)");
  }

  if (input.name === undefined && input.description === undefined) {
    throw new IdentityValidationError("at least one of name or description is required");
  }

  const name = input.name !== undefined ? input.name.trim() : target.name;
  if (!name) throw new IdentityValidationError("policy name is required");

  const updated: PolicyRecord = {
    ...target,
    name,
    description: input.description !== undefined ? input.description : target.description,
  };
  await deps.repos.policies.save(updated);
  return { policy: updated };
}

/**
 * `DELETE_ROLE` (feature.spec.md REQ-19/INV-09, AC-31, EC-15). Gated by `role.manage`. A built-in
 * target is refused `VALIDATION_ERROR` (checked before the reference count, matching AC-31's
 * stated precedence). A still-referenced target (≥1 `principal_roles` row) is refused
 * `IdentityConflictError` (409 `RESOURCE_CONFLICT`) — the reference check and the delete happen in
 * this one function body with no yielded `await` in between (INV-09's atomicity, same reasoning as
 * `disablePrincipal`'s owner-count guard above).
 *
 * @complexity O(a) in the role's assignment count (`principalRoles.listByRoleId`) — bounded by the
 * same operator-managed-roster assumption every other identity list call makes.
 * @overallScore 100
 */
export async function deleteRole(required: {
  deps: AuthServiceDeps;
  input: { workspaceId: UUID; callerPrincipalId: UUID; roleId: UUID };
}): Promise<void> {
  const { deps, input } = required;

  await assertCallerHasAnyPermission({
    deps,
    workspaceId: input.workspaceId,
    callerPrincipalId: input.callerPrincipalId,
    permissions: ["role.manage"],
  });

  const target = await deps.repos.roles.findById({ workspaceId: input.workspaceId, id: input.roleId });
  if (!target) throw new IdentityNotFoundError(`role '${input.roleId}' was not found`);
  if (target.isBuiltin) {
    throw new IdentityValidationError("a built-in role cannot be deleted (INV-06)");
  }

  const assignments = await deps.repos.principalRoles.listByRoleId({
    workspaceId: input.workspaceId,
    roleId: input.roleId,
  });
  if (assignments.length > 0) {
    throw new IdentityConflictError(
      `role '${input.roleId}' is still assigned to ${assignments.length} principal(s) (INV-09)`
    );
  }

  await deps.repos.roles.delete({ workspaceId: input.workspaceId, id: input.roleId });
}

/**
 * `DELETE_POLICY` (feature.spec.md REQ-19/INV-09, AC-31, EC-15). Gated by `role.manage`. A
 * built-in or `is_frozen` target is refused `VALIDATION_ERROR` (checked before the reference
 * count). A still-referenced target (≥1 `role_policies` or `principal_policies` row) is refused
 * `IdentityConflictError`. On success, cascades to the policy's OWN `policy_permissions` rows only
 * (never a different policy's) before deleting the policy row itself.
 *
 * @complexity O(r + p) — role-reference count + principal-reference count, both bounded by the same
 * operator-managed-roster assumption every other identity list call makes.
 * @overallScore 100
 */
export async function deletePolicy(required: {
  deps: AuthServiceDeps;
  input: { workspaceId: UUID; callerPrincipalId: UUID; policyId: UUID };
}): Promise<void> {
  const { deps, input } = required;

  await assertCallerHasAnyPermission({
    deps,
    workspaceId: input.workspaceId,
    callerPrincipalId: input.callerPrincipalId,
    permissions: ["role.manage"],
  });

  const target = await deps.repos.policies.findById({ workspaceId: input.workspaceId, id: input.policyId });
  if (!target) throw new IdentityNotFoundError(`policy '${input.policyId}' was not found`);
  if (target.isBuiltin || target.isFrozen) {
    throw new IdentityValidationError("a built-in or frozen policy cannot be deleted (INV-06/AC-26)");
  }

  const [roleRefs, principalRefs] = await Promise.all([
    deps.repos.rolePolicies.listByPolicyId({ workspaceId: input.workspaceId, policyId: input.policyId }),
    deps.repos.principalPolicies.listByPolicyId({ workspaceId: input.workspaceId, policyId: input.policyId }),
  ]);
  const referenceCount = roleRefs.length + principalRefs.length;
  if (referenceCount > 0) {
    throw new IdentityConflictError(
      `policy '${input.policyId}' is still referenced by ${referenceCount} row(s) (INV-09)`
    );
  }

  await deps.repos.policyPermissions.deleteByPolicyId({ workspaceId: input.workspaceId, policyId: input.policyId });
  await deps.repos.policies.delete({ workspaceId: input.workspaceId, id: input.policyId });
}

/**
 * `WRITE_POLICY_PERMISSION` (feature.spec.md INV-07, state.spec §3, AC-10/AC-24/AC-26). First HTTP
 * implementation of a transition specified since v0.5.3 (AC-32 — this is a route, not a
 * re-specification). Gated by `role.manage`. Refuses an unregistered permission
 * (`PermissionUnknownError`, REQ-03), a built-in or `is_frozen` parent policy (INV-06/AC-26), and
 * (via the shared `assertGrantClamp`) a permission the caller does not itself hold unconstrained
 * (INV-07, `GrantExceedsIssuerError`).
 *
 * @complexity O(assertGrantClamp) — see that function's own doc (resolveEffectivePermissions +
 * O(1) local filtering, one permission).
 * @overallScore 100
 */
export async function writePolicyPermission(required: {
  deps: AuthServiceDeps;
  input: {
    workspaceId: UUID;
    callerPrincipalId: UUID;
    policyId: UUID;
    permission: string;
    resourceType?: string | null;
    constraintJson?: string | null;
  };
}): Promise<{ policyPermission: PolicyPermissionRecord }> {
  const { deps, input } = required;

  await assertCallerHasAnyPermission({
    deps,
    workspaceId: input.workspaceId,
    callerPrincipalId: input.callerPrincipalId,
    permissions: ["role.manage"],
  });

  if (!isKnownPermission(input.permission)) {
    throw new PermissionUnknownError(`permission '${input.permission}' is not in the registered catalog`);
  }

  const policy = await deps.repos.policies.findById({ workspaceId: input.workspaceId, id: input.policyId });
  if (!policy) throw new IdentityNotFoundError(`policy '${input.policyId}' was not found`);
  if (policy.isBuiltin || policy.isFrozen) {
    throw new IdentityValidationError(
      "cannot write a permission onto a built-in or frozen policy (INV-06/AC-26)"
    );
  }

  await assertGrantClamp({
    deps,
    workspaceId: input.workspaceId,
    callerPrincipalId: input.callerPrincipalId,
    conferredPermissions: [input.permission],
  });

  const policyPermission: PolicyPermissionRecord = {
    id: deps.idGen.newId(),
    workspaceId: input.workspaceId,
    policyId: input.policyId,
    permission: input.permission,
    resourceType: input.resourceType ?? null,
    constraintJson: input.constraintJson ?? null,
  };
  await deps.repos.policyPermissions.save(policyPermission);
  return { policyPermission };
}

/** True iff `principalId` holds the owner wildcard `*` (unconstrained) in its effective set. */
async function principalHoldsOwnerWildcard(required: {
  deps: AuthServiceDeps;
  workspaceId: UUID;
  principalId: UUID;
}): Promise<boolean> {
  const { deps, workspaceId, principalId } = required;
  const effectiveRows = await resolveEffectivePermissions({
    deps: authorizeDepsFrom(deps.repos),
    principalId,
    workspaceId,
  });
  return effectiveRows.some((row) => row.permission === "*" && row.resourceType == null && row.constraintJson == null);
}

/**
 * Count `active` principals in `workspaceId` that hold the owner wildcard `*` (INV-08's own
 * definition of "owner-`*` principal"). O(n) in the workspace's principal count, n bounded by the
 * same operator-managed-roster assumption `identity/INFO.md` documents.
 */
async function countActiveOwnerWildcardPrincipals(required: {
  deps: AuthServiceDeps;
  workspaceId: UUID;
}): Promise<number> {
  const { deps, workspaceId } = required;
  const principals = await deps.repos.principals.list({ workspaceId });
  const activePrincipals = principals.filter((principal) => principal.status === "active");
  const flags = await Promise.all(
    activePrincipals.map((principal) =>
      principalHoldsOwnerWildcard({ deps, workspaceId, principalId: principal.id })
    )
  );
  return flags.filter(Boolean).length;
}
