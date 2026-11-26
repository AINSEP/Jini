import { agentHandle } from "@jini-ai/core/agent-handles";
import type { Translate } from "@jini-ai/core/text";
import type { ExportRunSnapshot as AdminExportRunSnapshot } from "@jini-ai/core/contracts/site/export-run";
import type { StaticExportController } from "./hooks/use-static-export.hooks.js";
import { exportRunStatusLabelKey, runStatusTone } from "./rules.js";
import type { StaticSiteTabProps } from "./StaticSiteTab.js";

/** A line of text the reader is meant to take somewhere else, with a Copy button.
 *
 *  It hands over a shell command: monospace, rendered with a `$` prompt via CSS. There used to be
 *  two variants, because this tab once handed over two different KINDS of text — a shell command
 *  and a sentence to say to the assistant (a `prose` flag: UI face, no prompt). Sharing one
 *  component kept the copy affordance identical between them; the variant only changed what the
 *  box claimed the text was. The prose call sites (the per-publish-CLI "ask the assistant" lines)
 *  left with the CLI-first route on 2026-09-29, so the flag had no caller and was removed; bring
 *  it back with the first new prose call site.
 *
 *  Component-local state rather than a hook + port pair — there is nothing to inject, same
 *  carve-out `ThemeExplore.tsx`'s device-width/fullscreen state documents.
 *
 *  A denied clipboard permission is swallowed, same as everywhere else in this app: the text is
 *  visible and selectable in the block itself, so a failed copy degrades to "select it manually"
 *  rather than to an error the reader can do nothing about. */
function CopyLine({
  text,
  copyLabel,
  copiedLabel,
  copyAccessibleName,
  agentHandleId,
  useCopyLine: useCopyLineHook,
}: {
  text: string;
  copyLabel: string;
  copiedLabel: string;
  /** Distinguishes the several Copy buttons this tab now has. Two controls whose only accessible
   *  name is "Copy" are ambiguous to anyone listing the page's buttons, and "Copy" is a substring of
   *  each name passed here, which is what keeps the visible label a valid part of the accessible one
   *  (WCAG 2.5.3 Label in Name). */
  copyAccessibleName: string;
  /** This component has several call sites in this tab (the export command, and one per publish
   *  CLI's "ask the assistant" line) — the id is caller-supplied rather than a constant baked into
   *  this component, same reason `copyAccessibleName` is. */
  agentHandleId: string;
  useCopyLine: StaticSiteTabProps["hooks"]["useWiredCopyToClipboard"];
}, _optional = {}) {
  const { copied, copy } = useCopyLineHook();

  return (
    <div className="deployment-command">
      <code translate="no">{text}</code>
      {/* `aria-live="polite"` on the label so the swap to "Copied!" is announced — an action whose
          only feedback is a silent visual label change is invisible to a screen-reader user. */}
      <button
        type="button"
        className="btn-secondary"
        onClick={() => void copy(text)}
        aria-label={copyAccessibleName}
        {...agentHandle({ handle: agentHandleId }, { role: "button", label: copyAccessibleName })}
      >
        <span aria-live="polite">{copied ? copiedLabel : copyLabel}</span>
      </button>
    </div>
  );
}

/** The counts half of a completed export run's detail — routes/assets succeeded-vs-failed, and
 *  where the export landed. Split out of {@link ExportRunResult} purely for the complexity gate:
 *  this repo's real `apps/admin` ESLint gate is a hard 9/9 cyclomatic/cognitive ceiling
 *  (`eslint.config.mjs`'s own `F06 option B` block), and this block's three independent ternaries
 *  (two failed-count checks, one optional `outputDir`) counted directly in `ExportRunResult` pushed
 *  it to 11 — same reasoning `PublishPreviewAction`'s own doc gives for splitting the publish half of
 *  this tab. No behavior moved, only where the branches are counted. */
