import { nowIso as kernelNowIso } from "@jini-ai/core/primitives";
import { inIdentityTransaction } from "./identity-transaction.js";
import type { UUID } from "@jini-ai/core/primitives";
import { assertCallerHasAnyPermission, assertGrantClamp, assertOwnerTargetMayBeModified, principalHoldsOwnerWildcard } from "./grant-service.js";
import { validatePasswordPolicy } from "./password-policy.js";
import { isKnownPermission } from "../core/permissions.js";
import { principalKindMayExercisePermission } from "../core/principal-kind-policy.js";
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
} from "../core/types.js";

/**
 * @file An amendment that completes the users/roles/policies admin CRUD surface
 * (feature.spec.md..19).
 *
 * Purpose:
 * Two of these nine transitions (`disablePrincipal`, `writePolicyPermission`) were fully specified
 * since v0.5.0/v0.5.3 but never implemented — this file is their first implementation, not a
 * re-specification. The other seven (`enablePrincipal`, `updateUser`,
 * `resetUserPassword`, `updateRole`, `updatePolicy`, `deleteRole`, `deletePolicy`) are new
 * transitions this amendment adds. Grouped in one file, separate from `grant-service.ts`'s
 * "human grant-writing transitions" (`CREATE_*`/`ASSIGN_ROLE`/`ATTACH_POLICY`) because most of
 * these are plain CRUD, not grant-writing — `writePolicyPermission` is the one exception (it IS
 * -clamped) and reuses `grant-service.ts`'s exported `assertGrantClamp` rather than
 * duplicating it.
 *
 * Architectural role:
 * Ordinary core functions — same shape as `grant-service.ts`: one exported async
 * function per transition, plain `Error` subclasses for control flow, the caller-permission gate
 * enforced here (not pushed to the route layer).
 * See docs/decisions/DR-002-grant-authority-and-admin-safety.md.
 */

/**
 * `DISABLE_PRINCIPAL` (feature.spec.md, state.spec §3). Gated by
 * `user.manage`. Refuses the seeded owner unconditionally ( CLI/core resolution target —
 * disabling it would strand the CLI-only management plane) and refuses any disable that would drop
 * the workspace's active owner-`*` count to zero — both checked, and the status update
 * performed inside one identity transaction. Asynchronous repository calls yield even in a
 * single-event-loop composition, so the transaction port must serialize competing owner/status
 * writes for the whole workspace rather than rely on "atomic by construction" reasoning.
 *
 * `input.seededOwnerPrincipalId` is the caller's job to resolve (`await deps.ownerPrincipalId` at
 * the route layer, mirroring `identityReady`'s existing await-before-use convention) — this
 * function takes the already-resolved id so it stays a plain, directly-testable function.
 *
 * @complexity O(n) in the workspace's principal count (one `list` call to count active owner-`*`
 * holders) — bounded by the same operator-managed-roster assumption `identity/INFO.md` already
 * makes for `PrincipalRepoPort.list`.
 * @overallScore 100
 * See docs/decisions/DR-002-grant-authority-and-admin-safety.md.
 */
export async function disablePrincipal(required: {
  deps: AuthServiceDeps;
  input: { workspaceId: UUID; callerPrincipalId: UUID; principalId: UUID; seededOwnerPrincipalId: UUID };
}): Promise<{ principal: PrincipalRecord }> {
  const { deps, input } = required;

  return inIdentityTransaction({
    transactions: deps.repos.transactions,
    workspaceId: input.workspaceId,
    execute: async () => {
      await assertCallerHasAnyPermission({
        deps,
        workspaceId: input.workspaceId,
        callerPrincipalId: input.callerPrincipalId,
        permissions: ["user.manage"],
      });

      const target = await deps.repos.principals.findById({ workspaceId: input.workspaceId, id: input.principalId });
      if (!target) throw new IdentityNotFoundError({ message: `principal '${input.principalId}' was not found` });

      if (target.id === input.seededOwnerPrincipalId) {
        // See docs/decisions/DR-002-grant-authority-and-admin-safety.md for the invariant behind this refusal; keep external identifiers out of caller-facing messages.
        throw new OwnerRequiredError({ message: "the seeded owner principal can never be disabled" });
      }

      await assertOwnerTargetMayBeModified({
        deps,
        workspaceId: input.workspaceId,
        callerPrincipalId: input.callerPrincipalId,
        principalId: input.principalId,
      });

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
          // See docs/decisions/DR-002-grant-authority-and-admin-safety.md for the invariant behind this refusal; keep external identifiers out of caller-facing messages.
          throw new OwnerRequiredError({ message: "the workspace must keep at least one active owner-`*` principal" });
        }
      }

      const disabled: PrincipalRecord = { ...target, status: "disabled", disabledAt: kernelNowIso({ clock: deps.clock }) };
      await deps.repos.principals.save(disabled);
      return { principal: disabled };
    },
  });
}

