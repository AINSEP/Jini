/** Column/record ports; marker changes and index writes must share a reentrant transaction. */
export type TrashEntityType = string;

export interface TrashDisplay {
  title: string;
  subtitle?: string | null;
}

export interface TrashActor {
  principalId: string;
  pluginId?: string | null;
}

export type TrashMarkerResult =
  | { ok: true; version: number | null; priorMarker?: string | null; noop?: true }
  | { ok: false; reason: "not-found" | "version-changed" }
  | { ok: false; reason: "blocked"; code: string; count: number };

export type TrashPurgeOutcome = "purged" | "version-changed" | "already-gone";

export interface TrashAdapter {
  readonly entityType: TrashEntityType;

  hide(required: {
    workspaceId: string;
    entityId: string;
    at: string;
    expectedVersion: number | null;

  }, optional?: { actor?: TrashActor }): Promise<TrashMarkerResult>;

  unhide(required: {
    workspaceId: string;
    entityId: string;
    at: string;
    expectedVersion: number | null;
  }, optional?: { priorMarker?: string | null; actor?: TrashActor }): Promise<TrashMarkerResult>;

  purge(required: {
    workspaceId: string;
    entityId: string;
    expectedVersion: number | null;

  }, optional?: { actor?: TrashActor }): Promise<TrashPurgeOutcome>;
}

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

  nextCursor: string | null;
}

export type PurgeItemOutcome =
  | "purged"
  | "already-gone"
  | "version-changed"
  | "not-found"
  | "adapter-unavailable"
  | "forbidden";

export type TrashItemAuthorizer = (required: { item: TrashItem }) => Promise<boolean>;

export interface PurgeReport {
  purged: number;
  results: { id: string; outcome: PurgeItemOutcome }[];
}

export type RestoreOutcome = "restored" | "not-found" | "version-changed" | "adapter-unavailable";

export interface TrashPort {

  trash(required: {
    workspaceId: string;
    entityType: TrashEntityType;
    entityId: string;
    actor: TrashActor;
    display: TrashDisplay;
    at: string;
    expectedVersion: number | null;

  }, optional?: { priorMarker?: string | null }): Promise<TrashMarkerResult>;

  restore(required: {
    workspaceId: string;
    entityType: TrashEntityType;
    entityId: string;
    at: string;

  }, optional?: { actor?: TrashActor }): Promise<RestoreOutcome>;

  list(required: {
    workspaceId: string;
    now: string;
    limit: number;
  }, optional?: { entityTypes?: readonly TrashEntityType[]; cursor?: string | null }): Promise<TrashPage>;

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

}, optional?: { priorMarker?: string | null }) => Promise<TrashMarkerResult>;

export type ForgetRemovedEntity = (required: { workspaceId: string; id: string }) => Promise<void>;

export interface TrashSweepClaim {
  id: string;
  workspaceId: string;
  entityType: TrashEntityType;
  entityId: string;
  entityVersion: number | null;
}

export interface TrashRepoPort {

  insert(required: { row: TrashItem }): Promise<void>;

  findByEntity(required: {
    workspaceId: string;
    entityType: TrashEntityType;
    entityId: string;
  }): Promise<TrashItem | null>;

  findByIds(required: { workspaceId: string; ids: readonly string[] }): Promise<TrashItem[]>;

  deleteById(required: { workspaceId: string; id: string }): Promise<void>;

  deleteByEntity(required: {
    workspaceId: string;
    entityType: TrashEntityType;
    entityId: string;
  }): Promise<void>;

  list(required: {
    workspaceId: string;
    now: string;
    limit: number;
  }, optional?: { entityTypes?: readonly TrashEntityType[]; cursor?: string | null }): Promise<TrashPage>;

  claimDue(required: {
    now: string;
    leaseOwner: string;
    leaseUntil: string;
    limit: number;
  }): Promise<TrashSweepClaim[]>;

  releaseLease(required: { id: string }): Promise<void>;
}

export type TransactionRunner = <T>(required: { work: () => Promise<T> }) => Promise<T>;

/** Host-owned allowlist evaluated at call time; listing still uses snapshots for missing domains. */
export type TrashEntityPolicy = (required: { entityType: TrashEntityType }) => boolean;