function ExportRunCounts({ run, t: translate }: { run: AdminExportRunSnapshot; t: Translate }, _optional = {}) {
  const counts = run.counts;
  if (!counts) throw new Error("completed export run has no counts");
  return (
    <div className="deployment-facts">
      <div className="deployment-fact">
        <span className="deployment-fact-label">{translate("Routes")}</span>
        <span className="deployment-fact-value">
          {counts.routesSucceeded} {translate("succeeded")}
          {counts.routesFailed > 0 ? `, ${counts.routesFailed} ${translate("failed")}` : ""}
        </span>
      </div>
      <div className="deployment-fact">
        <span className="deployment-fact-label">{translate("Assets")}</span>
        <span className="deployment-fact-value">
          {counts.assetsSucceeded} {translate("succeeded")}
          {counts.assetsFailed > 0 ? `, ${counts.assetsFailed} ${translate("failed")}` : ""}
        </span>
      </div>
      {run.outputDir ? (
        <div className="deployment-fact">
          <span className="deployment-fact-label">{translate("Written to")}</span>
          <span className="deployment-fact-value">
            <code translate="no">{run.outputDir}</code>
          </span>
        </div>
      ) : null}
    </div>
  );
}

/** The failure-detail half of a completed export run — WHICH routes/assets failed and why, not just
 *  the aggregate counts {@link ExportRunCounts} shows. Split out for the same complexity-gate reason
 *  that function's own doc gives: two independent `&&`/length-check branches, one per list, counted
 *  directly in `ExportRunResult` is what pushed it over budget together with the counts block. */