/**
 * `ENABLE_PRINCIPAL` (feature.spec.md ). Gated by `user.manage`. Target must be
 * `kind='user'` — a `system`/`api_key` target is rejected `VALIDATION_ERROR` (mirrors 
 * human-only scoping; re-activating the disabled legacy `user-local` stub or an api_key principal
 * outside `ISSUE_API_KEY`'s own lifecycle is never a valid call). Already-active is idempotent
 * (mirrors `disablePrincipal`'s own already-disabled no-op above).
 *
 * @complexity O(1) — one lookup, one save.
 * @overallScore 100
 * See docs/decisions/DR-002-grant-authority-and-admin-safety.md.
 */
export async function enablePrincipal(required: {
  deps: AuthServiceDeps;
  input: { workspaceId: UUID; callerPrincipalId: UUID; principalId: UUID };
}): Promise<{ principal: PrincipalRecord }> {
  const { deps, input } = required;

  return inIdentityTransaction({
    transactions: deps.repos.transactions,
    workspaceId: input.workspaceId,
    execute: async () => {
      await assertCallerHasAnyPermission({
        deps,
        workspaceId: input.workspaceId,
        callerPrincipalId: input.callerPrincipalId,
        permissions: ["user.manage"],
      });

      const target = await deps.repos.principals.findById({ workspaceId: input.workspaceId, id: input.principalId });
      if (!target) throw new IdentityNotFoundError({ message: `principal '${input.principalId}' was not found` });

      if (target.kind !== "user") {
        throw new IdentityValidationError({ message: `ENABLE_PRINCIPAL target must be a human (kind='user') principal, got kind='${target.kind}'` });
      }

      await assertOwnerTargetMayBeModified({
        deps,
        workspaceId: input.workspaceId,
        callerPrincipalId: input.callerPrincipalId,
        principalId: input.principalId,
      });

      if (target.status === "active") {
        return { principal: target };
      }

      const enabled: PrincipalRecord = { ...target, status: "active", disabledAt: undefined };
      await deps.repos.principals.save(enabled);
      return { principal: enabled };
    },
  });
}

/**
 * `UPDATE_USER` (feature.spec.md ). Gated by `user.manage`; existing self-profile edits also
 * accept `member.manage`. Only owners may edit owner targets — `email` only; `username`/`password` are not
 * this transition's concern ( respectively). An absent or empty-string `email`
 * clears the stored value to `undefined` ( — no distinct "blank but present" state).
 *
 * @complexity O(1) — one lookup, one save.
 * @overallScore 100
 * See docs/decisions/DR-002-grant-authority-and-admin-safety.md.
 */
export async function updateUser(required: {
  deps: AuthServiceDeps;
  input: { workspaceId: UUID; callerPrincipalId: UUID; principalId: UUID; };
}, optional: { email?: string | undefined } = {}): Promise<{ user: UserRecord }> {
  const { deps } = required;
  const input = { ...required.input, ...optional };

  return inIdentityTransaction({
    transactions: deps.repos.transactions,
    workspaceId: input.workspaceId,
    execute: async () => {
      await assertCallerHasAnyPermission({
        deps,
        workspaceId: input.workspaceId,
        callerPrincipalId: input.callerPrincipalId,
        // Preserve existing self-profile access without letting member.manage edit other operators.
        permissions: input.callerPrincipalId === input.principalId
          ? ["user.manage", "member.manage"]
          : ["user.manage"],
      });

      const target = await deps.repos.users.findByPrincipalId({
        workspaceId: input.workspaceId,
        principalId: input.principalId,
      });
      if (!target) throw new IdentityNotFoundError({ message: `user '${input.principalId}' was not found` });

      await assertOwnerTargetMayBeModified({
        deps,
        workspaceId: input.workspaceId,
        callerPrincipalId: input.callerPrincipalId,
        principalId: input.principalId,
      });

      const updated: UserRecord = { ...target, email: input.email ? input.email : undefined };
      await deps.repos.users.save(updated);
      return { user: updated };
    },
  });
}

