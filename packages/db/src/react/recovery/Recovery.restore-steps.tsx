import { agentHandle } from "@jini-ai/core/agent-handles";
import { formatTimestamp } from "@jini-ai/core/text";
import type { RecoveryProps, RestoreFlowProps } from "./Recovery.js";

type AdminRestorePoint = RestoreFlowProps["point"];
type AdminDisclosureResult = NonNullable<ReturnType<RecoveryProps["useRestoreFlowHook"]>["disclosure"]>;
type CeremonyStep = ReturnType<RecoveryProps["useRestoreFlowHook"]>["step"];

/** This stylesheet's discard-count row classes (`.recovery-loss-qty` carries the numeral's weight). */
const RECOVERY_LOSS_CLASSES = { row: "recovery-loss-row", quantity: "recovery-loss-qty", category: "recovery-loss-what" };
/** Step 2 — the discarded-write-window disclosure (design-spec.md §4.3): the load-bearing,
 * blocking centerpiece of this screen. Renders only categories the server response actually
 * contains (never a placeholder row for an uncovered category), and renders `"unknown"` distinctly
 * from `0` (INV-05 — a `0` implies verified-zero-loss, `"unknown"` means the baseline could not be
 * computed at all; these must never be conflated). */
function DisclosurePanel(props: {
  locale: string;
  point: AdminRestorePoint;
  disclosure: AdminDisclosureResult;
  acknowledged: boolean;
  onAcknowledgeChange: (checked: boolean) => void;
  copy: RecoveryProps["copy"];
}) {
  const { locale, copy: { t, sinceDiscardMessage, discardCountLine, categoryLabel, baselineUnavailableMessage } } = props;
  const categories = Object.entries(props.disclosure.counts);

  return (
    <div className="recovery-disclosure-panel">
      <div className="recovery-loss-manifest">
        <p className="recovery-loss-lede">{sinceDiscardMessage({ locale: locale, createdAt: props.point.createdAt })}</p>
        <ul className="recovery-loss-list">
          {categories.map(([category, count]) => (
            <li key={category}>{discardCountLine({ locale: locale, count: count, categoryLabelText: categoryLabel({ category: category, locale: locale }), classNames: RECOVERY_LOSS_CLASSES })}</li>
          ))}
        </ul>
        <p className="recovery-loss-caveat">{t({ locale: locale, key: "This covers watermark-stamped write paths only (posts/pages and plugin-table writes today) and is NOT a complete count of everything written since this restore point — change-sets, taxonomy writes, Collections entries, and sessions are not yet counted here." })}</p>
      </div>
      {/* A SIBLING of the manifest, not a child of it (web-design pass #3, 2026-09-10). This is the
          one sentence on the screen that changes what an operator should do — it says every figure
          they just read is unverified — so it is the composition's rank-1 element and gets the
          card's full width, the same full-bleed band treatment every other region here has. Nested
          inside the manifest it rendered as a rounded red box floating inside a tinted box, which
          is the boxes-in-boxes shape pass #2's own header says it set out to remove.

          Order is unchanged and must stay unchanged: its own text reads "every count **above** is
          shown as 'unknown'", so it has to follow the counts. That sentence is translated as one
          static block in all 19 locales (`BASELINE_UNAVAILABLE_TEXT`), so moving it ahead of the
          ledger would need 19 rewrites, not a reflow. */}
      {!props.disclosure.watermarkBaselineAvailable ? (
        <p className="save-error recovery-baseline-alarm" role="alert">
          {baselineUnavailableMessage({ locale: locale })}
        </p>
      ) : null}
      <label id="recovery-ack-label" className="recovery-ack-gate">
        <input
          type="checkbox"
          checked={props.acknowledged}
          onChange={(e) => props.onAcknowledgeChange(e.target.checked)}
          {...agentHandle({ handle: "recovery-disclosure-acknowledge" }, {
            role: "field",
            label: "Acknowledge the discarded-write-window disclosure",
          })}
        />
        {t({ locale: locale, key: "I understand this count is partial, not exhaustive, and accept the loss window described above." })}
      </label>
    </div>
  );
}

/** The disclosure section (top of `RestoreFlow`): the discarded-write-window error, its loading
 * placeholder, or the panel itself, in that priority order. Split out because — along with
 * `RestoreCeremonySteps` below — this is one of the two independent "wide branch set" halves of
 * the original `RestoreFlow`: this half decides what to show about data loss, the other half
 * decides what to show about ceremony progress, and neither needs the other's branches in scope. */
