import type { PermissionGrantRegistry } from "./permission-grants.js";

/**
 * @file The built-in `admin` role holds `role.manage` — full Roles & Permissions access (owner
 * decision, 2026-10-05).
 *
 * `@jini-ai/user-management`'s seed used to leave `role.manage` (with `user.manage`) owner-only, so a
 * built-in admin saw no Roles section, its direct URL showed no access, and every roles/policies
 * endpoint refused it. The owner reversed that for `role.manage`: an admin runs Roles & Permissions.
 * `user.manage` is not part of that decision and stays owner-only.
 *
 * Two paths, same shape as `site-key-permission.ts`'s built-in-role grant:
 * - the Jini seed list now includes `role.manage`, so a freshly seeded workspace's admin policy holds it;
 * - the built-in-role grant below reaches every workspace seeded BEFORE that change, because
 *   `seedIdentity` early-returns once an owner user exists and never revisits the admin policy.
 *   `applyBuiltinRoleGrants` (chained off `identityReady` in `wiring.ts`) adds the one row on the
 *   next boot; it is additive and a no-op once the row exists. No migration is involved.
 *
 * `owner` needs neither (its `*` wildcard clears every gate). `editor`/`viewer` get nothing here.
 *
 * Registered explicitly from `server/runtime/composition/app-permission-grants.ts`; importing this
 * module registers nothing.
 */

/** The permission every roles/policies route checks (`routes/users/*-role.ts`, `*-policy*.ts`). */
export const ROLE_MANAGE_PERMISSION = "role.manage";

/**
 * Register the built-in admin role's `role.manage` grant (see this file's header) on
 * `required.registry`.
 *
 * @complexity O(1).
 */
export function registerRoleManagePermissionGrants(
  required: { registry: PermissionGrantRegistry },
  _optional: Record<string, never> = {}
): void {
  required.registry.roleGrants.register({
    role: "admin",
    permission: ROLE_MANAGE_PERMISSION,
    reason:
      "Owner decision 2026-10-05: the built-in admin role has full Roles & Permissions access. " +
      "Stated against the role so workspaces seeded before role.manage joined the admin seed list " +
      "receive it on the next boot (seedIdentity early-returns once an owner user exists).",
  });
}
