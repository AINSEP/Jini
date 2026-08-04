import type { UUID } from "../core/ports.js";
import type {
  PolicyPermissionRepoPort,
  PrincipalPolicyRepoPort,
  PrincipalRepoPort,
  PrincipalRoleRepoPort,
  RolePolicyRepoPort,
} from "./ports.js";
import type { PolicyPermissionRecord } from "./types.js";

/**
 * @file `authorize()` — the RBAC evaluator (REQ-04).
 *
 * Purpose:
 * Ordinary core function, deliberately NOT a port (one evaluator —
 * "no PolicyPort"). The command gateway calls this before every
 * mutation (REQ-05); it is deterministic and side-effect free given the
 * repo snapshot (state.spec §4).
 *
 * How it relates to the project:
 * - `command.ts`'s `executeCommand` calls a bound closure of this shape
 *   (typed there as `AuthorizeFn`, kept generic so `core/commands` never
 *   imports this feature-level library — see that file's header).
 * - Route handlers call it directly for mutations that do not flow through
 *   the command gateway (this pass: `members` disable — see the handoff).
 *
 * Architectural role:
 * Implements the matcher precedence in behavior.spec §1.1 exactly:
 * disabled-principal short-circuit > owner wildcard > exact matching row >
 * fail-closed default. Fail-closed extensibility: a non-null
 * `constraintJson` is never treated as unconstrained, and a `resourceType`
 * mismatch/absence is never treated as a global grant.
 */

/** The context an authorization decision is evaluated against (REQ-04). */
export interface AuthorizeContext {
  workspaceId: UUID;
  entityType?: string;
  entityId?: UUID;
}

/** `authorize()`'s result — always fail-closed on `allowed: false` (INV-03). */
export interface AuthorizeResult {
  allowed: boolean;
  /** Machine-readable reason: `principal_disabled | no_grant | resource_scope_mismatch | unconstrained_deny | owner_wildcard | matched`. */
  reason: string;
}

/** Repos `authorize()`/`resolveEffectivePermissions()` read. Not a port bag with alternate adapters — see file header. */
export interface AuthorizeDeps {
  principals: PrincipalRepoPort;
  principalRoles: PrincipalRoleRepoPort;
  rolePolicies: RolePolicyRepoPort;
  principalPolicies: PrincipalPolicyRepoPort;
  policyPermissions: PolicyPermissionRepoPort;
}

/**
 * Resolve a principal's effective permission rows: the union of (a) its
 * roles' policies' permissions and (b) policies attached directly via
 * `principal_policies` (behavior.spec §1.2). Scoped to `workspaceId` by
 * construction (every repo call below is workspace-scoped).
 *
 * @complexity O(r*p + d) round trips, r = roles held, p = policies per role,
 * d = direct policy attachments — all expected small (a handful of rows per
 * principal). No caller-unbounded collection is walked.
 * @overallScore 100
 */
export async function resolveEffectivePermissions(required: {
  deps: AuthorizeDeps;
  principalId: UUID;
  workspaceId: UUID;
}): Promise<PolicyPermissionRecord[]> {
  const { deps, principalId, workspaceId } = required;

  const roleLinks = await deps.principalRoles.listByPrincipalId({ workspaceId, principalId });
  const rolePermissionGroups = await Promise.all(
    roleLinks.map(async (roleLink) => {
      const rolePolicyLinks = await deps.rolePolicies.listByRoleId({
        workspaceId,
        roleId: roleLink.roleId,
      });
      const policyPermissionGroups = await Promise.all(
        rolePolicyLinks.map((rolePolicyLink) =>
          deps.policyPermissions.listByPolicyId({ workspaceId, policyId: rolePolicyLink.policyId })
        )
      );
      return policyPermissionGroups.flat();
    })
  );

  const directLinks = await deps.principalPolicies.listByPrincipalId({ workspaceId, principalId });
  const directPermissionGroups = await Promise.all(
    directLinks.map((directLink) =>
      deps.policyPermissions.listByPolicyId({ workspaceId, policyId: directLink.policyId })
    )
  );

  return [...rolePermissionGroups.flat(), ...directPermissionGroups.flat()];
}

/**
 * True iff `row` is an exact, unconstrained-or-scope-matching grant of
 * `permission` in `context` (state.spec §4 `matchesRow`). Assumes `row` has
 * already passed the owner-wildcard check upstream — this never special-cases
 * `"*"`.
 */
function matchesRow(row: PolicyPermissionRecord, permission: string, context: AuthorizeContext): boolean {
  if (row.permission !== permission) return false;
  if (row.constraintJson != null) return false;
  if (row.resourceType != null && row.resourceType !== context.entityType) return false;
  return true;
}

/**
 * The RBAC decision (REQ-04). Fail-closed: `allowed` defaults to `false` and
 * only ever flips to `true` on an explicit disabled-short-circuit-cleared,
 * matching row.
 *
 * Precedence (behavior.spec §1.1, highest to lowest):
 * 1. Disabled principal -> `false`, `principal_disabled` (overrides all grants).
 * 2. An unconstrained owner `"*"` row -> `true`, `owner_wildcard`.
 * 3. An exact matching row (permission + workspace + resource-scope + no
 *    constraint) -> `true`, `matched`.
 * 4. Fail-closed default -> `false`, with the most specific diagnostic reason
 *    available among same-permission candidates (`unconstrained_deny` over
 *    `resource_scope_mismatch` over `no_grant` — an inferred, undocumented-but-
 *    reasonable tie-break; the spec only pins each reason in isolation, see
 *    AC-09/AC-14/EC-04).
 *
 * @complexity O(resolveEffectivePermissions) + O(k) local filtering, k = the
 * principal's effective row count (small, bounded by grants a workspace
 * administrator creates by hand).
 * @overallScore 100
 */
export async function authorize(required: {
  deps: AuthorizeDeps;
  principalId: UUID;
  permission: string;
  context: AuthorizeContext;
}): Promise<AuthorizeResult> {
  const { deps, principalId, permission, context } = required;

  const principal = await deps.principals.findById({ workspaceId: context.workspaceId, id: principalId });
  if (!principal || principal.status === "disabled") {
    return { allowed: false, reason: "principal_disabled" };
  }

  const effectiveRows = await resolveEffectivePermissions({
    deps,
    principalId,
    workspaceId: context.workspaceId,
  });

  const hasUnconstrainedWildcard = effectiveRows.some(
    (row) => row.permission === "*" && row.resourceType == null && row.constraintJson == null
  );
  if (hasUnconstrainedWildcard) {
    return { allowed: true, reason: "owner_wildcard" };
  }

  const candidates = effectiveRows.filter((row) => row.permission === permission);
  if (candidates.length === 0) {
    return { allowed: false, reason: "no_grant" };
  }

  const matched = candidates.some((row) => matchesRow(row, permission, context));
  if (matched) {
    return { allowed: true, reason: "matched" };
  }

  if (candidates.some((row) => row.constraintJson != null)) {
    return { allowed: false, reason: "unconstrained_deny" };
  }
  if (candidates.some((row) => row.resourceType != null)) {
    return { allowed: false, reason: "resource_scope_mismatch" };
  }
  return { allowed: false, reason: "no_grant" };
}
