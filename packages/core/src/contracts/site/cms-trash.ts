/**
 * @file The admin Trash wire DTOs: the JSON bodies the trash admin routes (list, restore, purge)
 * answer with and an admin client reads. Declared here, once, so the host's route serializers and
 * any client read the same shapes without the client depending on CMS or the trash engine.
 */

/**
 * One row of the Trash.
 *
 * Every field is a SNAPSHOT captured when the thing was deleted, not a read of the thing itself —
 * which is what lets a row whose payload is corrupt still be listed and still be restored. `title`
 * can therefore be stale; that is the design, not a bug.
 */
export interface AdminTrashItemDto {
  /** The trash row's own id. Purge addresses rows by THIS, not by `entityId`. */
  readonly id: string;
  readonly entityType: string;
  /** Presentation subtype; canonical entityType still addresses restore/purge. Older rows may omit it. */
  readonly displayKind?: 'page' | 'post';
  readonly entityId: string;
  readonly title: string;
  readonly subtitle: string | null;
  readonly trashedAt: string;
  readonly purgeAfter: string;
  /** Whole days until auto-purge, floored at 0. Server-computed, so the clock is the server's. */
  readonly daysRemaining: number;
  readonly actorPrincipalId: string;
  readonly actorPluginId: string | null;
  /** The server-resolved username for `actorPrincipalId`, or `null` when no user record matches it
   *  (the account was since removed, or the principal is not a user). Never the raw id. Optional
   *  because a server build that predates username resolution omits the field, and a reader treats
   *  that absence differently from an explicit `null`. */
  readonly actorUsername?: string | null;
  /** True when the row's actor is a non-human system principal, never a real user account. Optional
   *  because an older server predates this field; absent means "not known to be a system actor". */
  readonly actorIsSystem?: boolean;
}

/** `GET …/trash`: one page of rows and the keyset cursor of the next (`null` on the last page). */
export interface AdminTrashPageDto {
  readonly items: readonly AdminTrashItemDto[];
  readonly nextCursor: string | null;
}

/** Per-item restore outcomes. `forbidden` means the operator lacks THAT ROW'S kind's permission. */
export type AdminTrashRestoreOutcome =
  | 'restored'
  | 'not-found'
  | 'version-changed'
  | 'adapter-unavailable'
  | 'forbidden';

/** Per-item purge outcomes. `forbidden` means the operator lacks THAT ROW'S kind's permission. */
export type AdminTrashPurgeOutcome =
  | 'purged'
  | 'already-gone'
  | 'version-changed'
  | 'still-referenced'
  | 'not-found'
  | 'adapter-unavailable'
  | 'forbidden';

/** `POST …/trash/restore`: how many rows came back and each row's outcome. */
export interface AdminTrashRestoreReportDto {
  readonly restored: number;
  readonly results: readonly { readonly entityType: string; readonly entityId: string; readonly outcome: AdminTrashRestoreOutcome }[];
}

/** `POST …/trash/purge`: how many rows were destroyed and each row's outcome. */
export interface AdminTrashPurgeReportDto {
  readonly purged: number;
  readonly results: readonly { readonly id: string; readonly outcome: AdminTrashPurgeOutcome }[];
}