/**
 * `RESET_USER_PASSWORD` (feature.spec.md ). Gated by **`user.manage`** only
 * (resetting a credential is at least as sensitive as disabling the account, own reasoning). Hashes the new password identically to `CREATE_USER` (argon2id,
 * ), then revokes every one of the target's active sessions (idempotent no-op if it has none,
 * ) — a reset that left old sessions alive would not actually contain a compromised account.
 *
 * Refuses a THIRD PARTY resetting the seeded owner's password ( reasoning, same
 * `OwnerRequiredError` `disablePrincipal` uses): `user.manage` is independently grantable and not
 * owner-exclusive (`permissions.ts` — "Create/disable operator users and principals"), so without
 * this check a caller holding only that one delegated permission could set a password of their own
 * choosing on the seeded owner's account and log in as owner — a full takeover from a routine
 * delegation. Checked before the password-policy validation so the refusal doesn't depend on the
 * caller supplying a well-formed password first.
 *
 * Deliberately NOT unconditional the way `disablePrincipal`'s owner check is: the owner resetting
 * ITS OWN password (`callerPrincipalId === principalId === seededOwnerPrincipalId`) is refused
 * nothing — that self-service path is real, shipped infrastructure
 * (`reset-admin-password-self-verified.ts`, driven by both the `HOST_ADMIN_RESET_PASSWORD`
 * boot-time incident-recovery hook and the `backfill-reset-admin-password.ts` CLI script), added
 * specifically to let an operator recover a locked-out owner account out-of-band. Disabling has no
 * legitimate self-case (an owner disabling itself only ever stands the workspace down), so
 * `disablePrincipal` can refuse unconditionally; a credential rotation the owner performs on itself
 * is ordinary hygiene and the documented recovery path, so only a MISMATCHED caller — the actual
 * escalation shape — is refused here.
 *
 * Deliberately NOT -clamped (unlike `disablePrincipal`'s second guard): a reset changes a
 * credential, it never changes `status`, so it can never drop the workspace's active owner-`*`
 * count — headcount guard has nothing to protect here.
 *
 * `input.seededOwnerPrincipalId` is the caller's job to resolve (`await deps.ownerPrincipalId` at
 * the route layer, mirroring `disablePrincipal`'s own contract above) — this function takes the
 * already-resolved id so it stays a plain, directly-testable function.
 *
 * @complexity O(s) in the target's session count, s = active session rows to revoke — bounded by
 * the same operator-managed-roster scale assumption every other identity list call here makes.
 * @overallScore 100
 * See docs/decisions/DR-002-grant-authority-and-admin-safety.md.
 */
