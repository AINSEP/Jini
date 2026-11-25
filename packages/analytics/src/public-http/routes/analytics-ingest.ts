import type { JsonObject } from "@jini-ai/core/primitives";
import type { RouteInputContext } from "@jini-ai/core/contracts/server";
import type { IngestBeacon, IngestContext } from "@jini-ai/core/contracts/site/analytics";

import { ingestHit } from "../../index.js";
import type { AnalyticsForwardLimiter, BoundAnalyticsForwarder } from "../../forwarding.js";
import { createAnalyticsIngestBinding, type AnalyticsIngestRouteDeps } from "../../site/jini-adapters.js";
import type { BrowserAnalyticsSource, VisitorAnalyticsDeps } from "../../site/contracts.js";

/**
 * @file Public ingest beacon route spec for the `analytics` library (ADR-035 §5).
 *
 * Purpose:
 * `POST /_analytics/e` — the unauthenticated, first-party beacon endpoint a site's
 * pages call via `navigator.sendBeacon`. This is intentionally a SITE route (mirrors
 * `routes/site/pages.ts`), not an admin route: no session is required or checked here, by design
 * (ADR-035 §5 — the beacon must work for anonymous visitors).
 *
 * How it relates to the project:
 * - Delegates normalization/policy logic to the analytics ingest engine and owns the HTTP boundary: parsing the untrusted request body into an `IngestBeacon`, and
 *   pulling `ip`/`userAgent`/`acceptLanguage` off the request into an `IngestContext`.
 * - The response is ALWAYS `204 No Content`, regardless of `ingestHit`'s `{ accepted, reason }`
 *   result, and regardless of whether `ingestHit` itself throws. Leaking accept/reject (or a
 *   distinct error status) back to an anonymous caller would turn the beacon into an oracle for
 *   probing a site's exclusion rules, DNT/GPC handling, or PII-shape validation — the ADR's
 *   fire-and-forget beacon contract exists specifically to prevent that.
 * - Everything that belongs to one request (the consent-gated forwarders, the vendor-hook gate, the
 *   visitor pageview capture, the hostname and the client address) reaches the spec as a closure the
 *   host binds per request, so this spec never sees the transport's request object.
 */

/** Bounded input length caps applied at the HTTP boundary (secure-input-handling: untrusted body). */
const MAX_HOST_LENGTH = 253; // max valid DNS hostname length
const MAX_PATH_LENGTH = 2048;
const MAX_REFERRER_LENGTH = 2048;
const MAX_EVENT_NAME_LENGTH = 200;

/** The ingest ports the beacon reads (clock, sink, config, workspace lookup, seed, salt context, failure reporter, hooks). */
export type AnalyticsIngestPorts = Omit<AnalyticsIngestRouteDeps, keyof VisitorAnalyticsDeps | "forwarders" | "vendorHooksAllowed" | "browserAnalytics">;

/** The deps this route reads. Every request-bound value is a closure the host binds for THAT request. */
export interface AnalyticsIngestBeaconRouteDeps {
  readonly ingest: AnalyticsIngestPorts;
  /** One in-flight cap per mounted route, shared by every request's vendor calls (the host builds it once). */
  readonly limiter: AnalyticsForwardLimiter;
  /** The host's browser contribution; when it contributes, it owns vendor pageviews. */
  readonly browserAnalytics?: BrowserAnalyticsSource | undefined;
  /** This request's consent-checked vendor forwarders. Absent = the built-in sink alone. */
  readonly forwarders?: (() => Promise<readonly BoundAnalyticsForwarder[]>) | undefined;
  /** Whether this request's visitor consent lets plugin hooks run; only an exact `false` skips them. */
  readonly vendorHooksAllowed?: (() => Promise<boolean>) | undefined;
  /** Records a consent-gated visitor event for this request; the host owns consent and the sink. */
  readonly capturePageview: (required: { readonly name: string; readonly properties: Readonly<Record<string, string>> }) => void;
  /** This request's hostname, if the transport resolved one. */
  readonly hostname: () => string | undefined;
  /** This request's client address, if the transport resolved one. */
  readonly clientAddress: () => string | undefined;
}

/** A public raw route in the exact shape the server toolkit's raw spec mounts, kept structural so this
 *  domain package never imports the server toolkit. */
export interface AnalyticsPublicRawRoute<Deps> {
  readonly method: "post";
  readonly path: string;
  readonly readHeaders: readonly string[];
  handle(required: { readonly raw: RouteInputContext; readonly deps: Deps }, optional: { readonly signal: AbortSignal }): Promise<Response>;
}

/** Truncates an untrusted string field to a bounded length; non-strings coerce to `""`. */
function boundedString({ value, maxLength }: { value: unknown; maxLength: number }, _optional = {}): string {
  const str = typeof value === "string" ? value : "";
  return str.slice(0, maxLength);
}

