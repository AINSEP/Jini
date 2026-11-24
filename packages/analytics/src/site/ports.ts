/**
 * @file Port contracts and dependency seams for the host's `analytics` library.
 *
 * Purpose:
 * Declares the dependency-inversion seams the analytics design introduces. INTERFACES ONLY —
 * no adapters, no feature logic. The old `repo.memory.ts` fork is deleted: Jini owns the buffer (DELETED-CODE.md). Adapters use
 * `jini-adapters.ts` / the storage-layer analytics sink and a
 * `sink.local.ts` / `sink.forwarding.ts` split (built later), following the feature-module
 * pattern used by `src/features/*`.
 *
 * Port decisions (ADR-006 rule-of-two — a port needs two plausible adapters, one built now):
 * - `AnalyticsSinkPort` (WRITE seam): the ingest beacon hands each normalized, PII-free hit to
 *   this port. Adapters: `@jini-ai/analytics` LocalBufferSink (process-local) and the durable
 *   `SqliteBufferSink`. This is the seam that makes "bring your own external analytics" (the
 *   Tier-3 replaceability the §3.5 placement rule wants) real without a repaint — the honest
 *   analogue of ADR-027's `BlobStorePort` (local now, S3 named-next). The once named-next
 *   `ForwardingSink` landed (2026-10-21) as `@jini-ai/analytics` vendor FORWARDERS behind a
 *   fan-out sink, not as a replacement sink: the built-in sink always stays the primary, and the
 *   per-site `core.analytics.sink` setting adds one plugin-contributed vendor next to it
 *   (`forwarding.ts`, `.cloud-coord/analytics-DESIGN.md`).
 * - `AnalyticsRepoPort` (STORAGE): read + core-only write over the aggregate/time-series
 *   tables, satisfied by the standard in-memory + SQLite adapter pair (ADR-015), same as every
 *   feature repo. There is deliberately NO `StatsQueryPort`: reads are ordinary core code, with
 *   only one query evaluator — exactly ADR-021 §2's reasoning for "no PolicyPort."
 */
import type { Clock as ClockPort, IdGenerator as IdGeneratorPort, ISODateTime, UUID } from "@jini-ai/core/primitives";
import type { DomainEvent, OutboxPort } from "@jini-ai/core/contracts/events";
import type {
  AnalyticsAggregateRow,
  AnalyticsDomainEventName,
  AnalyticsDomainEventPayloads,
  AnalyticsEventRow,
  AnalyticsGoalDef,
  AnalyticsGranularity,
  AnalyticsSessionRow,
  AnalyticsSiteConfig,
  DimensionName,
  IngestBeacon,
  IngestContext,
  NormalizedHit,
  RealtimeSnapshot,
  StatsQuery,
  StatsResult,
} from "../index.js";

/** Static capabilities of a sink adapter (frozen-minimal surface, cf. ADR-027 presign). */
export interface AnalyticsSinkCapabilities {
  /** Whether the sink persists locally (queryable dashboards) or only forwards outbound. */
  readonly durable: boolean;
  /** Whether the sink can accept batches in one call. */
  readonly batch: boolean;
}

/**
 * WRITE seam (ADR-006). Only the PII-free `NormalizedHit` crosses this boundary — the ingest
 * seam has already stripped PII, resolved the workspace, and computed the cookie-less
 * `visitorHash`. `accept` is fire-and-forget and MUST NOT block the beacon response.
 */
export interface AnalyticsSinkPort {
  capabilities(): AnalyticsSinkCapabilities;
  accept(required: { hit: NormalizedHit }, optional?: Record<string, never>): Promise<void>;
  acceptBatch(required: { hits: readonly NormalizedHit[] }, optional?: Record<string, never>): Promise<void>;
  /**
   * Newest-first recent hits (the admin "recent hits" screen's only read). Async: the durable
   * adapter reads through the storage kernel, which is async on every dialect.
   */
  list(required: Record<string, never>, optional?: { limit?: number }): Promise<NormalizedHit[]>;
}

/**
 * A single core-computed increment against the aggregate fact table. The repo folds
 * `visitorHashes` into each bucket's mergeable HLL sketch; callers never touch the sketch
 * encoding. Emitted by the rollup job, applied by core alone (single-writer sidecar).
 */
export interface AggregateDelta {
  workspaceId: UUID;
  granularity: AnalyticsGranularity;
  bucketStart: ISODateTime;
  dimension: DimensionName;
  dimensionValue: string;
  pageviews: number;
  events: number;
  visitorHashes: readonly string[];
  bounces: number;
  durationMs: number;
}

/** Input to a bounded, resumable rollup pass (raw buffer → aggregate deltas). */
export interface RollupInput {
  workspaceId: UUID;
  granularity: AnalyticsGranularity;
  /** Rollup covers hits at/after this watermark; the job advances it monotonically. */
  fromWatermark: ISODateTime;
  nowIso: ISODateTime;
  /** Per-dimension cardinality cap; overflow folds into the `(other)` bucket. */
  maxDimensionCardinality: number;
}

