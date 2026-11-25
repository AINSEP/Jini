import { defineJsonRoute, ok, type JsonRouteAuthorize } from "@jini-ai/core/contracts/server";
import type { DeviceClass, HitKind, NormalizedHit } from "@jini-ai/core/contracts/site/analytics";

import type { AnalyticsSinkPort } from "../../site/ports.js";

/**
 * @file Admin "recent hits" read route spec for the `analytics` library (ADR-035, ADR-PIPE-014).
 *
 * Purpose:
 * `GET /api/admin/v1/workspaces/:workspaceId/analytics/recent-hits` — an authenticated,
 * `analytics.read`-gated read straight over the ingest-side `AnalyticsSinkPort`'s raw hit buffer
 * (`SqliteBufferSink` in real composition, `LocalBufferSink` in hermetic composition).
 *
 * IMPORTANT — this is deliberately NOT a dashboard. Only the ingest half of ADR-035 is built
 * (beacon → normalize → `LocalBufferSink`); there is no rollup/aggregation/time-series query layer
 * yet (that is Tier-3, explicitly deferred). So this route can only ever return a raw recent-hits
 * list — no totals, no breakdowns, no charts. Do not read more into the response shape than that.
 *
 * How it relates to the project:
 * - The host mounts every admin route behind its session gate and workspace guard; that only
 *   proves *authentication*. FEAT-014/ADR-PIPE-014 closes the remaining *authorization* gap: this
 *   route previously had zero per-action authorization call, unlike every sibling admin route.
 *   The workspace-id 404 check runs first, then the authorize call below — see ADR-PIPE-014
 *   Decision §1/Enforcement.
 * - The canonical analytics error envelope (workspace 404, authorize 403, redacted 500) is the
 *   host's: this spec only refuses with `rejectRoute` / rethrows, and the host writes the wire.
 */

/** The permission this route asks the host's authorizer for. */
export const ANALYTICS_READ = "analytics.read";

/** The deps this route reads: the workspace it serves and the ingest sink's `list`. */
export interface AnalyticsRecentHitsRouteDeps {
  workspaceId: string;
  analyticsSink: Pick<AnalyticsSinkPort, "list">;
}

/** The principal fields this route reads: none (the host authorizes on the principal itself). */
export interface AnalyticsRoutePrincipal { id: string }

/** The bounded, honest subset of a `NormalizedHit` this screen shows — raw ingest fields only. */
export interface AdminAnalyticsHitResponse {
  occurredAt: string;
  kind: HitKind;
  path: string;
  referrerHost: string | null;
  deviceClass: DeviceClass;
  browserFamily: string | null;
  eventName: string | null;
}

function toAdminAnalyticsHitResponse({ hit }: { hit: NormalizedHit }, _optional = {}): AdminAnalyticsHitResponse {
  return {
    occurredAt: hit.occurredAt,
    kind: hit.kind,
    path: hit.path,
    referrerHost: hit.referrerHost,
    deviceClass: hit.deviceClass,
    browserFamily: hit.browserFamily,
    eventName: hit.eventName,
  };
}

/**
 * Parses the `?limit=` query param into a finite number, or `undefined` when absent/unparsable —
 * the sink's `list()` owns the actual clamping/default, this just guards against handing it a
 * non-numeric string.
 */
function parseLimitParam({ raw }: { raw: unknown }, _optional = {}): number | undefined {
  if (typeof raw !== "string" || raw.trim() === "") return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/** Ask the host's authorizer for `analytics.read`; a mount without one is a wiring bug. @complexity O(1) plus the authorizer. */
async function authorizeAnalyticsRead({ authorize }: { authorize: JsonRouteAuthorize | undefined }, _optional = {}): Promise<void> {
  if (!authorize) throw new Error("analytics admin route has no authorizer");
  await authorize({ permission: ANALYTICS_READ, entityType: "analytics-hit" });
}

/** GET the ingest buffer's most recent hits, newest first (the sink owns ordering and the limit clamp). */
export const analyticsRecentHitsRoute = defineJsonRoute<{ limit: number | undefined }, { hits: AdminAnalyticsHitResponse[] }, AnalyticsRecentHitsRouteDeps, AnalyticsRoutePrincipal>({
  method: "get",
  path: "/api/admin/v1/workspaces/:workspaceId/analytics/recent-hits",
  parse: (raw) => ok({ value: { limit: parseLimitParam({ raw: raw.query.limit }) } }),
  handle: async ({ input, deps, authorize }) => {
    await authorizeAnalyticsRead({ authorize });
    const hits = (await deps.analyticsSink.list({}, input.limit === undefined ? {} : { limit: input.limit })).map((hit) => toAdminAnalyticsHitResponse({ hit }));
    return ok({ value: { hits } });
  },
});