function RestoreDisclosureStatus(props: {
  locale: string;
  point: AdminRestorePoint;
  disclosure: AdminDisclosureResult | null;
  error: string | null;
  acknowledged: boolean;
  onAcknowledgeChange: (checked: boolean) => void;
  copy: RecoveryProps["copy"];
}) {
  const { locale, point, disclosure, error, acknowledged, onAcknowledgeChange, copy, copy: { t } } = props;

  if (error) return <div className="notice error">{error}</div>;
  if (!disclosure) return <div className="notice">{t({ locale: locale, key: "Computing the discarded-write-window disclosure…" })}</div>;
  return <DisclosurePanel locale={locale} point={point} disclosure={disclosure} acknowledged={acknowledged} onAcknowledgeChange={onAcknowledgeChange} copy={copy} />;
}

/** Step 3a (design-spec.md §4.3) — acknowledge-gated entry into the ceremony. Its own component
 * (rather than inline in `RestoreCeremonySteps`) because the busy-label ternary and the
 * not-yet-acknowledged `title` ternary would otherwise nest two levels deep inside that
 * function's own `step === "idle"` branch — exactly the nesting SonarJS's cognitive-complexity
 * rule penalises beyond what the cyclomatic count shows. */
function RestoreIdleStep(props: { locale: string; acknowledged: boolean; busy: boolean; onStart: () => void; copy: RecoveryProps["copy"] }) {
  const { locale, acknowledged, busy, onStart, copy: { t } } = props;
  return (
    <div className="recovery-ceremony-step">
      <button
        type="button"
        className="btn-primary"
        disabled={!acknowledged || busy}
        aria-describedby="recovery-ack-label"
        title={!acknowledged ? t({ locale: locale, key: "Acknowledge the disclosure above to continue." }) : undefined}
        onClick={onStart}
        {...agentHandle({ handle: "recovery-restore-start" }, { role: "button", label: "Continue to confirm the restore" })}
      >
        {busy ? t({ locale: locale, key: "Planning…" }) : t({ locale: locale, key: "Continue to confirm" })}
      </button>
    </div>
  );
}

/** Step 3b (SPEC-019 C-301) — plan issued, not yet confirmed. */
function RestorePlannedStep(props: { locale: string; planId: string; busy: boolean; onConfirm: () => void; copy: RecoveryProps["copy"] }) {
  const { locale, planId, busy, onConfirm, copy: { t, restorePlanReadyMessage } } = props;
  return (
    <div className="recovery-ceremony-step">
      <p>{restorePlanReadyMessage({ locale: locale, planId: planId })}</p>
      <button
        type="button"
        className="btn-secondary"
        onClick={onConfirm}
        disabled={busy}
        {...agentHandle({ handle: "recovery-restore-confirm" }, { role: "button", label: "Confirm the planned restore, issuing a one-time execution token" })}
      >
        {busy ? t({ locale: locale, key: "Confirming…" }) : t({ locale: locale, key: "Confirm restore" })}
      </button>
    </div>
  );
}

/** Step 3c (SPEC-019 C-302) — confirmed, execution token in hand, not yet executed. */
function RestoreConfirmedStep(props: { locale: string; busy: boolean; onExecute: () => void; copy: RecoveryProps["copy"] }) {
  const { locale, busy, onExecute, copy: { t } } = props;
  return (
    <div className="recovery-ceremony-step">
      <p>{t({ locale: locale, key: "Confirmed. Executing performs the restore — this cannot be undone." })}</p>
      <button
        type="button"
        className="btn-danger"
        onClick={onExecute}
        disabled={busy}
        {...agentHandle({ handle: "recovery-restore-execute" }, { role: "button", label: "Execute the confirmed restore now — cannot be undone" })}
      >
        {busy ? t({ locale: locale, key: "Restoring…" }) : t({ locale: locale, key: "Execute restore" })}
      </button>
    </div>
  );
}

/** Step 3d (SPEC-019 C-303) — the ceremony's terminal state. `restartRequired` (2026-07-16,
 * `DbOpsPort.restoreFromArtifact`) surfaces the "already-running process still holds the
 * pre-restore file handle" caveat described in this file's header, rather than silently implying
 * a live hot-swap happened. */
function RestoreDoneStep(props: { locale: string; restoreRunId: string; state: string; restartRequired?: boolean | undefined; copy: RecoveryProps["copy"]; ServerLabel: RecoveryProps["ServerLabel"] }) {
  const { locale, restoreRunId, state, restartRequired, ServerLabel, copy: { t, restoreDoneMessage } } = props;
  return (
    <div className="recovery-ceremony-step">
      <p role="status">
        {restoreDoneMessage({ locale: locale, restoreRunId: restoreRunId, stateNode: <span className={`status status-${state}`}><ServerLabel value={state} /></span> })}
      </p>
      {restartRequired ? (
        <p className="save-error" role="alert">
          {t({ locale: locale, key: "The database file was replaced — this server process is still serving the pre-restore data from its open connection. Restart the server now to pick up the restored data." })}
        </p>
      ) : null}
    </div>
  );
}

