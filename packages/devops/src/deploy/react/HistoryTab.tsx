import type { ReactNode } from "react";
import type { AgentHandleOptions, AgentHandleProps } from "@jini-ai/core/agent-handles";

/**
 * @file History tab — a real empty state, no fake data. There is no builds/deploys backend this
 * screen can reach. The Full Site tab and never-written deployment table reader were retired
 * on 2026-10-03; this placeholder does not fetch plugin deploys or static publish history.
 *
 * ## Second pass (2026-08-15) — what changed and why
 *
 * It was two grey sentences centered in a tall blank card. That is what `.empty-state` gives you,
 * and it is the right default for a list that merely happens to be empty right now — Media with
 * nothing uploaded, Integrations with no webhooks. This tab is a different thing: the feature does
 * not exist yet, and it will not fill up by itself. An empty state for a durable condition has to
 * do more than say "nothing here", or it reads as an unfinished screen rather than an honest one.
 *
 * So: a mark, a title, one sentence saying what WOULD appear here, and a real next step pointing at
 * the thing that does exist today. What it deliberately does NOT do is draw an empty table header,
 * a filter bar, or a set of placeholder rows — scaffolding for data that has never existed would
 * imply a capability this instance does not have.
 */
export interface HistoryTabProps {
  useAdminLocaleHook: (
    required: Record<string, never>, optional?: Record<string, never>,
  ) => string;
  t: (required: { locale: string; key: string }, optional?: Record<string, never>) => string;
  historyIcon: ReactNode;
  publishHref: string;
  agentHandle: (
    required: { handle: string }, optional?: AgentHandleOptions,
  ) => AgentHandleProps;
}

export function HistoryTab({ useAdminLocaleHook, t, historyIcon, publishHref, agentHandle }: HistoryTabProps) {
  const locale = useAdminLocaleHook({});
  return (
    <div className="deployment-tab">
      <div
        className="card"
        {...agentHandle({ handle: "deployment-history-empty" }, {
          role: "region",
          label: "No deploys yet — history has nothing to show because no host is wired up to deploy from",
        })}
      >
        <div className="deployment-empty">
          <span className="deployment-empty-mark">
            {historyIcon}
          </span>
          {/* A real `<h2>`, not a styled `<p>`: this is the only heading in the tab's region, and a
              screen-reader user navigating by heading would otherwise find the tab panel empty of
              structure entirely (confirmed live — this tab's heading list was `H1` and nothing
              else). `.deployment-empty-title` supplies the size, so the element choice is free to
              be the semantically correct one. */}
          <h2 className="deployment-empty-title">{t({ locale: locale, key: "No deploys yet" })}</h2>
          <p className="deployment-empty-body">
            {t({ locale: locale, key: "Nothing has been deployed from this screen — and nothing can be yet. Once a host is wired up, every build and deploy will be listed here with its outcome." })}
          </p>
          <a
            className="btn-secondary"
            href={publishHref}
            {...agentHandle({ handle: "deployment-history-publish-link" }, {
              role: "link",
              label: "Open the Static Site tab to see how to publish today",
            })}
          >
            {t({ locale: locale, key: "See how to publish today" })}
          </a>
        </div>
      </div>
    </div>
  );
}
