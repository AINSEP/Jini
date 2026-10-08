/** Product-neutral identifiers and serializable custom properties. */
import type { ISODateTime, JsonObject, UUID } from "@jini-ai/core/primitives";

/** Required collection bounds; no host privacy policy is chosen implicitly. */
export interface AnalyticsPrivacyPolicy {
  maxEventPropCount: number;
  maxEventPropStringLength: number;
  sessionWindowMinutes: number;
}

/** Kind of a recorded hit. `event` covers custom/goal events; `pageview` is the default. */
export type HitKind = "pageview" | "event";

/** Coarse device classification derived from UA at ingest (UA then discarded). */
export type DeviceClass = "desktop" | "mobile" | "tablet" | "bot" | "unknown";

/** Time-bucket granularity for aggregate/time-series storage and queries. */
export type AnalyticsGranularity = "hour" | "day" | "month";

/**
 * The bounded, fixed set of dimensions the aggregate fact table breaks traffic down by.
 * The set is closed on purpose: unbounded dimensions are both a cardinality/storage DoS and
 * a re-identification vector. `total` is the un-broken-down rollup. Custom dimensions arrive
 * only via the declared goals registry, never as free-form keys.
 */
export type DimensionName =
  | "total"
  | "path"
  | "referrer_host"
  | "utm_source"
  | "utm_medium"
  | "utm_campaign"
  | "country"
  | "region"
  | "device_class"
  | "browser_family"
  | "os_family"
  | "entry_path"
  | "exit_path"
  | "goal";

/** Metrics a dashboard/AI query can request over the aggregate store. */
export type MetricName = "pageviews" | "visitors" | "events" | "bounce_rate" | "avg_duration_ms";

/** Flat `analytics.*` permission strings (ADR-021 §3 — one permission language). */
export type AnalyticsPermission =
  | "analytics.read"
  | "analytics.read.realtime"
  | "analytics.manage"
  | "analytics.goals.manage"
  | "analytics.export";

/** Which sink adapter a site routes ingest through (ADR-006 rule-of-two — see ports.ts). */
export type AnalyticsSinkKind = "local" | "forwarding";

/** Opaque, mergeable unique-visitor sketch (HyperLogLog). Serialized bytes, no per-visitor rows. */
export type VisitorSketch = Uint8Array;

/** Allowlisted UTM campaign parameters (the only query-string data retained). */
export interface UtmParams {
  source: string | null;
  medium: string | null;
  campaign: string | null;
  term: string | null;
  content: string | null;
}

/**
 * The minimal payload the first-party, cookie-less client beacon sends (`navigator.sendBeacon`).
 * Deliberately small and non-identifying: no cookies, no localStorage id, no fingerprint.
 * The server derives everything else; the client never sends an IP/UA (the request carries those).
 */
export interface IngestBeacon {
  /** Site host the hit belongs to; resolved server-side → workspaceId. */
  host: string;
  /** URL path only; query string dropped except allowlisted UTMs (extracted server-side). */
  path: string;
  /** Full referrer URL as seen by the client; reduced to a host server-side. */
  referrer: string | null;
  /** Kind of hit; defaults to `pageview`. */
  kind: HitKind;
  /** Custom event/goal name when `kind === "event"`. */
  eventName?: string;
  /** Bounded, validated, non-PII event properties. Rejected if they carry PII shapes. */
  eventProps?: JsonObject;
  /** Client-declared Do-Not-Track / Global-Privacy-Control signals, honored server-side. */
  dnt?: boolean;
  gpc?: boolean;
}

/**
 * Transient per-request signals used ONLY during normalization and then discarded.
 * NEVER persisted, never placed on a row. Present in the type to make the boundary explicit.
 */
export interface IngestContext {
  /** Remote IP — used for country/region lookup and exclusion checks, then dropped. */
  readonly ip: string;
  /** User-Agent — used for device/browser/os classification, then dropped. */
  readonly userAgent: string;
  /** Accept-Language — advisory locale hint, then dropped. */
  readonly acceptLanguage: string | null;
  /** Request receipt time. */
  readonly receivedAt: ISODateTime;
}

/**
 * A fully normalized, PII-free hit produced by the ingest seam. This is the ONLY shape that
 * crosses the `AnalyticsSinkPort` — the boundary at which the design guarantees no PII.
 */
export interface NormalizedHit {
  workspaceId: UUID;
  occurredAt: ISODateTime;
  kind: HitKind;
  path: string;
  referrerHost: string | null;
  utm: UtmParams;
  country: string | null;
  region: string | null;
  deviceClass: DeviceClass;
  browserFamily: string | null;
  osFamily: string | null;
  /** Daily-rotating, per-site, salted, non-reversible visitor digest (cookie-less). */
  visitorHash: string;
  /** Derived session id = fn(visitorHash + bounded session window). Not cross-day linkable. */
  sessionId: string;
  eventName: string | null;
  eventProps: JsonObject | null;
}

/**
 * Raw buffer row — PII-free by construction, HARD-TTL'd. Feeds the rollup job and the
 * realtime/last-N-minutes view, then pruned. This is not durable storage; the aggregate
 * table is. (ADR-027 §2 single-writer sidecar; narrows ADR-022 INV-3.)
 */
export interface AnalyticsEventRow {
  id: UUID;
  workspaceId: UUID;
  occurredAt: ISODateTime;
  kind: HitKind;
  path: string;
  referrerHost: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  country: string | null;
  region: string | null;
  deviceClass: DeviceClass;
  browserFamily: string | null;
  osFamily: string | null;
  visitorHash: string;
  sessionId: string;
  eventName: string | null;
  eventProps: JsonObject | null;
  /** Written by core (single writer); attribution stamp analogous to ADR-027 §2. */
  createdByPluginId: string | null;
  /** Hard retention boundary; the prune job deletes on/after this instant. */
  expiresAt: ISODateTime;
}

