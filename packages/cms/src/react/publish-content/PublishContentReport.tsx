import { agentHandle } from "@jini-ai/core/agent-handles";
import type { Translate } from "@jini-ai/core/text";
import { PublishContentReportRow } from "@jini-ai/cms/publish/content/ui/PublishContentReportRow";
import type { PublishContentConfirmView } from "./hooks/publish-confirm-view.js";

interface PublishContentSectionProps {
  view: PublishContentConfirmView;
  t: Translate;
}

export function PublishContentNotices({ view, t }: PublishContentSectionProps, _optional = {}) {
  return (
    <>
      {view.connectOffer && <p className="notice">{view.connectOffer.message}</p>}
      {view.refusalReason && (
        <p className="notice error" role="alert">
          {view.refusalReason}
        </p>
      )}
      {view.errorMessage && (
        <p className="notice error" role="alert">
          {view.errorMessage}
        </p>
      )}
      {view.doneMessage && (
        <p className="notice" role="status">
          {view.doneMessage}
        </p>
      )}
      {view.doneNotices.map((line) => (
        <p key={line} className="notice">
          {line}
        </p>
      ))}
      {view.doneProblems.length > 0 && (
        <div className="notice error" role="alert">
          <p>{t("Published, but these won't show correctly on the live site:")}</p>
          <ul>
            {view.doneProblems.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
      )}
      {view.liveGapNotices.map((line) => (
        <p key={line} className="notice publish-content-live-gap" role="status">
          {line}
        </p>
      ))}
    </>
  );
}

/** The optional count summary describes the displayed plan, including skipped rows. */
function PublishReportSummary({ summary, t }: { summary: PublishContentConfirmView["summary"]; t: Translate }, _optional = {}) {
  if (!summary) return null;
  return <p className="muted publish-content-summary">
    {summary.publishing} {t("to publish")} · {summary.unchanged} {t("unchanged")} ·{" "}{summary.skipped} {t("skipped")}
  </p>;
}

export function PublishContentReport({ view, t }: PublishContentSectionProps, _optional = {}) {
  // publish-overwrite-live-plan §4/S9. The column exists only while the peer this plan targets can
  // honour a forced overwrite AND at least one row is offering one — decided in the hook.
  const { showOverwriteColumn } = view;

  if (view.rows.length === 0) return null;
  return (
    <>
      <div className="table-scroll publish-content-report">
        <table className="list-table">
          {renderPublishReportHead({ view, t, showOverwriteColumn })}
          {renderPublishReportRows({ view, t })}
        </table>
      </div>
      <PublishReportSummary summary={view.summary} t={t} />
      {view.overwriteWarning && (
        <p className="notice publish-content-overwrite-warning" role="status">
          {view.overwriteWarning}
        </p>
      )}
      {view.overwriteMismatch && (
        <p className="notice error" role="alert">
          {view.overwriteMismatch}
        </p>
      )}
      {view.overwriteUnavailable && (
        <p className="notice publish-content-overwrite-unavailable">{view.overwriteUnavailable}</p>
      )}
    </>
  );
}

function renderPublishReportRows(
  { view, t }:
    Pick<PublishContentSectionProps, "view" | "t">
, _optional = {}) {
  return (
    <tbody>
      {view.listedRows.map((row) => <PublishContentReportRow key={row.key} row={row} view={view} t={t} />)}
      {view.upToDateLabel && (
        <tr className="publish-content-up-to-date">
          <td colSpan={view.columnCount}>
            <button
              type="button"
              className="link-button"
              aria-expanded={view.upToDateExpanded}
              onClick={view.onToggleUpToDate}
              data-publish-up-to-date-toggle=""
              {...agentHandle(
                { handle: "dashboard-publish-content-up-to-date" },
                {
                  role: "button",
                  label: "Show or hide the items that are already up to date",
                }
              )}
            >
              {view.upToDateLabel}
            </button>
          </td>
        </tr>
      )}
      {view.upToDateExpanded && view.upToDateRows.map((row) => <PublishContentReportRow key={row.key} row={row} view={view} t={t} />)}
    </tbody>
  );
}

function renderPublishReportHead(
  { view, t, showOverwriteColumn }:
    Pick<PublishContentSectionProps, "view" | "t"> &
    Pick<PublishContentSectionProps["view"], "showOverwriteColumn">
, _optional = {}) {
  return (
    <thead>
      <tr>
        <th className="publish-content-select">
          <input
            type="checkbox"
            checked={view.allSelected}
            // React has no `indeterminate` prop — the partial state is a DOM property
            // only, so it is set on the node itself every render.
            ref={(node) => {
              if (node) node.indeterminate = view.someSelected;
            }}
            disabled={!view.selectionEnabled || view.rows.every((row) => !row.selectable)}
            onChange={view.onToggleAll}
            aria-label={t("Publish every item that can be published")}
            {...agentHandle(
              { handle: "dashboard-publish-content-select-all" },
              {
                role: "field",
                label: "Check or uncheck every publishable row at once",
              }
            )}
          />
        </th>
        <th>{t("Type")}</th>
        <th>{t("Item")}</th>
        <th>{t("What happens")}</th>
        {showOverwriteColumn && renderPublishOverwriteHeader({ view, t })}
      </tr>
    </thead>
  );
}

function renderPublishOverwriteHeader(
  { view, t }:
    Pick<Parameters<typeof renderPublishReportHead>[0], "view" | "t">
, _optional = {}) {
  return (
    <th className="publish-content-overwrite">
      <input
        type="checkbox"
        checked={view.allOverwriteTicked}
        // Same DOM-only indeterminate handling as the select-all box above — React
        // has no prop for it.
        ref={(node) => {
          if (node) node.indeterminate = view.someOverwriteTicked;
        }}
        disabled={!view.selectionEnabled}
        onChange={view.onToggleAllOverwrite}
        aria-label={t("Overwrite every item that can replace something on live")}
        {...agentHandle(
          { handle: "dashboard-publish-content-overwrite-all" },
          {
            role: "field",
            label: "Check or uncheck every 'Overwrite on live' row at once",
          }
        )}
      />{" "}
      {t("Overwrite on live")}
    </th>
  );
}
