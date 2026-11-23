import { agentHandle } from "@jini-ai/core/agent-handles";

import { CheckIcon, ChevronIcon, CopyIcon } from "./observability-visuals.js";
import type { RecentServerErrorRow, RecentServerErrorsController } from "./hooks/use-recent-server-errors.hooks.js";

import { type Translate } from '@jini-ai/core/text';
/** What one row's state hook receives: the row's paste-ready text and the shared clipboard. */
export interface RecentErrorItemDependencies {
  /** The row's paste-ready text (`RecentServerErrorRow.copyText`). */
  copyText: string;
  clipboard: RecentServerErrorsController["clipboard"];
}

/** One row's state: whether its full message is shown, and its Copy button's "Copied" feedback. */
export interface RecentErrorItemController {
  expanded: boolean;
  toggle: () => void;
  /** `id` of the detail region, for the toggle's `aria-controls`. */
  detailId: string;
  /** True for a moment after a successful copy. */
  copied: boolean;
  /** Copies the row's text; resolves whether the browser accepted it. */
  copy: () => Promise<boolean>;
}

/** The host's per-row hook (its copy-to-clipboard feedback lives in the host's UI library). */
export type RecentErrorItemHook = (required: RecentErrorItemDependencies) => RecentErrorItemController;

/** The host-bound list hook for this tab. */
export type RecentServerErrorsHook = () => RecentServerErrorsController;

/**
 * Recent errors tab (gap A-04, slice L2): the newest server error lines, the same data the
 * `system_read_server_logs` chat tool returns. Markup only — state lives in
 * `use-recent-server-errors.hooks.ts` (list) and the host's injected row hook (one row). The
 * hook is called HERE, not in `Observability.tsx`, so the read only happens when this tab is opened.
 *
 * Owner pass 2026-10-08 ("This looks awful… maybe an accordion to show the full error, and a copy
 * button"): each distinct error is a collapsed one-line row (time, source, summary, ×N when
 * repeated) that opens to the full message with shortened paths; Copy puts a paste-ready block on
 * the clipboard.
 */
export function RecentErrorsPanel(props: { useRecentServerErrorsHook: RecentServerErrorsHook; useRecentErrorItemHook: RecentErrorItemHook }) {
  // Host hooks are required props, called through `props` (never imported or defaulted).
  const { useRecentErrorItemHook } = props;
  const controller = props.useRecentServerErrorsHook();
  const { rows, logs, loading, error, refresh, clipboard, t } = controller;

  return (
    <section className="jini-settings-section jini-observability-errors" aria-label={t("Recent server errors")}>
      <div className="jini-observability-errors-toolbar">
        <p className="jini-observability-lede">
          {t("The newest errors this site's server logged, including its assistant. Secret values are hidden.")}
        </p>
        <button
          type="button"
          className="jini-button jini-observability-errors-refresh"
          onClick={refresh}
          disabled={loading}
          {...agentHandle({ handle: "observability-errors-refresh" }, { role: "button", label: "Reload recent server errors" })}
        >
          {t("Refresh")}
        </button>
      </div>

      {error ? <p className="jini-observability-alert" role="alert">{error}</p> : null}
      {loading && !logs ? <p role="status">{t("Loading recent errors…")}</p> : null}
      <RecentErrorsCaptureStatus logs={logs} empty={rows.length === 0} t={t} />

      {rows.length > 0 ? (
        <ol className="jini-observability-errors-list" {...agentHandle({ handle: "observability-errors-list" }, { role: "list", label: "Recent server errors, newest first" })}>
          {rows.map((row) => (
            <RecentErrorItem key={row.key} row={row} clipboard={clipboard} t={t} useRecentErrorItemHook={useRecentErrorItemHook} />
          ))}
        </ol>
      ) : null}
    </section>
  );
}

