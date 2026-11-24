import type { AuthorizeFn } from "@jini-ai/core/contracts/events";
import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";
import { rejectRoute } from "@jini-ai/core/errors/route-refusal";

import type { IdentityRepos } from "../../../core/ports.js";
import type { PrincipalRecord } from "../../../core/types.js";
import type { AuthServiceDeps } from "../../../server/auth-service.js";
import type { AdminUserResponse } from "../../http/users.js";
import { adminUserWithGrants, userActorId, type IdentityServicesFn, type IsInTrashFn, type UserRoutePrincipal } from "./shared.js";

/** The host's per-account protection flags the users screen shows (owner / protected admin account). */
export interface UserAccountProtection { isOwner: boolean; isProtectedAccount: boolean }

/** The host's account-protection read; it owns which accounts are protected. */
export type UserAccountProtectionFn = (
  required: { deps: AuthServiceDeps; workspaceId: string; principalId: string },
  optional?: Record<string, never>,
) => Promise<UserAccountProtection>;

/** The deps this route reads. */
export interface UserListRouteDeps {
  workspaceId: string;
  /** The host's raw RBAC decision (`{ allowed, reason }`), asked directly: this route's "either of
   *  two permissions" rule and its combined 403 body do not fit the single-permission authorize port. */
  decidePermission: AuthorizeFn;
  identityServices: IdentityServicesFn;
  isInTrash: IsInTrashFn;
  /** The seeded (bootstrap) owner's principal id, resolved by the host at boot. */
  ownerPrincipalId: PromiseLike<string> | string;
  userAccountProtection: UserAccountProtectionFn;
}

/** One listed user: the host's protection flags, the rename affordance, then the admin user fields. */
export type AdminUserListEntry = UserAccountProtection & { canRename: boolean } & AdminUserResponse;

type UserListRepos = Pick<IdentityRepos, "principals" | "users" | "principalRoles" | "principalPolicies">;

/**
 * Gated by `user.manage`/`member.manage` (either) for this read-only roster; operator creation
 * separately requires `user.manage`. No separate `user.read` permission exists in the catalog.
 * 2026-07-16 authz sweep: this route previously had zero permission check beyond session auth,
 * letting any authenticated admin session read the full user roster regardless of role.
 * Both decisions are asked (in parallel, as before); the refusal names `user.manage`'s reason.
 * @complexity O(1) plus two injected decisions.
 */
async function authorizeUserRoster({ deps, principalId }: { deps: UserListRouteDeps; principalId: string }, _optional: Record<string, never> = {}): Promise<void> {
  const [userManage, memberManage] = await Promise.all([
    deps.decidePermission({ principalId, permission: "user.manage", workspaceId: deps.workspaceId }),
    deps.decidePermission({ principalId, permission: "member.manage", workspaceId: deps.workspaceId }),
  ]);
  if (userManage.allowed || memberManage.allowed) return;
  rejectRoute({
    status: 403,
    error: `principal '${principalId}' is not authorized for 'user.manage' or 'member.manage' (${userManage.reason})`,
    code: "FORBIDDEN",
    details: { permission: "user.manage", reason: userManage.reason },
  });
}

/**
 * Non-human principals (`system`, `agent`, `api_key` — including the disabled legacy `user-local`
 * seed row) are filtered out: this screen is "Users" (human operators), not the full roster.
 * @complexity O(n) Trash lookups, n = principal count.
 */
async function listedHumanPrincipals({ deps, repos }: { deps: UserListRouteDeps; repos: UserListRepos }, _optional: Record<string, never> = {}): Promise<PrincipalRecord[]> {
  const principals = await repos.principals.list({ workspaceId: deps.workspaceId });
  const entries = await Promise.all(
    principals
      .filter((principal) => principal.kind === "user")
      .map(async (principal) => ({
        principal,
        // OWNER DECISION 2026-09-24 (delete-user plan v2, decision 7's list side): a user
        // trashed via DELETE_USER is `status:'disabled'` plus a `trashed_items` row — this
        // screen must not list them as an ordinary disabled user, since restoring them here
        // means EnablePrincipal, not the Trash's own restore. An intentionally-disabled user
        // (never trashed) has no `trashed_items` row and stays listed.
        trashed: principal.status === "disabled" && (await deps.isInTrash({ principalId: principal.id })),
      })),
  );
  return entries.filter((entry) => !entry.trashed).map((entry) => entry.principal);
}

/** One roster row, or `null` for a principal without its paired users row. @complexity O(1) plus four reads. */
async function listEntry(
  { deps, services, principal, seededOwnerPrincipalId }: { deps: UserListRouteDeps; services: AuthServiceDeps; principal: PrincipalRecord; seededOwnerPrincipalId: string },
  _optional: Record<string, never> = {},
): Promise<AdminUserListEntry | null> {
  const user = await services.repos.users.findByPrincipalId({ workspaceId: deps.workspaceId, principalId: principal.id });
  // Every kind='user' principal has a paired users row by construction
  // (CREATE_USER/SEED_FIRST_BOOT's atomicity guarantee) — this null
  // check is defensive, not an expected runtime path.
  if (!user) return null;
  const response = await adminUserWithGrants({ repos: services.repos, workspaceId: deps.workspaceId, principal, user });
  const protection = await deps.userAccountProtection({ deps: deps.identityServices(), workspaceId: deps.workspaceId, principalId: principal.id });
  // The bootstrap owner is still found by login at reboot; offer rename only when safe.
  return { ...protection, canRename: principal.id !== seededOwnerPrincipalId, ...response };
}

/**
 * GET users — list a workspace's human (`kind='user'`) principals for the admin UI. No dedicated
 * `listUsers` business-logic function exists in this package's server services (they export
 * grant-writing mutations, not read-side wrappers) — this route calls the repo ports directly.
 */
export const userListRoute = defineJsonRoute<Record<string, never>, { users: AdminUserListEntry[] }, UserListRouteDeps, UserRoutePrincipal>({
  method: "get",
  path: "/api/admin/v1/workspaces/:workspaceId/users",
  parse: () => ok({ value: {} }),
  handle: async ({ deps, context }) => {
    await authorizeUserRoster({ deps, principalId: userActorId({ context }) });
    const services = deps.identityServices();
    const principals = await listedHumanPrincipals({ deps, repos: services.repos });
    const seededOwnerPrincipalId = await deps.ownerPrincipalId;
    // O(n) repo round trips, n = human principal count. Unbounded by a caller-controlled
    // collection (this is an operator-managed roster, not member/content scale — the same
    // assumption `resolveEffectivePermissions` already makes) — no cap needed this pass; a future
    // pagination pass would mirror `MemberRepoPort.list`'s afterId/limit shape if this workspace's
    // operator count ever grows unexpectedly large.
    const users = await Promise.all(principals.map((principal) => listEntry({ deps, services, principal, seededOwnerPrincipalId })));
    return ok({ value: { users: users.filter((user): user is AdminUserListEntry => user !== null) } });
  },
});
