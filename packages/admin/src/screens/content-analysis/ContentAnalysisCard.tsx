import { agentHandle } from "@jini-ai/core/agent-handles";
import type { ContentAnalysisPort } from "./hooks/content-analysis-port.hooks.js";
import { useContentAnalysis, type ContentAnalysisController, type ContentAnalysisTarget } from "./hooks/use-content-analysis.hooks.js";

/**
 * @file The post editor's Content analysis card — the admin surface of the `content-analyzer`
 * built-in plugin (AW-7 Tier 2). Markup only: whether it shows, which analysis it shows and every
 * string in it come from `hooks/use-content-analysis.hooks.ts` and `rules.ts`.
 *
 * Core admin code rather than a plugin-provided panel because no plugin admin-UI surface exists yet.
 * Mounted by the host's post editor beside the Categories & Tags box; renders nothing unless the
 * plugin is enabled.
 *
 * Everything host-bound arrives as a REQUIRED prop: `port` (the preview routes, built with the
 * host's request client) and `useAdminLocale` (the host's locale hook). Nothing here defaults them.
 */

/** The host's admin-locale hook: returns the operator's resolved admin locale (e.g. `"es"`). */
export type UseContentAnalysisLocale = () => string;

export interface ContentAnalysisCardProps extends ContentAnalysisTarget {
  /** The live preview-status / preview routes — the host binds them with its request client. */
  port: ContentAnalysisPort;
  /** The host's admin-locale hook, called once per render. */
  useAdminLocale: UseContentAnalysisLocale;
}

export function ContentAnalysisCard({ port, useAdminLocale, ...props }: ContentAnalysisCardProps) {
  const locale = useAdminLocale();
  const controller = useContentAnalysis({ post: props.post, title: props.title, bodyJson: props.bodyJson }, { port, locale });
  return <ContentAnalysisCardView controller={controller} />;
}

/** The card's markup for one controller state — exported so a test can drive each state directly. */
export function ContentAnalysisCardView({ controller }: { controller: ContentAnalysisController }) {
  const { hidden, view, analyzing, error, analyze, t } = controller;

  if (hidden) return null;

  return (
    <section className="card jini-content-analysis" aria-labelledby="content-analysis-title">
      <h3 id="content-analysis-title" className="card-title">
        {t("Content analysis")}
      </h3>
      <p className="card-lead" aria-live="polite">
        {view.lead}
      </p>
      {renderContentAnalysisReport({ view, t })}
      <span className="editor-actions jini-content-analysis-actions">
        <button
          type="button"
          className="btn-secondary"
          onClick={() => void analyze()}
          disabled={analyzing}
          {...agentHandle({ handle: "content-analysis-analyze" }, {
            role: "button",
            label: "Analyze this post's current, unsaved title and body for SEO, readability, word count, reading time, headings and image alt text",
          })}
        >
          {analyzing ? t("Analyzing…") : t("Analyze now")}
        </button>
        {error ? (
          <span className="save-error" role="alert">
            {error}
          </span>
        ) : null}
      </span>
    </section>
  );
}

function renderContentAnalysisReport(
  { view, t }:
    Pick<ContentAnalysisController, "view" | "t">
) {
  return view.report ? (
    <>
      <ul className="jini-content-analysis-stats">
        {view.report.stats.map((stat) => (
          <li key={stat.key} className="jini-content-analysis-stat">
            <span className="dash-stat-label">{stat.label}</span>
            <span className="dash-stat-value">{stat.value}</span>
            <span className="dash-stat-meta">{stat.meta}</span>
          </li>
        ))}
      </ul>
      <h4 id="content-analysis-toc" className="field-label">
        {t("Table of contents")}
      </h4>
      {view.report.toc.length > 0 ? (
        <ul className="jini-content-analysis-list" aria-labelledby="content-analysis-toc">
          {view.report.toc.map((entry) => (
            <li key={entry.key} style={{ paddingInlineStart: `${entry.indentRem}rem` }}>
              <span className="jini-content-analysis-toc-level">{entry.levelLabel}</span>
              {entry.text}
            </li>
          ))}
        </ul>
      ) : (
        <p className="field-hint">{t("No headings yet.")}</p>
      )}
      <h4 id="content-analysis-checks" className="field-label">
        {t("Checks")}
      </h4>
      <ul className="jini-content-analysis-list" aria-labelledby="content-analysis-checks">
        {view.report.checks.map((check) => (
          <li key={check.key} className="jini-content-analysis-check">
            {/* Status is the pill's TEXT; the icon is decorative and the tone only reinforces it. */}
            <span className={`status ${check.tone}`}>
              <span aria-hidden="true">{check.icon}</span> {check.statusLabel}
            </span>
            <strong>{check.title}</strong>
            <span>{check.message}</span>
          </li>
        ))}
      </ul>
    </>
   ) : null;
}