/** Independent capture, empty-list and truncation notices; cached logs remain visible on refresh. */
function RecentErrorsCaptureStatus({ logs, empty, t }: { logs: RecentServerErrorsController["logs"]; empty: boolean; t: Translate }) {
  if (!logs) return null;
  return <>
    {!logs.capturing ? (
      <p className="jini-field-hint" role="note">{t("This server is not recording its log yet, so errors cannot be listed. Restart the site to start recording.")}</p>
    ) : null}
    {logs.capturing && empty ? <p role="status">{t("No errors recorded.")}</p> : null}
    {logs.truncated ? <p className="jini-field-hint">{t("Showing the newest 50 errors.")}</p> : null}
  </>;
}

/**
 * One distinct error: a toggle button (the whole summary line) that opens the full message, and a
 * Copy button beside it — siblings, never nested, so each stays its own tab stop.
 */
function RecentErrorItem(props: { row: RecentServerErrorRow; clipboard: RecentServerErrorsController["clipboard"]; t: Translate; useRecentErrorItemHook: RecentErrorItemHook; }) {
  const { row, clipboard, t } = props;
  const { expanded, toggle, detailId, copied, copy } = props.useRecentErrorItemHook({ copyText: row.copyText, clipboard });

  return (
    <li className="jini-observability-error" data-expanded={expanded}>
      <div className="jini-observability-error-head">
        <button type="button" className="jini-observability-error-toggle" aria-expanded={expanded} aria-controls={detailId} onClick={toggle}>
          <span className="jini-observability-error-chevron">
            <ChevronIcon />
          </span>
          <span className="jini-observability-error-body">
            <RecentErrorMeta row={row} t={t} />
            <span className="jini-observability-error-summary">{row.summary || t("(empty message)")}</span>
          </span>
        </button>
        <button
          type="button"
          className="jini-button jini-observability-error-copy"
          onClick={copy}
          title={t("Copy the time, source and full message, ready to paste.")}
          data-copied={copied}
        >
          {copied ? <CheckIcon /> : <CopyIcon />}
          <span aria-live="polite">{copied ? t("Copied") : t("Copy")}</span>
        </button>
      </div>
      <RecentErrorDetail row={row} id={detailId} hidden={!expanded} t={t} />
    </li>
  );
}

/** Time, source pill, the message's `[tag]` pill, and ×N when the error repeated. */
function RecentErrorMeta({ row, t }: { row: RecentServerErrorRow; t: Translate }) {
  return (
    <span className="jini-observability-error-meta">
      <time dateTime={row.at}>{row.when}</time>
      <span className="jini-observability-error-pill">{row.source === "daemon" ? t("assistant") : t("server")}</span>
      {row.scope ? <span className="jini-observability-error-pill">{row.scope}</span> : null}
      {row.count > 1 ? (
        <span className="jini-observability-error-pill jini-observability-error-pill--count" title={`${t("Times this error occurred")}: ${row.count}`}>
          ×{row.count}
        </span>
      ) : null}
    </span>
  );
}

/**
 * The full message. Always in the DOM (`hidden` while collapsed) so the toggle's `aria-controls`
 * always names a real element. Shortened paths carry the full path in `title`.
 */
function RecentErrorDetail({ row, id, hidden, t }: { row: RecentServerErrorRow; id: string; hidden: boolean; t: Translate }) {
  return (
    <div id={id} className="jini-observability-error-detail" hidden={hidden}>
      {/* Keyed on `firstAt`: the hook sets `firstAt` and `firstWhen` together (both only when the
          error repeated), so testing the ISO time leaves no unreachable `firstAt ?? undefined`. */}
      {row.firstAt ? (
        <p className="jini-observability-error-first-seen">
          {t("First seen")}: <time dateTime={row.firstAt}>{row.firstWhen}</time>
        </p>
      ) : null}
      <pre className="jini-observability-error-message">
        <code>
          {row.segments.map((segment, index) =>
            segment.fullPath ? (
              <span key={index} className="jini-observability-error-path" title={segment.fullPath}>
                {segment.text}
              </span>
            ) : (
              segment.text
            ),
          )}
        </code>
      </pre>
    </div>
  );
}
