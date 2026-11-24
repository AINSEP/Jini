import { expect, test } from "vitest";

import { FS_FILES_CUSTOM_ROOT_MANAGE_PERMISSION, registerFsFilesCustomRootPermissionGrants } from "../custom-root-permission.js";

/** Pins the grant a composition root reconciles: the built-in admin role, the manage permission. */
test("registers exactly one built-in admin grant for the custom-root manage permission", () => {
  const grants: { role: string; permission: string; reason: string }[] = [];
  registerFsFilesCustomRootPermissionGrants({ registry: { roleGrants: { register: grant => { grants.push(grant); } } } });
  expect(grants).toHaveLength(1);
  expect(grants[0]).toMatchObject({ role: "admin", permission: "fs_files.custom_root.manage" });
  expect(grants[0]!.reason).toContain("Owner ruling 2026-09-15");
});

test("the permission string is the one the route gate and its 403 body share", () => {
  expect(FS_FILES_CUSTOM_ROOT_MANAGE_PERMISSION).toBe("fs_files.custom_root.manage");
});
