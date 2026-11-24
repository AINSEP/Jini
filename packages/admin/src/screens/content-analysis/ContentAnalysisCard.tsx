import { agentHandle } from "@jini-ai/core/agent-handles";
import type { ContentAnalysisController, ContentAnalysisTarget, UseContentAnalysisHook } from "./hooks/use-content-analysis.hooks.js";

/**
 * @file The post editor's Content analysis card — the admin surface of the `content-analyzer`
 * built-in plugin (AW-7 Tier 2). Markup only: whether it shows, which analysis it shows and every
 * string in it come from `hooks/use-content-analysis.hooks.ts` and `rules.ts`.
 *
 * Core admin code rather than a plugin-provided panel because no plugin admin-UI surface exists yet
 * (see `ADS-memory/.local-artifacts/aw7-tier2/dx-pain.md`). Mounted by the host's post editor beside
 * the Categories & Tags box; renders nothing unless the plugin is enabled.
 *
 * Renders only `jini-content-analysis-*` classes; the host styles them (e.g. as aliases of its own
 * card, button, stat and status-pill rules).
 */
export function ContentAnalysisCard({
  useContentAnalysisHook,
  ...props
}: ContentAnalysisTarget & {
    /** The host's wired hook (`useContentAnalysis` bound to its live preview port and locale) —
     *  required, so the card never reaches the host's transport itself; tests pass
     *  `useContentAnalysis` composed with `createFakeContentAnalysisPort`. */
    useContentAnalysisHook: UseContentAnalysisHook;
  }) {
  const { hidden, view, analyzing, error, analyze, t } = useContentAnalysisHook({
    post: props.post,
    title: props.title,
    bodyJson: props.bodyJson,
  });

  if (hidden) return null;

  return (
    <section className="jini-content-analysis-card jini-content-analysis" aria-labelledby="content-analysis-title">
      <h3 id="content-analysis-title" className="jini-content-analysis-title">
        {t("Content analysis")}
      </h3>
      <p className="jini-content-analysis-lead" aria-live="polite">
        {view.lead}
      </p>
      {renderContentAnalysisReport({ view, t })}
      <span className="jini-content-analysis-editor-actions jini-content-analysis-actions">
        <button
          type="button"
          className="jini-content-analysis-btn-secondary"
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
          <span className="jini-content-analysis-save-error" role="alert">
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
            <span className="jini-content-analysis-stat-label">{stat.label}</span>
            <span className="jini-content-analysis-stat-value">{stat.value}</span>
            <span className="jini-content-analysis-stat-meta">{stat.meta}</span>
          </li>
        ))}
      </ul>
      <h4 id="content-analysis-toc" className="jini-content-analysis-field-label">
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
        <p className="jini-content-analysis-field-hint">{t("No headings yet.")}</p>
      )}
      <h4 id="content-analysis-checks" className="jini-content-analysis-field-label">
        {t("Checks")}
      </h4>
      <ul className="jini-content-analysis-list" aria-labelledby="content-analysis-checks">
        {view.report.checks.map((check) => (
          <li key={check.key} className="jini-content-analysis-check">
            {/* Status is the pill's TEXT; the icon is decorative and the tone only reinforces it. The
                rules' `status-*` tone becomes `jini-content-analysis-status-*`. */}
            <span className={`jini-content-analysis-status jini-content-analysis-${check.tone}`}>
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
