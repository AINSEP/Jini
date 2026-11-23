import type { PermissionGrantRegistry } from "./permission-grants.js";

/** Owner decision 2026-10-07: builtin admins may manage ordinary users. The target rule in
 * delete-user-service is mandatory at disable/reset/trash/purge boundaries; this grant is not
 * authority over protected admin/owner accounts. Reconciles existing installs without schema work. */
export function registerUserManagePermissionGrants(required: { registry: PermissionGrantRegistry },
  _optional: Record<string, never> = {}): void {
  required.registry.roleGrants.register({ role: "admin", permission: "user.manage",
    reason: "Owner decision 2026-10-07: admins may manage ordinary non-admin users; only owners may delete, trash, disable or reset admin/owner accounts." });
}
