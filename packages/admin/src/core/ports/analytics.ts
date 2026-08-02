/**
 * @file `AdminAnalyticsPort` — a rolling window of recent traffic hits, for a live-ish activity
 * view rather than aggregate reporting.
 *
 * Deliberately the thinnest port in the set (one method, no mutation, no pagination cursor). Tovu's
 * reference route returns a bounded recent-hits list, not a queryable analytics store — there is no
 * date-range filter, no aggregation, and no historical query on the contract because the reference
 * implementation has none of those either. A host that needs real analytics reporting (rollups,
 * date ranges, funnels, ...) needs a different, dedicated port; stretching this one to cover that
 * by adding options over time would blur "recent activity feed" into "analytics platform", which
 * is a materially different feature with different performance and retention expectations.
 */

/** One traffic event — either a page view or a named custom event. */
export interface AdminAnalyticsHit {
  readonly occurredAt: string;
  readonly kind: "pageview" | "event";
  readonly path: string;
  /** Null when there was no referrer (direct navigation) or the host could not determine one. */
  readonly referrerHost: string | null;
  readonly deviceClass: "desktop" | "mobile" | "tablet" | "bot" | "unknown";
  /** Null when the host could not classify the browser (e.g. an unrecognized or absent
   *  user-agent). */
  readonly browserFamily: string | null;
  /** Set only for `kind: "event"`; null for a plain pageview. */
  readonly eventName: string | null;
}

export interface AdminAnalyticsPort {
  /** `limit` bounds how many recent hits come back; omitting it defers to the host's own default
   *  bound rather than requesting an unbounded list — see the file header on why this is a recent
   *  activity feed, not a queryable store. */
  listRecentAnalyticsHits(options?: { limit?: number }): Promise<readonly AdminAnalyticsHit[]>;
}
