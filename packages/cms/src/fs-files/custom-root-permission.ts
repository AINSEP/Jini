/** The slice of the host's permission-grant registry this module writes to: the built-in-role grants. */
export interface FsFilesPermissionGrantRegistry {
  readonly roleGrants: { register(grant: { role: string; permission: string; reason: string }): void };
}

/**
 * @file The `fs_files.custom_root.manage` permission, and the grant that makes it real — gates
 * CHANGING the `fs-files` domain's `custom` root (`PUT`/`DELETE` on
 * the host's custom-root admin route). Reading which folder is currently set stays on
 * `FS_FILES_READ_PERMISSION`, unchanged.
 *
 * ## Why changing it is a different capability from reading through it
 *
 * `content.read` gates `fs_list_files`/`fs_read_file`, i.e. reading files under a root someone else
 * chose. Setting the custom root is the decision of WHICH host directory those tools may reach:
 * The fs-files layout module allows `/` and a home directory as values, so one `PUT` can re-point the assistant's
 * whole filesystem surface at the operator's entire machine. The denylist in the fs-files reader module still
 * applies afterwards, but "which tree is in scope at all" is an operator decision, not a reader's.
 * Owner ruling (2026-09-15): owner AND admin may change it; reading stays where it was.
 *
 * ## Why a new string, and why NOT `workspace.manage`
 *
 * `workspace.manage` reads like the obvious fit and is the one string that must not be used here:
 * it is held by NO policy in the workspace this repo actually ships. the shipping site's `content.db`
 * `admin-builtin-policy` carries 43 permissions and `workspace.manage` is not among them —
 * the host's pages-permission module documents that exact database as seeded before `theme.edit`,
 * `workspace.manage`, and `admin.assistant.manage` joined the admin seed list, and `seedIdentity`
 * early-returns once an owner user exists, so it can never gain them. Gating on it would pass every
 * unit test that stubs `authorize` and still refuse every admin in production, leaving `owner` (on
 * its `*` wildcard) as the only principal who could change the folder — the opposite of the ruling.
 *
 * ## Why a built-in-role grant, and no migration pair
 *
 * The built-in-role grant writes one row onto the built-in `admin` role's own policy on every
 * boot, additive and idempotent, so it reaches already-seeded workspaces that `seedIdentity` will
 * never revisit. See the host's built-in-role-grant module for the mechanism and
 * its pages-permission module for the full reasoning this mirrors.
 *
 * Unlike those two precedents this file registers NO permission-migration pair. A fan-out
 * grants the new string to every policy already holding some anchor, including operator-created
 * ones; the ruling names owner and admin specifically, so the grant is stated against the role and
 * nothing else. The cost is recorded rather than hidden: a workspace that gave a CUSTOM policy
 * `content.read` could change the custom root before this change and cannot after it. That is the
 * narrowing the ruling asks for, and an operator can still grant this permission to such a policy
 * deliberately.
 *
 * ## Ordering
 *
 * The registration below must run before `applyBuiltinRoleGrants` does. It used to be a
 * module-evaluation side effect that ran first only because
 * {@link FS_FILES_CUSTOM_ROOT_MANAGE_PERMISSION} is imported by
 * the host's custom-root admin route, which the host's app composition imports
 * statically — the same "reached via its own consumer" mechanism
 * the host's site-key permission module relied on. It is now an explicit call:
 * the host's app-permission-grants composition list invokes
 * {@link registerFsFilesCustomRootPermissionGrants} on the registry every composition root passes
 * to identity wiring.
 * The host's custom-root-permission route test pins the
 * resulting grant end-to-end through the real route against a workspace seeded the way the shipping
 * one was, so a regression surfaces as a failing privilege test rather than as a silent lockout.
 */

/**
 * The permission required to CHANGE the `fs-files` custom root (`PUT`/`DELETE`).
 *
 * Named once and imported by the route so the gate and the 403 body cannot drift apart.
 */
export const FS_FILES_CUSTOM_ROOT_MANAGE_PERMISSION = "fs_files.custom_root.manage";

/**
 * Register the custom-root permission's built-in `admin` grant (see this file's header) on
 * `required.registry`.
 *
 * @complexity O(1).
 */
export function registerFsFilesCustomRootPermissionGrants(
  required: { registry: FsFilesPermissionGrantRegistry },
  _optional: Record<string, never> = {}
): void {
  required.registry.roleGrants.register({
    role: "admin",
    permission: FS_FILES_CUSTOM_ROOT_MANAGE_PERMISSION,
    reason:
      "Owner ruling 2026-09-15: owner and admin may change which host directory the assistant's " +
      "filesystem tools are pointed at; reading through the currently-set folder stays on " +
      "content.read. Stated directly against the built-in admin role because this repo's own " +
      "content.db was seeded before several admin permissions existed and seedIdentity early-returns " +
      "once an owner user exists — a grant that depended on a seed row that workspace never got would " +
      "refuse every admin in the only installation that actually ships.",
  });
}
