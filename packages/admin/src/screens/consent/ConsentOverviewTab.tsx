
import { adminHref } from "../../shell/lib/router.js";
import { consentProblemTab } from "./rules.js";
import type { ConsentReadiness } from "./settings.hooks.js";

import { type Translate } from '@jini-ai/core/text';
/**
 * @file Overview: is the banner live, what blocks publishing, and which scripts are declared and which sampled content remains unmanaged. Readiness checks the draft as if it were on, so blockers show before Publish.
 */

export interface ConsentOverviewTabProps {
  liveEnabled: boolean;
  hasUnpublished: boolean;
  readiness: ConsentReadiness | null;
  readinessError: string | null;
  t: Translate;
}

function StatusCard({ liveEnabled, hasUnpublished, t }: Pick<ConsentOverviewTabProps, "liveEnabled" | "hasUnpublished" | "t">) {
  return (
    <section className="jini-card jini-consent-card" aria-labelledby="consent-status-title">
      <div className="jini-card-head">
        <h2 id="consent-status-title" className="jini-card-title">{t("Banner")}</h2>
        <span className={`jini-status ${liveEnabled ? "jini-status-ok" : "jini-status-neutral"}`}>{liveEnabled ? t("On") : t("Off")}</span>
      </div>
      <p className="jini-card-lead">{liveEnabled ? t("Declared optional scripts wait for the required consent. Review unmanaged content separately.") : t("Visitors see no banner. Optional scripts run as usual.")}</p>
      {hasUnpublished && <p className="jini-consent-note">{t("You have changes that are not live yet.")}</p>}
    </section>
  );
}

function BlockersCard({ readiness, readinessError, t }: Pick<ConsentOverviewTabProps, "readiness" | "readinessError" | "t">) {
  const problems = readiness?.blockingProblems ?? [];
  return (
    <section className="jini-card jini-consent-card" aria-labelledby="consent-blockers-title">
      <h2 id="consent-blockers-title" className="jini-card-title">{t("Before you turn it on")}</h2>
      {readinessError && <p className="jini-notice jini-notice-error" role="alert">{readinessError}</p>}
      {!readiness && !readinessError && <p className="jini-card-lead">{t("Checking…")}</p>}
      {readiness && problems.length === 0 && <p className="jini-card-lead">{t("Nothing blocks the banner.")}</p>}
      {problems.length > 0 && (
        <ul className="jini-consent-problem-list">
          {problems.map((problem) => {
            const tab = consentProblemTab({ problem });
            return (
              <li key={`${problem.code ?? ""}:${problem.message}`}>
                <span>{problem.message}</span>
                {tab && <a className="jini-consent-fix-link" href={adminHref({ routePath: `/consent?tab=${tab}` })}>{t("Fix")}</a>}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function DeclarationsCard({ readiness, t }: Pick<ConsentOverviewTabProps, "readiness" | "t">) {
  if (!readiness) return null;
  return (
    <section className="jini-card jini-consent-card" aria-labelledby="consent-declarations-title">
      <h2 id="consent-declarations-title" className="jini-card-title">{t("Declared scripts")}</h2>
      <p className="jini-card-lead">{t("Declarations describe managed loading. They do not protect unmanaged page content.")}</p>
      {readiness.declarations.length === 0 && <p>{t("No script declarations were found in this sample.")}</p>}
      <ul>{readiness.declarations.map((script, index) => <li key={`${script.src}:${index}`}><code>{script.src}</code> — {script.consent?.length ? script.consent.join(", ") : t("Automatic")}</li>)}</ul>
      {readiness.truncated && <p className="jini-consent-note">{t("Only the first 200 items were checked.")}</p>}
    </section>
  );
}

function GapsCard({ readiness, t }: Pick<ConsentOverviewTabProps, "readiness" | "t">) {
  if (!readiness) return null;
  return (
    <section className="jini-card jini-consent-card" aria-labelledby="consent-gaps-title">
      <h2 id="consent-gaps-title" className="jini-card-title">{t("Unmanaged content")}</h2>
      <p className="jini-card-lead">{t("Review these gaps before moving an existing site. Stored pages are never converted automatically.")}</p>
      {readiness.warnings.length === 0 && <p>{t("No unmanaged content was found in this sample. Dynamic content still needs review.")}</p>}
      <ul>{readiness.warnings.map((warning, index) => <li key={`${warning.code}:${index}`}>{warning.message}{warning.source && <> <code>{warning.source}</code></>}</li>)}</ul>
    </section>
  );
}

export function ConsentOverviewTab(props: ConsentOverviewTabProps) {
  return (
    <div className="jini-consent-overview">
      <StatusCard liveEnabled={props.liveEnabled} hasUnpublished={props.hasUnpublished} t={props.t} />
      <BlockersCard readiness={props.readiness} readinessError={props.readinessError} t={props.t} />
      <DeclarationsCard readiness={props.readiness} t={props.t} />
      <GapsCard readiness={props.readiness} t={props.t} />
    </div>
  );
}