export interface RollupResult {
  workspaceId: UUID;
  granularity: AnalyticsGranularity;
  buckets: number;
  rowsWritten: number;
  /** New watermark to persist for the next resumable pass. */
  nextWatermark: ISODateTime;
}

/**
 * STORAGE port. Behind it sit the in-memory + SQLite adapters (ADR-015 rule-of-two). All write
 * methods are CORE-ONLY (single-writer sidecar, ADR-027 §2): a CI import-graph canary asserts
 * no module outside `analytics/repo` writes the analytics tables, and these writes deliberately
 * do NOT generate ADR-022 entry revisions (they narrow INV-3, as media sidecars do).
 */
export interface AnalyticsRepoPort {
  // ---- writes (core-only, single writer) ----
  appendEvents(rows: readonly AnalyticsEventRow[]): Promise<void>;
  applyAggregateDeltas(deltas: readonly AggregateDelta[]): Promise<void>;
  upsertSession(row: AnalyticsSessionRow): Promise<void>;

  // ---- reads (ordinary core code calls these; no StatsQueryPort) ----
  queryTimeSeries(query: StatsQuery): Promise<StatsResult>;
  queryBreakdown(query: StatsQuery): Promise<StatsResult>;
  realtime(input: {
    workspaceId: UUID;
    windowSeconds: number;
    nowIso: ISODateTime;
  }): Promise<RealtimeSnapshot>;

  // ---- lifecycle ----
  rollup(input: RollupInput): Promise<RollupResult>;
  /** Delete raw-buffer + session rows past their TTL (ADR-012 per-site retention job). */
  pruneExpired(input: { workspaceId: UUID; nowIso: ISODateTime }): Promise<{ removed: number }>;

  // ---- goals registry (schemas-as-data) ----
  listGoals(input: { workspaceId: UUID }): Promise<readonly AnalyticsGoalDef[]>;
  getAggregateRow(input: {
    workspaceId: UUID;
    granularity: AnalyticsGranularity;
    bucketStart: ISODateTime;
    dimension: DimensionName;
    dimensionValue: string;
  }): Promise<AnalyticsAggregateRow | null>;
}

/** Reads the per-site analytics config (backed by ADR-028 settings; a value, not a heavy port). */
export interface AnalyticsConfigPort {
  get(input: { workspaceId: UUID }): Promise<AnalyticsSiteConfig>;
}

/**
 * Extension hooks (ADR-009 lane 3). Async + serializable-only to stay inside the frozen ABI
 * (ADR-024 §3): a plugin hook may run out-of-process. `beforeIngest` may annotate or DROP a hit
 * (return `null`) — e.g. exclude internal traffic; it can never see PII because it only ever
 * receives an already-normalized hit.
 * Wired 2026-10-21: plugin analytics-hooks contributions (the host's `*-analytics-hooks.json`) are chained by
 * `forwarding.ts#createPluginAnalyticsHooks` and reach the beacon route.
 */
export interface AnalyticsHooks {
  beforeIngest(required: { hit: NormalizedHit }, optional?: Record<string, never>): Promise<NormalizedHit | null>;
}

/** Typed outbox event envelope for the analytics library (rides core `DomainEvent`). */
export type AnalyticsDomainEvent<K extends AnalyticsDomainEventName = AnalyticsDomainEventName> =
  DomainEvent<AnalyticsDomainEventPayloads[K]> & { name: K };

// ---- Application dependency seams (mirrors the `UpdatePost*` deps shape in features/post) ----

/** Deps for the ingest application service (beacon → normalize → sink). */
export interface IngestDeps {
  clock: ClockPort;
  ids: IdGeneratorPort;
  sink: AnalyticsSinkPort;
  config: AnalyticsConfigPort;
  hooks?: AnalyticsHooks;
}

export interface IngestRequired {
  deps: IngestDeps;
  input: { beacon: IngestBeacon; context: IngestContext };
}

/** Deps for the rollup job (raw buffer → aggregate deltas → outbox event). */
export interface RollupDeps {
  clock: ClockPort;
  repo: AnalyticsRepoPort;
  outbox: OutboxPort;
}

export interface RollupRequired {
  deps: RollupDeps;
  input: RollupInput;
}

/** Deps for read/query application services (dashboards + AI tools). */
export interface QueryDeps {
  repo: AnalyticsRepoPort;
}

export interface QueryRequired {
  deps: QueryDeps;
  input: StatsQuery;
}

// ---- Errors (empty subclasses, matching the feature-module convention) ----

export class AnalyticsDisabledError extends Error {}
export class AnalyticsValidationError extends Error {}
export class AnalyticsPiiRejectedError extends Error {}
export class AnalyticsWorkspaceUnresolvedError extends Error {}
