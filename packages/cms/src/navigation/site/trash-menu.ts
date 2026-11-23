import { MenuConflictError, MenuNotFoundError } from "../index.js";
import type { MenuRepoPort } from "../index.js";

/**
 * @file Menu-flavored move-to-trash entry point (T5, plan §2). Precedent:
 * `Jini packages/cms/src/forms/delete-submission.ts` — same read-then-`remove` shape, retargeted at
 * `MenuRepoPort`. `remove` is an injected structural type (`RemoveMenuFn`), bound at the
 * composition root to the generic trash pipeline's `removeEntityWithoutBlocker` helper — this
 * module imports nothing from the host's trash feature.
 */

/**
 * Structural shape of the generic trash pipeline's remove step, as seen from the menu domain.
 * Bound at composition to `removeEntityWithoutBlocker` (menu's registry entry declares no
 * `blocker`, unlike `term`).
 */
export type RemoveMenuFn = (required: {
  workspaceId: string;
  id: string;
  display: { title: string; subtitle?: string | null };
  at: string;
  expectedVersion: number | null;
  actor: { principalId: string; pluginId?: string | null };
}) => Promise<
  { ok: true; version: number | null } | { ok: false; reason: "not-found" | "version-changed" }
>;

export interface TrashMenuInput {
  workspaceId: string;
  menuId: string;
  actor: { principalId: string; pluginId?: string | null };
}

export interface TrashMenuDeps {
  menuRepo: MenuRepoPort;
  remove: RemoveMenuFn;
  clock: { nowIso(): string };
}

/**
 * Moves a menu to the Trash.
 * @throws MenuNotFoundError when the menu is missing or already trashed (`findById` already hides
 *         a trashed row, so this one branch covers both cases).
 * @throws MenuConflictError (409-shaped) when the row changed between the read and the move.
 * @complexity O(1): one read, one `remove` call.
 */
export async function trashMenu(required: TrashMenuInput, deps: TrashMenuDeps): Promise<{ id: string; version: number | null }> {
  const existing = await deps.menuRepo.findById({ workspaceId: required.workspaceId, id: required.menuId });
  if (!existing) throw new MenuNotFoundError({ message: `menu '${required.menuId}' was not found` });

  const removed = await deps.remove({
    workspaceId: required.workspaceId,
    id: existing.id,
    display: { title: existing.title, subtitle: existing.slug },
    at: deps.clock.nowIso(),
    expectedVersion: existing.version,
    actor: required.actor,
  });
  if (removed.ok) return { id: existing.id, version: removed.version };
  if (removed.reason === "not-found") throw new MenuNotFoundError({ message: `menu '${required.menuId}' was not found` });
  throw new MenuConflictError({ message: `menu '${required.menuId}' changed while it was being deleted — reload and try again` });
}
