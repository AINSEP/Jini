import { daysRemaining } from "../../core/days-remaining.js";
import type { TrashItem } from "../../trash/index.js";

/**
 * @file The admin Trash screen's row shape, moved with the list route.
 */

/**
 * The principal id the boot-time widget adoption writes as its actor
 * (`../../widgets/write-service.ts`'s `ADOPTION_ACTOR`) — today the only non-human actor the
 * Trash records. No user account can ever hold this id, so a row bearing it can never be a
 * real, since-removed user account; `actorIsSystem` lets the admin UI tell the two apart instead of
 * both collapsing into "Deleted user".
 */
const SYSTEM_ACTOR_PRINCIPAL_ID = "system";

/** One row of the admin Trash screen. */
export interface AdminTrashRow {
  id: string;
  entityType: string;
  entityId: string;
  title: string;
  subtitle: string | null;
  trashedAt: string;
  purgeAfter: string;
  daysRemaining: number;
  actorPrincipalId: string;
  actorPluginId: string | null;
  actorUsername: string | null;
  actorIsSystem: boolean;
}

/**
 * The screen's row shape. Keeps `id` — unlike the agent view, which drops it — because the
 * checkboxes select rows by it and the purge endpoint addresses them by it.
 *
 * `actorUsername` is `null` when `usernameByPrincipalId` has no entry for `actorPrincipalId` — the
 * deleting principal's user account no longer exists, or never had one (a non-user system
 * principal). The admin UI decides the fallback copy for that case; this endpoint never sends the
 * raw id as if it were a display value.
 *
 * @complexity O(1).
 */
export function toAdminTrashResponse(
  { item, now, usernameByPrincipalId }: { item: TrashItem; now: string; usernameByPrincipalId: ReadonlyMap<string, string> },
  _optional: Record<string, never> = {},
): AdminTrashRow {
  return {
    id: item.id,
    entityType: item.entityType,
    entityId: item.entityId,
    title: item.displayTitle,
    subtitle: item.displaySubtitle,
    trashedAt: item.trashedAt,
    purgeAfter: item.purgeAfter,
    daysRemaining: daysRemaining({ now, until: item.purgeAfter }),
    actorPrincipalId: item.actorPrincipalId,
    actorPluginId: item.actorPluginId,
    actorUsername: usernameByPrincipalId.get(item.actorPrincipalId) ?? null,
    actorIsSystem: item.actorPrincipalId === SYSTEM_ACTOR_PRINCIPAL_ID,
  };
}
