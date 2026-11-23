
import { DataTable } from "../../react/index.js";
import { adminHref } from "../../shell/lib/router.js";
import type { AnalyticsController } from "./hooks/use-analytics.hooks.js";

import { formatTimestamp } from '@jini-ai/core/text';
import { VIEWER_TIME_ZONE } from "../../shell/lib/viewer-time-zone.js";
/**
 * @file Admin "Analytics" screen (ADR-035 ingest half only) — markup only.
 *
 * IMPORTANT — honesty note: this is a raw recent-hits list, NOT a dashboard. There is no
 * rollup/aggregation/time-series layer built yet (that's a later Tier-3 build per the ADR) — so
 * there are no totals, charts, or breakdowns here on purpose. Do not read the absence of
 * aggregates as a bug in this screen.
 *
 * The on-screen notice used to also claim the hits were "sitting in memory". That was false on a
 * real install: the host's server dependencies bind `SqliteBufferSink` (a durable table, no
 * eviction), and the in-memory `LocalBufferSink` is only ever reached under the host's in-memory
 * database mode. The copy no longer makes any storage claim — only the aggregation claim, which
 * is still true.
 *
 * Mirrors `features/posts/Posts.tsx`'s fetch/loading/error/empty-state shape. State and the fetch
 * live in `hooks/use-analytics.hooks.ts`.
 */
export interface AnalyticsProps {
  /**
   * The screen's controller hook — the same convention `Posts.tsx`'s `usePostsHook` uses. REQUIRED:
   * the host composes it from `useAnalytics` with its own port and its admin-locale hook (owner
   * rule: a host hook reaches this package only as a prop), and a test passes a stub.
   */
  useAnalyticsHook: () => AnalyticsController;
}

export function Analytics({ useAnalyticsHook }: AnalyticsProps, _optional: Record<string, never> = {}) {
  const { hits, error, t } = useAnalyticsHook();

  if (error) return <div className="jini-notice jini-notice-error">{error}</div>;
  if (!hits) return <div className="jini-notice">{t({ key: "Loading recent hits…" })}</div>;

  return (
    <div className="jini-page">
      <div className="jini-page-header">
        <div className="jini-page-header-text">
          <p className="jini-page-kicker">{t({ key: "Marketing" })}</p>
          <h1 className="jini-page-title">{t({ key: "Analytics" })}</h1>
          <p className="jini-page-description">{t({ key: "The most recent pageviews and events captured on this site." })}</p>
        </div>
        {/* Which visitors may be tracked is set in Cookie Consent, so link it from here. */}
        <div className="jini-page-actions">
          <a className="jini-btn-secondary" href={adminHref({ routePath: "/consent" })}>{t({ key: "Cookie Consent" })}</a>
        </div>
      </div>
      <div className="jini-notice">
        {t({ key: "Each visit is listed on its own row, newest first. This is not a summary — there are no totals, trends, or breakdowns to compare traffic over time yet." })}
      </div>

      <DataTable
        rows={hits}
        rowKey={(hit, index) => `${hit.occurredAt}-${index}`}
        empty={
          <div className="jini-card">
            <div className="jini-empty-state">
              <p className="jini-empty-state-title">{t({ key: "No hits recorded yet." })}</p>
              <p className="jini-empty-state-hint">{t({ key: "Once the site beacon starts sending traffic, recent hits will appear here." })}</p>
            </div>
          </div>
        }
        columns={[
          { key: "path", header: t({ key: "Path" }), cell: (hit) => hit.path },
          { key: "referrer", header: t({ key: "Referrer" }), cell: (hit) => hit.referrerHost ?? t({ key: "(direct)" }) },
          {
            key: "device",
            header: t({ key: "Device / Browser" }),
            cell: (hit) => (
              <>
                {hit.deviceClass}
                {hit.browserFamily ? ` / ${hit.browserFamily}` : ""}
              </>
            ),
          },
          { key: "kind", header: t({ key: "Kind" }), cell: (hit) => (hit.eventName ? `${t({ key: "event:" })} ${hit.eventName}` : hit.kind) },
          { key: "time", header: t({ key: "Time" }), cell: (hit) => formatTimestamp({ iso: hit.occurredAt }, { viewerTimeZone: VIEWER_TIME_ZONE }) },
        ]}
      />
    </div>
  );
}
