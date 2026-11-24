/**
 * One row of the Trash. Mirrors `routes/trash/list.ts`'s `toAdminTrashResponse`.
 *
 * Every field is a SNAPSHOT captured when the thing was deleted, not a read of the thing itself —
 * which is what lets a row whose payload is corrupt still be listed and still be restored. `title`
 * can therefore be stale; that is the design, not a bug.
 */
export interface AdminTrashItem {
  /** The trash row's own id. Purge addresses rows by THIS, not by `entityId`. */
  id: string;
  entityType: string;
  /** Presentation subtype; canonical entityType still addresses restore/purge. Older rows may omit it. */
  displayKind?: "page" | "post";
  entityId: string;
  title: string;
  subtitle: string | null;
  trashedAt: string;
  purgeAfter: string;
  /** Whole days until auto-purge, floored at 0. Server-computed, so the clock is the server's. */
  daysRemaining: number;
  actorPrincipalId: string;
  actorPluginId: string | null;
  /** The server-resolved username for `actorPrincipalId`, or `null` when no user record matches
   *  it (the account was since removed, or the principal is not a user). Never the raw id — that
   *  resolution happens server-side so the admin UI never has to guess at a fallback. Optional
   *  (rather than always `string | null`) because an older server build that predates username
   *  resolution omits the field entirely — `rules.ts`'s `actorLabel` treats that absence
   *  differently from an explicit `null`, so the type must let the two states be told apart. */
  actorUsername?: string | null;
  /** True when the row's actor is a non-human system principal (e.g. the boot-time widget
   *  adoption), never a real user account. Optional because an older server predates this field;
   *  absent means "not known to be a system actor", the same safe default as `false`. */
  actorIsSystem?: boolean;
}

export interface AdminTrashPage {
  items: AdminTrashItem[];
  nextCursor: string | null;
}

/** Per-item outcomes. `forbidden` means the operator lacks THAT ROW'S kind's permission. */
export type AdminTrashRestoreOutcome =
  | "restored"
  | "not-found"
  | "version-changed"
  | "adapter-unavailable"
  | "forbidden";

export type AdminTrashPurgeOutcome =
  | "purged"
  | "already-gone"
  | "version-changed"
  | "still-referenced"
  | "not-found"
  | "adapter-unavailable"
  | "forbidden";

export interface AdminTrashRestoreReport {
  restored: number;
  results: { entityType: string; entityId: string; outcome: AdminTrashRestoreOutcome }[];
}

export interface AdminTrashPurgeReport {
  purged: number;
  results: { id: string; outcome: AdminTrashPurgeOutcome }[];
}
