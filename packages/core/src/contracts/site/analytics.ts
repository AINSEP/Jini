/**
 * @file The analytics ingest shapes a host's beacon route and sink adapters share, as types only.
 *
 * An additive copy of the declarations in `@jini-ai/analytics` (`types.ts`); that package keeps its
 * identical declarations and exports until the paired cutover.
 */
import type { ISODateTime } from '../../primitives/time.js';
import type { JsonObject } from '../../primitives/json.js';
import type { UUID } from '../../primitives/ids.js';

/** Kind of a recorded hit. `event` covers custom/goal events; `pageview` is the default. */
export type HitKind = "pageview" | "event";

/** Coarse device classification derived from UA at ingest (UA then discarded). */
export type DeviceClass = "desktop" | "mobile" | "tablet" | "bot" | "unknown";

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
