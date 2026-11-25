/**
 * @file Column/record contracts for snapshot-only trash listing and atomic marker/index changes.
 * A trash operation never round-trips an entity payload, and listing never reads the entity at all.
 * Parsing a payload merely to flip its status fails on the corrupt rows a user most wants gone.
 * `trash` requires a caller-held display snapshot. Adapters expose only hide/unhide/purge, with no
 * describe method: a read that can throw must never become a dependency of trash listing.
 */
import type { TrashActor, TrashDisplay, TrashMarkerResult } from "@jini-ai/core/contracts/site/cms-trash";

export type { TrashActor } from "@jini-ai/core/contracts/site/cms-trash";

export type TrashEntityType = string;

export type { TrashDisplay } from "@jini-ai/core/contracts/site/cms-trash";
export type { TrashMarkerResult } from "@jini-ai/core/contracts/site/cms-trash";
export type { TrashPurgeOutcome } from "@jini-ai/core/contracts/site/cms-trash";
export type { TrashAdapter } from "@jini-ai/core/contracts/site/cms-trash";

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
  | "still-referenced"
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

  }, optional?: { priorMarker?: string | null | undefined; }): Promise<TrashMarkerResult>;

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

}, optional?: { priorMarker?: string | null | undefined; }) => Promise<TrashMarkerResult>;

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
