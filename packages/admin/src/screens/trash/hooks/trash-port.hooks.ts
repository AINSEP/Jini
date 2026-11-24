import type { AdminIdentityUser } from "@jini-ai/core/contracts/site/user-management-react";
import type { AdminTrashPageDto, AdminTrashPurgeReportDto, AdminTrashRestoreReportDto } from "@jini-ai/core/contracts/site/cms-trash";

/**
 * @file What `use-trash.hooks.ts` needs from the outside world, as an interface rather than a
 * direct `lib/api` import. Follows the `useX(dependencies)` / `useWiredX()` pair documented in
 * `development/docs/architecture/wired-hooks-convention.md`.
 */
export interface TrashPort {
  listTrash(options: { cursor?: string }): Promise<AdminTrashPageDto>;
  restoreTrashItems(input: { items: { entityType: string; entityId: string }[] }): Promise<AdminTrashRestoreReportDto>;
  purgeTrashItems(input: { ids: string[] }): Promise<AdminTrashPurgeReportDto>;
  /**
   * The workspace's user roster, for `rules.ts`'s `actorLabel` to resolve `actorPrincipalId` against
   * client-side when a row's `actorUsername` is absent (an older server — see `actorLabel`'s doc).
   * Optional, deliberately: this is the SAME endpoint the Users screen calls, gated server-side by
   * `user.manage`/`member.manage` (`routes/users/list.ts`), which not every operator who can view the
   * Trash necessarily holds — `use-trash.hooks.ts` treats a missing method or a failed call the same
   * way, as "no client-side resolution available", never as a Trash-screen error. Also optional so
   * the many hand-rolled `TrashPort` literals already in this feature's tests do not all need to grow
   * a method they never exercise.
   */
  listUsers?(): Promise<{ users: AdminIdentityUser[] }>;
}