export async function resetUserPassword(required: {
  deps: AuthServiceDeps;
  input: { workspaceId: UUID; callerPrincipalId: UUID; principalId: UUID; password: string; seededOwnerPrincipalId: UUID };
}): Promise<{ user: UserRecord }> {
  const { deps, input } = required;

  return inIdentityTransaction({
    transactions: deps.repos.transactions,
    workspaceId: input.workspaceId,
    execute: async () => {
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
      if (!target) throw new IdentityNotFoundError({ message: `user '${input.principalId}' was not found` });

      if (target.principalId === input.seededOwnerPrincipalId && input.callerPrincipalId !== input.seededOwnerPrincipalId) {
        // See docs/decisions/DR-002-grant-authority-and-admin-safety.md for the invariant behind this refusal; keep external identifiers out of caller-facing messages.
        throw new OwnerRequiredError({ message: "the seeded owner's password can only be reset by the owner itself, never by another caller" });
      }

      await assertOwnerTargetMayBeModified({
        deps,
        workspaceId: input.workspaceId,
        callerPrincipalId: input.callerPrincipalId,
        principalId: input.principalId,
      });

      if (!input.password) {
        throw new IdentityValidationError({ message: "password is required" });
      }
      // Same presence-and-upper-bound-only policy `createUser` applies (no minimum length). Both
      // write paths must enforce it or neither does: a reset that accepted an empty password would be
      // a strictly easier way to reach the state the create-side check exists to prevent. Never
      // reaches `seed.ts`'s owner password or the login path — see `password-policy.ts`'s header for
      // why.
      const passwordError = validatePasswordPolicy({ password: input.password });
      if (passwordError) {
        throw new IdentityValidationError({ message: passwordError });
      }

      const passwordHash = await deps.hasher.hash({ password: input.password });
      const updated: UserRecord = { ...target, passwordHash };
      await deps.repos.users.save(updated);

      const sessions = await deps.repos.sessions.listByPrincipalId({
        workspaceId: input.workspaceId,
        principalId: input.principalId,
      });
      const nowIso = kernelNowIso({ clock: deps.clock });
      await Promise.all(
        sessions
          .filter((session) => !session.revokedAt)
          .map((session) => deps.repos.sessions.revoke({ workspaceId: input.workspaceId, id: session.id, revokedAt: nowIso }))
      );

      return { user: updated };
    },
  });
}

/**
 * `UPDATE_ROLE` (feature.spec.md ). Gated by `role.manage`. A built-in target is
 * refused `VALIDATION_ERROR` — extends existing undeletable/immutable/un-attachable-to
 * rule to also cover un-renameable (same escalation shape: relabeling `viewer` to read as trusted
 * is a social-engineering variant of what already blocks structurally).
 *
 * @complexity O(1) — one lookup, one save.
 * @overallScore 100
 * See docs/decisions/DR-002-grant-authority-and-admin-safety.md.
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
  if (!target) throw new IdentityNotFoundError({ message: `role '${input.roleId}' was not found` });
  if (target.isBuiltin) {
    // See docs/decisions/DR-002-grant-authority-and-admin-safety.md for the invariant behind this refusal; keep external identifiers out of caller-facing messages.
    throw new IdentityValidationError({ message: "a built-in role cannot be renamed" });
  }

  const name = (input.name ?? "").trim();
  if (!name) throw new IdentityValidationError({ message: "role name is required" });

  const updated: RoleRecord = { ...target, name };
  await deps.repos.roles.save(updated);
  return { role: updated };
}

/**
 * `UPDATE_POLICY` (feature.spec.md ). Gated by `role.manage`. A built-in or
 * `is_frozen` target is refused `VALIDATION_ERROR` — the frozen-policy half mirrors
 * `WRITE_POLICY_PERMISSION`'s existing refusal : an issuance snapshot's identity is as
 * immutable as its permission set. At least one of `name`/`description` must be present.
 *
 * @complexity O(1) — one lookup, one save.
 * @overallScore 100
 * See docs/decisions/DR-002-grant-authority-and-admin-safety.md.
 */
export async function updatePolicy(required: {
  deps: AuthServiceDeps;
  input: { workspaceId: UUID; callerPrincipalId: UUID; policyId: UUID; };
}, optional: { name?: string | undefined; description?: string | undefined } = {}): Promise<{ policy: PolicyRecord }> {
  const { deps } = required;
  const input = { ...required.input, ...optional };

  await assertCallerHasAnyPermission({
    deps,
    workspaceId: input.workspaceId,
    callerPrincipalId: input.callerPrincipalId,
    permissions: ["role.manage"],
  });

  const target = await deps.repos.policies.findById({ workspaceId: input.workspaceId, id: input.policyId });
  if (!target) throw new IdentityNotFoundError({ message: `policy '${input.policyId}' was not found` });
  if (target.isBuiltin || target.isFrozen) {
    // See docs/decisions/DR-002-grant-authority-and-admin-safety.md for the invariant behind this refusal; keep external identifiers out of caller-facing messages.
    throw new IdentityValidationError({ message: "a built-in or frozen policy cannot be renamed/re-described" });
  }

  if (input.name === undefined && input.description === undefined) {
    throw new IdentityValidationError({ message: "at least one of name or description is required" });
  }

  const name = input.name !== undefined ? input.name.trim() : target.name;
  if (!name) throw new IdentityValidationError({ message: "policy name is required" });

  const updated: PolicyRecord = {
    ...target,
    name,
    description: input.description !== undefined ? input.description : target.description,
  };
  await deps.repos.policies.save(updated);
  return { policy: updated };
}

