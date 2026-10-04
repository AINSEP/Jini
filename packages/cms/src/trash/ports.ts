/**
 * @file Column/record contracts for snapshot-only trash listing and atomic marker/index changes.
 * A trash operation never round-trips an entity payload, and listing never reads the entity at all.
 * Parsing a payload merely to flip its status fails on the corrupt rows a user most wants gone.
 * `trash` requires a caller-held display snapshot. Adapters expose only hide/unhide/purge, with no
 * describe method: a read that can throw must never become a dependency of trash listing.
 */
export type TrashEntityType = string;

/** The two display strings captured from columns at trash time. Never derived by the port. */
export interface TrashDisplay {
  title: string;
  subtitle?: string | null;
}

export interface TrashActor {
  principalId: string;
  pluginId?: string | null;
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

/** Outcome of a physical row removal. */
export type TrashPurgeOutcome = "purged" | "version-changed" | "already-gone";

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
  readonly entityType: TrashEntityType;
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

/** One row of the Trash list. Rendered entirely from the snapshot — no entity read. */
export interface TrashItem {
  id: string;
  workspaceId: string;
  entityType: TrashEntityType;
  entityId: string;
  trashedAt: string;
  purgeAfter: string;
  actorPrincipalId: string;
  actorPluginId: string | null;
  displayTitle: string;
  displaySubtitle: string | null;
  entityVersion: number | null;

  priorMarker: string | null;
}

export interface TrashPage {
  items: TrashItem[];
  /** Keyset cursor on `(trashed_at, id)`; `null` when the page is the last one. */
  nextCursor: string | null;
}

/** Per-item outcome of {@link TrashPort.purgeSelected}. */
export type PurgeItemOutcome =
  | "purged"
  | "already-gone"
  | "version-changed"
  | "not-found"
  | "adapter-unavailable"
  | "forbidden";

/**
 * Decides whether the caller may permanently destroy ONE already-resolved trash row.
 *
 * Purge addresses rows by trash row id, and the per-kind permission has to be checked against the
 * kind the STORED row actually has. A caller that supplied the kind alongside the id could name
 * `comment` for a post's row and destroy a post holding only `comments.moderate`. So the gate is
 * handed the row `purgeSelected` looked up, inside the same call that then purges it — which closes
 * the read-then-act window as well as the escalation.
 *
 * Returning `false` (rather than throwing) keeps a denial a per-item outcome: one forbidden row in
 * a hand-ticked selection must not abort the rows the caller may destroy.
 */
export type TrashItemAuthorizer = (required: { item: TrashItem; }) => Promise<boolean>;

export interface PurgeReport {
  purged: number;
  results: { id: string; outcome: PurgeItemOutcome; }[];
}

/** Outcome of a restore. `adapter-unavailable` is honest degradation, not a throw: the row lists
 *  from its snapshot even when its plugin has been uninstalled. */
export type RestoreOutcome = "restored" | "not-found" | "version-changed" | "adapter-unavailable";

export interface TrashPort {
  /**
   * Hide the entity AND index it, as ONE transaction. There is deliberately no public seam that
   * performs only one of the two writes — a failure between them would leave an item that is in the
   * Trash and still live on the site, or hidden with no Trash row, which is unrecoverable from the UI.
     */
  trash(required: {
    workspaceId: string;
    entityType: TrashEntityType;
    entityId: string;
    actor: TrashActor;
    display: TrashDisplay;
    at: string;
    expectedVersion: number | null;

  }, optional?: { priorMarker?: string | null; }): Promise<TrashMarkerResult>;

