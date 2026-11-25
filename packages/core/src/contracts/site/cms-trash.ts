/**
 * @file The admin Trash wire DTOs and the `TrashActor` type: the JSON bodies the trash admin routes (list, restore, purge)
 * answer with and an admin client reads, plus who moved an item to the trash. Declared here, once, so the host's route
 * serializers and any client read the same shapes without the client depending on CMS or the trash engine.
 *
 * `@jini-ai/cms/trash` (`trash/ports.ts`) re-exports `TrashActor` from here. The trash service, its adapters and
 * the cms `RemoveEntity` port stay in the cms package.
 */

/** Who moved an item to the trash. */
export interface TrashActor {
  principalId: string;
  pluginId?: string | null;
}

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
  /** The host's retention window for items trashed NOW, in days, so the screen can state it without
   *  hard-coding it. Rows trashed under an earlier window keep their own stamped `purgeAfter`, which
   *  each row's `daysRemaining` already reflects. */
  readonly retentionDays: number;
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

/**
 * Outcome of one `moveToTrash` call. `version` is the entity's version AFTER the flip (`null` for a
 * kind with no version column) — mirrors {@link TrashPort.trash}'s own success shape rather than
 * inventing a second one.
 */
export type MoveToTrashOutcome =
  | { ok: true; version: number | null }
  | { ok: false; reason: "unknown-type" }
  | { ok: false; reason: "not-found" }
  | { ok: false; reason: "forbidden"; permission: string }
  | { ok: false; reason: "version-changed" }
  | { ok: false; reason: "blocked"; code: string; count: number };

/**
 * A Trash kind that performs its own move — a theme is a folder, not a row
 * (`features/theme/trash-theme-tool.ts`'s `createThemeTrashMover`); a hermetic memory-backed form has
 * no row `deps.db` can read (`composition/app.ts`'s `createRouteDeps`). {@link moveToTrash} checks
 * `permission` exactly as it checks a registry entry's, then hands the move over; the mover owns its
 * own lookup and refusals and answers in the same outcome shape.
 */
export interface TrashKindMover {
  readonly permission: string;
  move(required: { workspaceId: string; entityId: string; actor: TrashActor }): Promise<MoveToTrashOutcome>;
}

/** The two display strings captured from columns at trash time. Never derived by the port. */
export interface TrashDisplay {
  title: string;
  subtitle?: string | null;
}

/**
 * Outcome of a marker flip.
 *
 * `version` is the entity's version AFTER the flip — that is what lands in
 * `trashed_items.entity_version` and what the sweeper's compare-and-delete later checks, so a
 * restore (which bumps the version again) always wins a race against a purge. `null` for a domain
 * with no version column.
 *
 * `priorMarker` is OPTIONAL and additive (migration 0072): a status-marker adapter (`menu`, `term`,
 * `taxonomy`) reports the status the row carried immediately before `hide` flipped it to `trash`, so
 * `restore` can put it back exactly rather than to a fixed fallback. A caller that omits the key
 * entirely (timestamp adapters) keeps the exact `{ ok: true, version }` shape — do not set this to
 * `undefined`; leave the key out. `trash.contract.test.ts`'s pinned `assert.deepEqual(trashed, {
 * ok: true, version: 2 })` depends on that: Node's `assert.deepEqual` treats an extra own-enumerable
 * property, even one valued `undefined`, as a mismatch.
 *
 * `noop` is OPTIONAL and additive (T1c, `follow-ups.test.ts`): host table adapters' `hide`/`unhide`
 * set it to `true` on their idempotent "already in the target state" branch — the ONE signal that
 * distinguishes that branch from a real transition, both of which otherwise report the same
 * `ok: true`. `withFollowUps` (`@jini-ai/cms/trash`) reads it to decide whether a hook actually finished
 * something. Same leave-the-key-out rule as `priorMarker`: a real transition leaves it absent, so exact-shape assertions remain
 * valid, so their pinned exact-shape assertions are
 * unaffected.
 *
 * `"blocked"` (T1 item 2, migration-free — no new column) is a THIRD failure reason, alongside
 * `"not-found"`/`"version-changed"`: the row exists and the version matches, but the host's
 * declared blocker found rows that must move or be deleted first (a term with child terms). `code`
 * and `count` are always present together on this branch — the host registry defines their meaning.
 */
export type TrashMarkerResult =
  | { ok: true; version: number | null; priorMarker?: string | null; noop?: true; }
  | { ok: false; reason: "not-found" | "version-changed"; }
  | { ok: false; reason: "blocked"; code: string; count: number; };

/** Outcome of a physical row removal. `still-referenced` retains the entity and its Trash index. */
export type TrashPurgeOutcome = "purged" | "version-changed" | "already-gone" | "still-referenced";

/**
 * One per domain. Built and registered into a plain `Map` at the composition root and resolved
 * **at call time**, never at registration time: this codebase's module registries (`ToolRegistry`,
 * routing's `phaseRegistry`) are append-only with no unregister, so anything that filters at
 * registration runs exactly once. Two real bugs already came from that.
 *
 * Persistent host implementations MUST be column-only SQL. No payload parse, no ORM entity hydration, no domain
 * write-service call that re-validates a record.
 */
export interface TrashAdapter {
  readonly entityType: string;
  /**
   * Move the domain's own marker to hidden.
   *
   * `at` is supplied by the caller rather than read from an adapter-local clock so the marker's
   * timestamp is byte-identical to the one the calling domain writes into its revision ledger.
     */
  hide(required: {
    workspaceId: string;
    entityId: string;
    at: string;
    expectedVersion: number | null;

  }, optional?: { actor?: TrashActor; }): Promise<TrashMarkerResult>;
  /**
   * Move it back. Same no-parse rule as {@link TrashAdapter.hide}.
   *
   * `priorMarker` (migration 0072) is what {@link TrashItem.priorMarker} stored at trash time —
   * additive and optional, so every adapter's existing signature stays structurally compatible. A
   * status-marker adapter restores to `priorMarker ?? restoreFallback`; a timestamp-marker adapter
   * (timestamp adapters) ignores it, since clearing the marker column needs no prior value.
     */
  unhide(required: {
    workspaceId: string;
    entityId: string;
    at: string;
    expectedVersion: number | null;
  }, optional?: { priorMarker?: string | null; actor?: TrashActor; }): Promise<TrashMarkerResult>;
  /** Physically remove the row. Compare-and-delete on `expectedVersion`. */
  purge(required: {
    workspaceId: string;
    entityId: string;
    expectedVersion: number | null;

  }, optional?: { actor?: TrashActor; }): Promise<TrashPurgeOutcome>;
}

/** The non-throwing authorization seam both surfaces already hold. */
export type TrashAuthorizeFn = (params: {
  principalId: string;
  permission: string;
  workspaceId: string;
  entityType?: string;
  entityId?: string | undefined;
}) => Promise<{ allowed: boolean; reason: string }>;

