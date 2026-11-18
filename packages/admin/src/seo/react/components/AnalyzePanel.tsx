import { useAnalyzePanel } from "../hooks/SeoPage.hooks.js";
import { useSeoCopy } from "../hooks/SeoPorts.hooks.js";
import type { SeoEntryAnalysis } from "../../models.js";

/** Status-chip modifier for an issue: errors read as failures, warnings as warnings, anything else as success. */
function issueStatusClass(severity: string): string {
  if (severity === "error") return "failure";
  return severity === "warning" ? "warning" : "success";
}

/** Read-only score + issues view (REQ-07) — exact field names read off `SeoAnalysis`/`SeoIssue`
 * (`src/seo/types.ts`), not guessed. No state of its own — only the severity sort, which lives in
 * `rules.ts` as `sortIssuesBySeverity`. */
export function AnalyzePanel(props: { locale: string; analysis: SeoEntryAnalysis }) {
  const t = useSeoCopy();
  const { locale } = props;
  const { sortedIssues, tone } = useAnalyzePanel({ analysis: props.analysis });

  /* Heading + score pill on one line, issues as a compact list (owner, 2026-10-15: the bare
     "Score: 100 / No issues." read as unstyled text). The pill reuses the issue pills' status
     tones, so the score and the issues under it speak one colour language. */
  return (
    <section className="jini-seo-analyze-panel" aria-labelledby="seo-analysis-heading">
      <div className="jini-seo-analyze-head">
        <h3 id="seo-analysis-heading">{t({ locale: locale, key: "Analysis" })}</h3>
        <span className={`jini-status jini-status-${tone} jini-seo-score`}>
          {t({ locale: locale, key: "Score:" })} <strong>{props.analysis.score}</strong>
        </span>
      </div>
      {sortedIssues.length === 0 ? (
        <p className="jini-seo-analyze-empty">{t({ locale: locale, key: "No issues." })}</p>
      ) : (
        <ul className="jini-seo-issues">
          {sortedIssues.map((issue, i) => (
            <li key={`${issue.code}-${i}`} className="jini-seo-issue">
              <span className={`jini-status jini-status-${issueStatusClass(issue.severity)}`}>
                {issue.severity}
              </span>
              <span className="jini-seo-issue-text">
                {issue.message}
                {issue.field ? <span className="jini-muted-cell"> ({issue.field})</span> : null}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