/**
 * Durable time-series fact row — the PRIMARY storage. Pre-aggregated counters per
 * (workspace, granularity, bucket, dimension, value). Uniques use a mergeable HLL sketch so
 * distinct-visitor counts compose across arbitrary time ranges WITHOUT storing per-visitor
 * rows — the privacy + storage-efficiency lever. Dimension-value cardinality is capped per
 * bucket to a top-N with an `(other)` overflow bucket (see `DIMENSION_OVERFLOW_VALUE`).
 * Composite PK is workspace-scoped (ADR-007): (workspaceId, granularity, bucketStart, dimension, dimensionValue).
 */
export interface AnalyticsAggregateRow {
  workspaceId: UUID;
  granularity: AnalyticsGranularity;
  bucketStart: ISODateTime;
  dimension: DimensionName;
  dimensionValue: string;
  pageviews: number;
  events: number;
  /** Mergeable unique-visitor sketch for this bucket/dimension. */
  visitorsSketch: VisitorSketch;
  /** Sessions that bounced (single pageview) — for bounce rate. */
  bounces: number;
  /** Sum of engaged session duration in ms — for average duration. */
  totalDurationMs: number;
  updatedAt: ISODateTime;
}

/**
 * Ephemeral, PII-free session row for bounce / duration / entry / exit metrics. Bounded
 * retention (pruned like the raw buffer). Keyed on the cookie-less `sessionId`.
 */
export interface AnalyticsSessionRow {
  workspaceId: UUID;
  sessionId: string;
  startedAt: ISODateTime;
  lastSeenAt: ISODateTime;
  entryPath: string;
  exitPath: string;
  pageviewCount: number;
  isBounce: boolean;
  expiresAt: ISODateTime;
}

/**
 * Declarative goal/custom-event definition (schemas-as-data registry, mirroring ADR-022's
 * content-types-as-data and ADR-028's setting-definitions). `matchValue` MUST be evaluated by
 * the total/bounded expression language (ADR-022 amendment §2 — a trust-boundary primitive);
 * no arbitrary code.
 */
export interface AnalyticsGoalDef {
  id: UUID;
  workspaceId: UUID;
  /** Stable machine key; immutable once created (rename = alias, per registry discipline). */
  name: string;
  displayName: string;
  matchKind: "pageview_path" | "custom_event";
  /** Bounded pattern: a path glob or an event name. Total/side-effect-free (ADR-022 §2). */
  matchValue: string;
  createdAt: ISODateTime;
}

/** Per-site analytics configuration. `enabled=false` is the hard disable switch (Tier-3 replaceability). */
export interface AnalyticsSiteConfig {
  workspaceId: UUID;
  enabled: boolean;
  honorDoNotTrack: boolean;
  honorGlobalPrivacyControl: boolean;
  /** TTL for the raw buffer + session tables in days (durable aggregates are unaffected). */
  rawRetentionDays: number;
  /** Path globs excluded from collection (e.g. admin/preview). */
  excludedPaths: readonly string[];
  /** IP ranges excluded (matched transiently at ingest; never stored on a row). */
  excludedIpRanges: readonly string[];
  /** Which sink adapter to route through (ADR-006). */
  sink: AnalyticsSinkKind;
}

/** Overflow bucket label used when a dimension exceeds its per-bucket cardinality cap. */
export type DimensionOverflowValue = "(other)";

// ---- Query surface (read side is ordinary core code over the repo port; see ports.ts) ----

/** A single equality filter on a dimension. */
export interface StatsFilter {
  dimension: DimensionName;
  value: string;
}

/** A time-series or breakdown query issued by a dashboard or AI tool. */
export interface StatsQuery {
  workspaceId: UUID;
  metric: MetricName;
  granularity: AnalyticsGranularity;
  from: ISODateTime;
  to: ISODateTime;
  /** When set, results are broken down by this dimension instead of returned as a series. */
  breakdownBy?: DimensionName;
  filters?: readonly StatsFilter[];
  /** Top-N cap for breakdown queries. */
  limit?: number;
}

export interface TimeSeriesPoint {
  bucketStart: ISODateTime;
  value: number;
}

export interface BreakdownRow {
  dimensionValue: string;
  value: number;
}

export interface StatsResult {
  metric: MetricName;
  total: number;
  series?: readonly TimeSeriesPoint[];
  breakdown?: readonly BreakdownRow[];
}

/** Live "last N minutes" snapshot, served off the raw buffer (not the rollup). */
export interface RealtimeSnapshot {
  workspaceId: UUID;
  windowSeconds: number;
  activeVisitors: number;
  pageviews: number;
  topPaths: readonly BreakdownRow[];
}

// ---- Domain event payloads (outbox, ADR-009 lane 2 — low volume, NOT per-hit) ----

/** Names of domain events the analytics library emits via the outbox. */
export type AnalyticsDomainEventName = "analytics.rollup.completed" | "analytics.goal.triggered";

export interface RollupCompletedPayload {
  workspaceId: UUID;
  granularity: AnalyticsGranularity;
  bucketStart: ISODateTime;
  rowsWritten: number;
}

export interface GoalTriggeredPayload {
  workspaceId: UUID;
  goalName: string;
  occurredAt: ISODateTime;
}

/** Payload map for typed outbox emission (rides `DomainEvent<TPayload>` from core/ports). */
export interface AnalyticsDomainEventPayloads {
  "analytics.rollup.completed": RollupCompletedPayload;
  "analytics.goal.triggered": GoalTriggeredPayload;
}