  restore(required: {
    workspaceId: string;
    entityType: TrashEntityType;
    entityId: string;
    at: string;

  }, optional?: { actor?: TrashActor; }): Promise<RestoreOutcome>;
  /** Excludes `purge_after <= now`: a dormant site shows nothing expired on its first render, with
   *  no wait for a sweep. */
  list(required: {
    workspaceId: string;
    now: string;
    limit: number;
  }, optional?: { entityTypes?: readonly TrashEntityType[]; cursor?: string | null; }): Promise<TrashPage>;
  /**
   * Human-confirmed: the admin Trash screen and `permanent-delete` tools may reach this port only
   * after confirmation. Tool input cannot self-confirm; see the confirmed-call contract tests.
   *
   * `authorizeItem` is REQUIRED, not optional. A permission check a call site may omit is a
   * permission check some call site eventually omits, and this operation is the one that cannot be
   * undone. See {@link TrashItemAuthorizer} for why the gate takes the resolved row.
     */
  purgeSelected(required: {
    workspaceId: string;
    ids: readonly string[];
    actor: TrashActor;
    authorizeItem: TrashItemAuthorizer;
  }): Promise<PurgeReport>;
}

export type RemoveEntity = (required: {
  workspaceId: string;
  id: string;
  display: TrashDisplay;
  at: string;
  expectedVersion: number | null;
  actor: TrashActor;

}, optional?: { priorMarker?: string | null; }) => Promise<TrashMarkerResult>;

/**
 * The function a domain's delete path receives to DROP an index row.
 *
 * Needed by any domain that can leave the trashable state by a route other than a Trash-screen
 * restore or purge: a comment approved back out of `trash` by ordinary moderation, a media asset
 * hard-purged from the admin delete rung. Without it the index row outlives the condition it
 * records, and the Trash screen offers a Restore or a permanent delete for something that is either
 * live again or already gone.
 *
 * NOT a half of {@link TrashPort.trash}. It writes no marker and hides nothing — it only forgets a
 * removal that some other owner has already undone or completed.
 */
export type ForgetRemovedEntity = (required: { workspaceId: string; id: string; }) => Promise<void>;

/** A claimed batch of due rows, handed to the sweeper. */
export interface TrashSweepClaim {
  id: string;
  workspaceId: string;
  entityType: TrashEntityType;
  entityId: string;
  entityVersion: number | null;
}

/**
 * Storage for `trashed_items`. Adapters: host persistence + in-memory reference adapter.
 *
 * Every method is column-only. Nothing here ever reaches into a domain table.
 */
export interface TrashRepoPort {
  /** Idempotent by `(workspace_id, entity_type, entity_id)` — re-trashing is a no-op, not a
   *  duplicate row. */
  insert(required: { row: TrashItem; }): Promise<void>;

  findByEntity(required: {
    workspaceId: string;
    entityType: TrashEntityType;
    entityId: string;
  }): Promise<TrashItem | null>;

  findByIds(required: { workspaceId: string; ids: readonly string[]; }): Promise<TrashItem[]>;
  /** Removes the index row. This IS the restore — there is no second marker to clear. */
  deleteById(required: { workspaceId: string; id: string; }): Promise<void>;

  deleteByEntity(required: {
    workspaceId: string;
    entityType: TrashEntityType;
    entityId: string;
  }): Promise<void>;

  list(required: {
    workspaceId: string;
    now: string;
    limit: number;
  }, optional?: { entityTypes?: readonly TrashEntityType[]; cursor?: string | null; }): Promise<TrashPage>;
  /** Atomic claim of due, unleased rows across EVERY workspace in the file (the `purge_after`
   *  index is global for exactly this query). */
  claimDue(required: {
    now: string;
    leaseOwner: string;
    leaseUntil: string;
    limit: number;
  }): Promise<TrashSweepClaim[]>;
  /** Explicitly release a claim. The built-in sweep retains stood-down leases for retry backoff. */
  releaseLease(required: { id: string; }): Promise<void>;
}

/**
 * Marker/index writes and follow-ups must share one reentrant transaction. A domain may already
 * hold a transaction around its marker/revision writes; nesting must join rather than open another
 * BEGIN, and a propagated failure must roll back the entire unit.
 */
export type TransactionRunner = <T>(required: { work: () => Promise<T>; }) => Promise<T>;

/** Host-owned allowlist evaluated at call time; listing still uses snapshots for missing domains. */
export type TrashEntityPolicy = (required: { entityType: TrashEntityType; }) => boolean;
