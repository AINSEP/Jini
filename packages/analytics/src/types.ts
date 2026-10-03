/** Product-neutral identifiers and serializable custom properties. */
import type { UUID, ISODateTime, JsonValue, JsonObject } from "@jini-ai/core/primitives";

/** Required collection bounds; no host privacy policy is chosen implicitly. */
export interface AnalyticsPrivacyPolicy {
  maxEventPropCount: number;
  maxEventPropStringLength: number;
  sessionWindowMinutes: number;
}

export type HitKind = "pageview" | "event";

export type DeviceClass = "desktop" | "mobile" | "tablet" | "bot" | "unknown";

export type AnalyticsGranularity = "hour" | "day" | "month";

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

export type MetricName = "pageviews" | "visitors" | "events" | "bounce_rate" | "avg_duration_ms";

export type AnalyticsPermission =
  | "analytics.read"
  | "analytics.read.realtime"
  | "analytics.manage"
  | "analytics.goals.manage"
  | "analytics.export";

export type AnalyticsSinkKind = "local" | "forwarding";

export type VisitorSketch = Uint8Array;

export interface UtmParams {
  source: string | null;
  medium: string | null;
  campaign: string | null;
  term: string | null;
  content: string | null;
}

export interface IngestBeacon {

  host: string;

  path: string;

  referrer: string | null;

  kind: HitKind;

  eventName?: string;

  eventProps?: JsonObject;

  dnt?: boolean;
  gpc?: boolean;
}

export interface IngestContext {

  readonly ip: string;

  readonly userAgent: string;

  readonly acceptLanguage: string | null;

  readonly receivedAt: ISODateTime;
}

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

  visitorHash: string;

  sessionId: string;
  eventName: string | null;
  eventProps: JsonObject | null;
}

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

  createdByPluginId: string | null;

  expiresAt: ISODateTime;
}

export interface AnalyticsAggregateRow {
  workspaceId: UUID;
  granularity: AnalyticsGranularity;
  bucketStart: ISODateTime;
  dimension: DimensionName;
  dimensionValue: string;
  pageviews: number;
  events: number;

  visitorsSketch: VisitorSketch;

  bounces: number;

  totalDurationMs: number;
  updatedAt: ISODateTime;
}

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

export interface AnalyticsGoalDef {
  id: UUID;
  workspaceId: UUID;

  name: string;
  displayName: string;
  matchKind: "pageview_path" | "custom_event";

  matchValue: string;
  createdAt: ISODateTime;
}

export interface AnalyticsSiteConfig {
  workspaceId: UUID;
  enabled: boolean;
  honorDoNotTrack: boolean;
  honorGlobalPrivacyControl: boolean;

  rawRetentionDays: number;

  excludedPaths: readonly string[];

  excludedIpRanges: readonly string[];

  sink: AnalyticsSinkKind;
}

export type DimensionOverflowValue = "(other)";

export interface StatsFilter {
  dimension: DimensionName;
  value: string;
}

export interface StatsQuery {
  workspaceId: UUID;
  metric: MetricName;
  granularity: AnalyticsGranularity;
  from: ISODateTime;
  to: ISODateTime;

  breakdownBy?: DimensionName;
  filters?: readonly StatsFilter[];

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

export interface RealtimeSnapshot {
  workspaceId: UUID;
  windowSeconds: number;
  activeVisitors: number;
  pageviews: number;
  topPaths: readonly BreakdownRow[];
}

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

export interface AnalyticsDomainEventPayloads {
  "analytics.rollup.completed": RollupCompletedPayload;
  "analytics.goal.triggered": GoalTriggeredPayload;
}