/**
 * `DELETE_ROLE` (feature.spec.md ). Gated by `role.manage`. A built-in
 * target is refused `VALIDATION_ERROR` (checked before the reference count, matching 
 * stated precedence). A still-referenced target (≥1 `principal_roles` row) is refused
 * `IdentityConflictError` (409 `RESOURCE_CONFLICT`) — the reference check and the delete happen in
 * one identity transaction ( atomicity, same isolation requirement as
 * `disablePrincipal`'s owner-count guard above). Concurrent grant writers use the same port so
 * no assignment can appear between the reference check and deletion.
 *
 * @complexity O(a) in the role's assignment count (`principalRoles.listByRoleId`) — bounded by the
 * same operator-managed-roster assumption every other identity list call makes.
 * @overallScore 100
 * See docs/decisions/DR-002-grant-authority-and-admin-safety.md.
 */
export async function deleteRole(required: {
  deps: AuthServiceDeps;
  input: { workspaceId: UUID; callerPrincipalId: UUID; roleId: UUID };
}): Promise<void> {
  const { deps, input } = required;

  return inIdentityTransaction({
    transactions: deps.repos.transactions,
    workspaceId: input.workspaceId,
    execute: async () => {
      await assertCallerHasAnyPermission({
        deps,
        workspaceId: input.workspaceId,
        callerPrincipalId: input.callerPrincipalId,
        permissions: ["role.manage"],
      });

      const target = await deps.repos.roles.findById({ workspaceId: input.workspaceId, id: input.roleId });
      if (!target) throw new IdentityNotFoundError({ message: `role '${input.roleId}' was not found` });
      if (target.isBuiltin) {
        // See docs/decisions/DR-002-grant-authority-and-admin-safety.md for the invariant behind this refusal; keep external identifiers out of caller-facing messages.
        throw new IdentityValidationError({ message: "a built-in role cannot be deleted" });
      }

      const assignments = await deps.repos.principalRoles.listByRoleId({
        workspaceId: input.workspaceId,
        roleId: input.roleId,
      });
      if (assignments.length > 0) {
        // See docs/decisions/DR-002-grant-authority-and-admin-safety.md for the invariant behind this refusal; keep external identifiers out of caller-facing messages.
        throw new IdentityConflictError({ message: `role '${input.roleId}' is still assigned to ${assignments.length} principal(s)` });
      }

      await deps.repos.roles.delete({ workspaceId: input.workspaceId, id: input.roleId });
    },
  });
}

/**
 * `DELETE_POLICY` (feature.spec.md ). Gated by `role.manage`. A
 * built-in or `is_frozen` target is refused `VALIDATION_ERROR` (checked before the reference
 * count). A still-referenced target (≥1 `role_policies` or `principal_policies` row) is refused
 * `IdentityConflictError`. On success, cascades to the policy's OWN `policy_permissions` rows only
 * (never a different policy's) before deleting the policy row itself. Both deletes and the
 * reference guard share one transaction; failure rolls back the permission cascade.
 *
 * @complexity O(r + p) — role-reference count + principal-reference count, both bounded by the same
 * operator-managed-roster assumption every other identity list call makes.
 * @overallScore 100
 * See docs/decisions/DR-002-grant-authority-and-admin-safety.md.
 */