/** The four-stage ceremony switch (idle → planned → confirmed → done) plus its own error slot.
 * Exactly one of the four step components below renders at a time, keyed off `step` — this
 * function owns that selection so `RestoreFlow` itself doesn't have to. */
function RestoreCeremonySteps(props: {
  locale: string;
  ceremonyError: string | null;
  step: CeremonyStep;
  busy: boolean;
  acknowledged: boolean;
  plan: { planId: string } | null;
  confirmationToken: string | null;
  result: { restoreRunId: string; state: string; restartRequired?: boolean | undefined } | null;
  onStart: () => void;
  onConfirm: () => void;
  onExecute: () => void;
  copy: RecoveryProps["copy"];
  ServerLabel: RecoveryProps["ServerLabel"];
}) {
  const { locale, ceremonyError, step, busy, acknowledged, plan, confirmationToken, result, onStart, onConfirm, onExecute, copy, ServerLabel } = props;

  return (
    <>
      {ceremonyError ? <div className="notice error">{ceremonyError}</div> : null}
      {step === "idle" ? <RestoreIdleStep locale={locale} acknowledged={acknowledged} busy={busy} onStart={onStart} copy={copy} /> : null}
      {step === "planned" && plan ? <RestorePlannedStep locale={locale} planId={plan.planId} busy={busy} onConfirm={onConfirm} copy={copy} /> : null}
      {step === "confirmed" && confirmationToken ? <RestoreConfirmedStep locale={locale} busy={busy} onExecute={onExecute} copy={copy} /> : null}
      {step === "done" && result ? (
        <RestoreDoneStep locale={locale} restoreRunId={result.restoreRunId} state={result.state} restartRequired={result.restartRequired} copy={copy} ServerLabel={ServerLabel} />
      ) : null}
    </>
  );
}

export function RestoreFlowBody({ point, onBack, controller, copy, ServerLabel, viewerTimeZone: VIEWER_TIME_ZONE }: {
  point: RestoreFlowProps["point"];
  onBack: () => void;
  controller: ReturnType<RecoveryProps["useRestoreFlowHook"]>;
  copy: RecoveryProps["copy"];
  ServerLabel: RecoveryProps["ServerLabel"];
  viewerTimeZone: string;
}) {
  const { costClassLabel } = copy;
  const {
    disclosure,
    error,
    acknowledged,
    setAcknowledged,
    step,
    busy,
    ceremonyError,
    plan,
    confirmationToken,
    result,
    startPlan,
    doConfirm,
    doExecute,
    t,
    locale,
  } = controller;

  return (
    <div className="recovery-restore-docket">
      <button
        type="button"
        className="btn-ghost recovery-back-link"
        onClick={onBack}
        {...agentHandle({ handle: "recovery-back-to-list" }, { role: "button", label: "Back to the restore points list" })}
      >
        {t("← Restore points")}
      </button>
      <div className="card recovery-restore-card">
        <div className="recovery-ceremony-summary">
          <div className="recovery-restore-title-row">
            <h2 className="recovery-restore-title">
              {t("Restore to")} {formatTimestamp({ iso: point.createdAt }, { viewerTimeZone: VIEWER_TIME_ZONE })}
            </h2>
            <span className="visually-hidden">{t("Cost class")}</span>
            <span className={`status status-${point.costClass}`}>{costClassLabel({ costClass: point.costClass, locale: locale })}</span>
          </div>
          <p className="recovery-restore-meta">
            <span>
              <span className="recovery-meta-key">{t("Trigger")}</span>
              <span className="recovery-meta-value">{point.trigger}</span>
            </span>
            <span>
              <span className="recovery-meta-key">{t("Kind")}</span>
              <span className="recovery-meta-value">{point.kind}</span>
            </span>
          </p>
        </div>

        <RestoreDisclosureStatus copy={copy} locale={locale} point={point} disclosure={disclosure} error={error} acknowledged={acknowledged} onAcknowledgeChange={setAcknowledged} />

        <RestoreCeremonySteps
          copy={copy}
          ServerLabel={ServerLabel}
          locale={locale}
          ceremonyError={ceremonyError}
          step={step}
          busy={busy}
          acknowledged={acknowledged}
          plan={plan}
          confirmationToken={confirmationToken}
          result={result}
          onStart={startPlan}
          onConfirm={doConfirm}
          onExecute={doExecute}
        />
      </div>
    </div>
  );
}

