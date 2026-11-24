import { registerPermission } from "../../core/permissions.js";

/** The host's grant registry, as far as this registrar uses it: one built-in-role grant per call. */
type PermissionGrantRegistry = { readonly roleGrants: { register(grant: { readonly role: string; readonly permission: string; readonly reason: string }): void } };

/**
 * @file The Email page's own permissions (email phases 4-5), declared at composition like
 * `features/publish-content/permissions.ts`.
 *
 * - `mail.activity.read`: full recipient details of the send history (addresses, ids, message ids).
 *   The built-in `admin` role holds it, stated against the role so already-seeded workspaces gain
 *   it too (see `features/identity/builtin-role-grants.ts`). Without it, holders of the page's
 *   status permission see the same outcomes with masked recipients.
 * - `mail.suppressions.manage`: removing an address from the do-not-send list. Owner decision
 *   (2026-10-22): owner-only, so it is deliberately granted to NO built-in role; the owner holds it
 *   through the `*` wildcard. Removal is owner only; the grant alone is not enough.
 */

/** Full send-history details (`mail_list_activity`, `mail_get_activity`, `GET system/mail-activity`). */
export const MAIL_ACTIVITY_READ_PERMISSION = "mail.activity.read";

/** Suppression removal (`mail_remove_suppression`, `POST system/mail-suppressions/remove`). */
export const MAIL_SUPPRESSIONS_MANAGE_PERMISSION = "mail.suppressions.manage";

/** The Email page's existing status permission (status, uses, test send). Spelled once here. */
export const MAIL_STATUS_PERMISSION = "admin.forms.manage";

/** The three ids the activity and suppression operations are given by their host, by role. */
export const MAIL_PERMISSION_IDS = {
  activityRead: MAIL_ACTIVITY_READ_PERMISSION,
  status: MAIL_STATUS_PERMISSION,
  suppressionsManage: MAIL_SUPPRESSIONS_MANAGE_PERMISSION,
} as const;

/**
 * Register both catalog entries and the admin grant for `mail.activity.read`.
 * @complexity O(1).
 */
export function registerMailPermissionGrants(required: { registry: PermissionGrantRegistry }, _optional: Record<string, never> = {}): void {
  registerPermission({ id: MAIL_ACTIVITY_READ_PERMISSION, owner: "mail", description: "See who this site emailed and each send's outcome and provider feedback." });
  registerPermission({ id: MAIL_SUPPRESSIONS_MANAGE_PERMISSION, owner: "mail", description: "Remove an address from the do-not-send list (owner only; the grant alone is not enough)." });
  required.registry.roleGrants.register({
    role: "admin",
    permission: MAIL_ACTIVITY_READ_PERMISSION,
    reason:
      "Email page phase 4 (2026-10-22): delegated site administrators diagnose delivery, which needs " +
      "the recipient of each send. Stated against the built-in admin role so already-seeded workspaces " +
      "gain it (seedIdentity early-returns once an owner exists). editor and viewer do not hold it.",
  });
}