export async function deletePolicy(required: {
  deps: AuthServiceDeps;
  input: { workspaceId: UUID; callerPrincipalId: UUID; policyId: UUID };
}): Promise<void> {
  const { deps, input } = required;

  return inIdentityTransaction({
    transactions: deps.repos.transactions,
    workspaceId: input.workspaceId,
    execute: async () => {
      await assertCallerHasAnyPermission({
        deps,
        workspaceId: input.workspaceId,
        callerPrincipalId: input.callerPrincipalId,
        permissions: ["role.manage"],
      });

      const target = await deps.repos.policies.findById({ workspaceId: input.workspaceId, id: input.policyId });
      if (!target) throw new IdentityNotFoundError({ message: `policy '${input.policyId}' was not found` });
      if (target.isBuiltin || target.isFrozen) {
        // See docs/decisions/DR-002-grant-authority-and-admin-safety.md for the invariant behind this refusal; keep external identifiers out of caller-facing messages.
        throw new IdentityValidationError({ message: "a built-in or frozen policy cannot be deleted" });
      }

      const [roleRefs, principalRefs] = await Promise.all([
        deps.repos.rolePolicies.listByPolicyId({ workspaceId: input.workspaceId, policyId: input.policyId }),
        deps.repos.principalPolicies.listByPolicyId({ workspaceId: input.workspaceId, policyId: input.policyId }),
      ]);
      const referenceCount = roleRefs.length + principalRefs.length;
      if (referenceCount > 0) {
        // See docs/decisions/DR-002-grant-authority-and-admin-safety.md for the invariant behind this refusal; keep external identifiers out of caller-facing messages.
        throw new IdentityConflictError({ message: `policy '${input.policyId}' is still referenced by ${referenceCount} row(s)` });
      }

      await deps.repos.policyPermissions.deleteByPolicyId({ workspaceId: input.workspaceId, policyId: input.policyId });
      await deps.repos.policies.delete({ workspaceId: input.workspaceId, id: input.policyId });
    },
  });
}

/**
 * `WRITE_POLICY_PERMISSION` (feature.spec.md, state.spec §3). First HTTP
 * implementation of a transition specified since v0.5.3 ( — this is a route, not a
 * re-specification). Gated by `role.manage`. Refuses an unregistered permission
 * (`PermissionUnknownError`), a built-in or `is_frozen` parent policy, and
 * (via the shared `assertGrantClamp`) a permission the caller does not itself hold unconstrained
 * (`GrantExceedsIssuerError`).
 *
 * @complexity O(assertGrantClamp) — see that function's own doc (resolveEffectivePermissions +
 * O(1) local filtering, one permission).
 * @overallScore 100
 * See docs/decisions/DR-002-grant-authority-and-admin-safety.md.
 */