/** True only for a plain JSON object (not an array, not `null`) — guards `eventProps`. */
function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Parses the untrusted POST body into an `IngestBeacon`. Every field is defensively coerced and
 * length-bounded — this body comes from an anonymous, unauthenticated client.
 *
 * @complexity O(1) (plus the bounded string truncation above).
 * @overallScore 100/100
 */
function parseBeacon({ body, fallbackHost }: { body: unknown; fallbackHost: string }, _optional = {}): IngestBeacon {
  const raw = (body ?? {}) as Record<string, unknown>;
  const host = boundedString({ value: raw.host, maxLength: MAX_HOST_LENGTH }) || fallbackHost;
  const referrer = typeof raw.referrer === "string" ? boundedString({ value: raw.referrer, maxLength: MAX_REFERRER_LENGTH }) : null;
  const kind = raw.kind === "event" ? "event" : "pageview";
  const eventName =
    kind === "event" && typeof raw.eventName === "string"
      ? boundedString({ value: raw.eventName, maxLength: MAX_EVENT_NAME_LENGTH })
      : undefined;

  return {
    host,
    path: boundedString({ value: raw.path, maxLength: MAX_PATH_LENGTH }),
    referrer,
    kind,
    ...(eventName === undefined ? {} : { eventName }),
    ...(isJsonObject(raw.eventProps) ? { eventProps: raw.eventProps } : {}),
    dnt: raw.dnt === true,
    gpc: raw.gpc === true,
  };
}

/** Builds the transient per-request context `ingestHit` consumes and then discards (no PII persisted). */
function buildContext({ headers, deps, receivedAt }: { headers: Readonly<Record<string, string>>; deps: AnalyticsIngestBeaconRouteDeps; receivedAt: string }, _optional = {}): IngestContext {
  return {
    ip: deps.clientAddress() ?? "",
    userAgent: headers["user-agent"] ?? "",
    acceptLanguage: headers["accept-language"] ?? null,
    receivedAt,
  };
}

/** The browser contribution owns vendor pageviews when present; private routes never emit them.
 * @complexity O(1), no mutation or network. */
function shouldCaptureVisitorPageview({ deps, beacon }: { deps: AnalyticsIngestBeaconRouteDeps; beacon: IngestBeacon }, _optional = {}): boolean {
  return !(deps.browserAnalytics?.({ surface: "site" }) ?? []).length && beacon.kind === "pageview" && !/^\/(admin|_preview|preview)(\/|$)/.test(beacon.path);
}

/**
 * Ingests one beacon through the host's ports; a thrown port surfaces to the caller's catch.
 * @complexity One consent read, one ingest, at most one visitor capture.
 */
async function ingestBeacon({ deps, beacon, context }: { deps: AnalyticsIngestBeaconRouteDeps; beacon: IngestBeacon; context: IngestContext }, _optional = {}): Promise<void> {
  // Never throws (fails toward no vendor); resolved before ingest because consent is per request.
  const forwarders = deps.forwarders ? await deps.forwarders() : [];
  const binding = createAnalyticsIngestBinding({ deps: deps.ingest }, { forwarders, limiter: deps.limiter, skipHooks: (await deps.vendorHooksAllowed?.()) === false });
  const outcome = await ingestHit({ input: { beacon, context }, deps: binding.deps }, binding.optional);
  if (outcome.accepted && shouldCaptureVisitorPageview({ deps, beacon })) {
    deps.capturePageview({ name: "site_pageview", properties: { routeTemplate: "/:path" } });
  }
}

/**
 * `POST /_analytics/e`. Mount it with request-bound deps (see {@link AnalyticsIngestBeaconRouteDeps}).
 * @complexity O(1) plus the ingest ports.
 */
export const analyticsIngestRoute: AnalyticsPublicRawRoute<AnalyticsIngestBeaconRouteDeps> = {
  method: "post",
  path: "/_analytics/e",
  readHeaders: ["dnt", "sec-gpc", "user-agent", "accept-language"],
  handle: async ({ raw, deps }) => {
    const headers = raw.headers ?? {};
    // Browser headers are authoritative even if the body omits or contradicts its privacy signal.
    if (headers.dnt === "1" || headers["sec-gpc"] === "1") return new Response(null, { status: 204 });
    const receivedAt = new Date(deps.ingest.clock.nowMs()).toISOString();
    const beacon = parseBeacon({ body: raw.body, fallbackHost: deps.hostname() ?? "" });
    const context = buildContext({ headers, deps, receivedAt });

    try {
      await ingestBeacon({ deps, beacon, context });
    } catch {
      // Never let an ingest-side failure surface to the public beacon caller — see file header.
    }

    // Always 204, regardless of accept/reject or failure above (ADR-035 §5 — no oracle).
    return new Response(null, { status: 204 });
  },
};