function ExportRunFailures({ run, t: translate }: { run: AdminExportRunSnapshot; t: Translate }, _optional = {}) {
  return (
    <>
      {run.failedRoutes && run.failedRoutes.length > 0 ? (
        <div className="deployment-failure-list">
          <span className="deployment-fact-label">{translate("Failed routes")}</span>
          <ul>
            {run.failedRoutes.map((failure, index) => (
              <li key={`${failure.kind}:${failure.path}:${index}`}>
                <code translate="no">{failure.path}</code> — {failure.reason}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {run.failedAssets && run.failedAssets.length > 0 ? (
        <div className="deployment-failure-list">
          <span className="deployment-fact-label">{translate("Failed assets")}</span>
          <ul>
            {run.failedAssets.map((failure, index) => (
              <li key={`${failure.url}:${index}`}>
                <code translate="no">{failure.url}</code> — {failure.reason}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </>
  );
}

/** One export run's completed/errored detail — counts, failures, and where it landed. Only rendered
 *  once `run.status` is `"completed"` or `"errored"`; a `"running"`/`"idle"` run has nothing here yet
 *  to report. Delegates to {@link ExportRunCounts}/{@link ExportRunFailures} for the complexity-gate
 *  reason each of those documents — this function itself now only decides WHICH detail to show. */
function ExportRunResult({ run, t: translate }: { run: AdminExportRunSnapshot; t: Translate }, _optional = {}) {
  if (run.status === "errored") {
    return (
      <p className="save-error" role="alert">
        {run.error}
      </p>
    );
  }
  if (run.status !== "completed" || !run.counts) return null;
  return (
    <>
      <ExportRunCounts run={run} t={translate} />
      <ExportRunFailures run={run} t={translate} />
    </>
  );
}

/** The "Build here or in a terminal" card's second half — the command block (unchanged) plus the real
 *  build action: a clean/overwrite checkbox, the Build button itself, a live status pill, and the
 *  run's own result once it settles. */
export function BuildExportCard({ controller, t: translate , deps, hooks }: { controller: StaticExportController; t: Translate } & Pick<StaticSiteTabProps, "deps" | "hooks">, _optional = {}) {
  const tone = runStatusTone({ status: controller.run?.status ?? "idle" }, { ok: controller.run?.ok });

  return (
    <div
      className="card"
      {...agentHandle({ handle: "deployment-static-site-export-card" }, {
        role: "region",
        label: "Build a static export from this admin server, with a live run status and result",
      })}
    >
      <div className="card-head">
        <h2 className="card-title">{translate("Build here or in a terminal")}</h2>
        <div className="card-head-actions">
          <span className={`status status-${tone}`}>{translate(exportRunStatusLabelKey({ run: controller.run }))}</span>
        </div>
      </div>
      <div className="deployment-card-body">
        {controller.loadError ? (
          <p
            className="notice error"
            role="status"
            {...agentHandle({ handle: "deployment-static-site-export-load-error" }, {
              role: "status",
              label: "Shows the error when this export's current status could not be loaded",
            })}
          >
            {controller.loadError}
          </p>
        ) : null}
        <StaticExportCommand deps={deps} hooks={hooks} t={translate} />
        <ExportTriggerAction controller={controller} t={translate} />
      </div>
    </div>
  );
}

/** The Build action — clean checkbox, the trigger button itself, and every terminal state a run can
 *  end in (a rejected trigger, a poll that gave up — {@link StaticExportController.pollError}, added
 *  this pass, see this file's header — and a settled run's own result). Split out of
 *  {@link BuildExportCard} for the same complexity-gate reason `PublishPreviewAction`'s own doc gives
 *  for the publish half of this tab: this repo's real `apps/admin` ESLint gate is a HARD 9/9
 *  cyclomatic/cognitive ceiling (`eslint.config.mjs`'s own `F06 option B` block — not the 15/warn the
 *  rest of the repo tolerates), and adding `pollError` as one more branch directly in
 *  `BuildExportCard` pushed it from 9 to 10 against that real gate. */
function ExportTriggerAction({ controller, t: translate }: { controller: StaticExportController; t: Translate }, _optional = {}) {
  const busy = controller.triggering || controller.isRunning;
  return (
    <div className="deployment-action">
      <label className="form-checkbox-field">
        <input
          type="checkbox"
          checked={controller.clean}
          onChange={(e) => controller.setClean(e.target.checked)}
          {...agentHandle({ handle: "deployment-static-site-export-clean" }, {
            role: "checkbox",
            label: "Overwrite the export output folder's existing contents before writing the new export",
          })}
        />
        {translate("Overwrite existing files in the output folder")}
      </label>
      <p className="deployment-action-reason">
        {translate(
          "Off by default. The exporter refuses to write into a non-empty folder unless this is checked — it never deletes unknown files silently."
        )}
      </p>

      <button
        type="button"
        disabled={busy}
        onClick={() => void controller.trigger()}
        {...agentHandle({ handle: "deployment-static-site-export-build" }, {
          role: "button",
          label: "Start a static export from this admin server, using the checkbox above's overwrite setting",
        })}
      >
        {busy ? translate("Exporting…") : translate("Build static export")}
      </button>
      <ExportRunFeedback controller={controller} t={translate} />
    </div>
  );
}

function StaticExportCommand({ t: translate , deps, hooks }: { t: Translate } & Pick<StaticSiteTabProps, "deps" | "hooks">, _optional = {}) {
  const { copy } = deps;
  return (
    <>
        <p className="card-lead">
          {translate(copy.exportDescription)}
        </p>
        <CopyLine useCopyLine={hooks.useWiredCopyToClipboard}
          text={copy.exportCommand}
          copyLabel={translate("Copy")}
          copiedLabel={translate("Copied!")}
          copyAccessibleName={translate("Copy the export command")}
          agentHandleId="deployment-static-site-export-command-copy"
        />
        <p className="deployment-action-reason">
          {translate("Replace <dir> with the folder to write into. It is a required argument — there is no default.")}
        </p>
    </>
  );
}

function ExportRunFeedback({ controller, t: translate }: { controller: StaticExportController; t: Translate }, _optional = {}) {
  return (
    <>
      {controller.triggerError ? (
        <p className="save-error" role="alert">
          {controller.triggerError}
        </p>
      ) : null}
      {controller.pollError ? (
        <p
          className="notice warning"
          role="status"
          {...agentHandle({ handle: "deployment-static-site-export-poll-error" }, {
            role: "status",
            label: "States that this export's status could no longer be checked, so the button re-enabled even though the run may still be in progress",
          })}
        >
          {controller.pollError}
        </p>
      ) : null}
      {controller.run ? <ExportRunResult run={controller.run} t={translate} /> : null}
    </>
  );
}