export async function writePolicyPermission(required: {
  deps: AuthServiceDeps;
  input: {
    workspaceId: UUID;
    callerPrincipalId: UUID;
    policyId: UUID;
    permission: string;
  };
}, optional: { resourceType?: string | null; constraintJson?: string | null } = {}): Promise<{ policyPermission: PolicyPermissionRecord }> {
  const { deps } = required;
  const input = { ...required.input, ...optional };

  return inIdentityTransaction({
    transactions: deps.repos.transactions,
    workspaceId: input.workspaceId,
    execute: async () => {
      await assertCallerHasAnyPermission({
        deps,
        workspaceId: input.workspaceId,
        callerPrincipalId: input.callerPrincipalId,
        permissions: ["role.manage"],
      });

      if (!isKnownPermission({ id: input.permission })) {
        throw new PermissionUnknownError({ message: `permission '${input.permission}' is not in the registered catalog` });
      }

      const policy = await deps.repos.policies.findById({ workspaceId: input.workspaceId, id: input.policyId });
      if (!policy) throw new IdentityNotFoundError({ message: `policy '${input.policyId}' was not found` });
      if (policy.isBuiltin || policy.isFrozen) {
        // See docs/decisions/DR-002-grant-authority-and-admin-safety.md for the invariant behind this refusal; keep external identifiers out of caller-facing messages.
        throw new IdentityValidationError({ message: "cannot write a permission onto a built-in or frozen policy" });
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
    },
  });
}

/**
 * `REMOVE_POLICY_PERMISSION` — the inverse of {@link writePolicyPermission}, and the
 * transition whose absence made a policy's permission set append-only: the only way to shrink one
 * was `deletePolicy` + recreate, which blocks outright the moment anything references the
 * policy.
 *
 * Gated by `role.manage`, the same permission `writePolicyPermission` and `deletePolicy` require.
 * Deliberately NOT clamped by `assertGrantClamp` : the clamp exists to stop a caller
 * conferring authority it does not itself hold, and removal confers nothing — it is a strict
 * de-escalation. Requiring the clamp here would mean an admin who cannot grant `content.write`
 * also cannot take it back, which is the wrong direction for a safety rule. This is strictly less
 * powerful than the already-unclamped `deletePolicy`, which drops EVERY permission row the policy
 * has.
 *
 * Refuses a built-in or `is_frozen` parent policy, checked BEFORE the row lookup so
 * a frozen policy reports why it is frozen rather than leaking whether the row exists. A row that
 * is absent — or that exists but belongs to a DIFFERENT policy — is one and the same
 * `IdentityNotFoundError`: membership is proven from `listByPolicyId`'s result, so a caller can
 * never delete across a policy boundary by guessing an id.
 *
 * @complexity O(n) in the policy's own permission-row count (one `listByPolicyId`) — bounded by the
 * same operator-managed-roster assumption every other identity list call makes.
 * See docs/decisions/DR-002-grant-authority-and-admin-safety.md.
 */
export async function removePolicyPermission(required: {
  deps: AuthServiceDeps;
  input: { workspaceId: UUID; callerPrincipalId: UUID; policyId: UUID; policyPermissionId: UUID };
}): Promise<void> {
  const { deps, input } = required;

  return inIdentityTransaction({
    transactions: deps.repos.transactions,
    workspaceId: input.workspaceId,
    execute: async () => {
      await assertCallerHasAnyPermission({
        deps,
        workspaceId: input.workspaceId,
        callerPrincipalId: input.callerPrincipalId,
        permissions: ["role.manage"],
      });

      const policy = await deps.repos.policies.findById({ workspaceId: input.workspaceId, id: input.policyId });
      if (!policy) throw new IdentityNotFoundError({ message: `policy '${input.policyId}' was not found` });
      if (policy.isBuiltin || policy.isFrozen) {
        // See docs/decisions/DR-002-grant-authority-and-admin-safety.md for the invariant behind this refusal; keep external identifiers out of caller-facing messages.
        throw new IdentityValidationError({ message: "cannot remove a permission from a built-in or frozen policy" });
      }

      const rows = await deps.repos.policyPermissions.listByPolicyId({
        workspaceId: input.workspaceId,
        policyId: input.policyId,
      });
      const target = rows.find((row) => row.id === input.policyPermissionId);
      if (!target) {
        throw new IdentityNotFoundError({ message: `policy permission '${input.policyPermissionId}' was not found on policy '${input.policyId}'` });
      }

      await deps.repos.policyPermissions.delete({ workspaceId: input.workspaceId, id: target.id });
    },
  });
}

/**
 * Count `active` principals in `workspaceId` that hold the owner wildcard `*` ( own
 * definition of "owner-`*` principal"). O(n) in the workspace's principal count, n bounded by the
 * same operator-managed-roster assumption `identity/INFO.md` documents.
 * See docs/decisions/DR-002-grant-authority-and-admin-safety.md.
 */
async function countActiveOwnerWildcardPrincipals(required: {
  deps: AuthServiceDeps;
  workspaceId: UUID;
}): Promise<number> {
  const { deps, workspaceId } = required;
  const principals = await deps.repos.principals.list({ workspaceId });
  // A kind barred from operator permissions (a site `member`) can never act as an owner, so it is
  // not counted even if a `*` row reaches it — and members never cost a grant read here.
  const activePrincipals = principals.filter(
    (principal) =>
      principal.status === "active" && principalKindMayExercisePermission({ kind: principal.kind, permission: "*" })
  );
  const flags = await Promise.all(
    activePrincipals.map((principal) =>
      principalHoldsOwnerWildcard({ deps, workspaceId, principalId: principal.id })
    )
  );
  return flags.filter(Boolean).length;
}
