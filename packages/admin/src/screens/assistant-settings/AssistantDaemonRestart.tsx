import { agentHandle } from "@jini-ai/core/agent-handles";
import type { ProcessRestartController as AssistantDaemonRestartController } from "../../react/hooks/use-process-restart.js";

/**
 * Manual recovery control for the Local CLI daemon process `AdminExecutionMode` just configured —
 * the "human's not gonna know how to restart a Node process" seam
 * (the host's assistant-daemon system route, backed by its `daemon-supervisor.ts`).
 *
 * Renders directly under `AdminExecutionMode` in the same tab, not on its own tab: this control is
 * only meaningful in the context of "Local CLI" mode (a BYOK-mode admin has no daemon process to
 * restart), and putting it beside the mode picker keeps that context visible without a separate
 * screen having to re-explain it.
 *
 * ## Why this never says "restarted successfully" or "healthy"
 *
 * `restart()`'s own contract (`@jini-ai/admin/react`'s `useProcessRestart`, bound by
 * `hooks/assistant-daemon-restart-dependencies.hooks.ts`) is that a restart being
 * ACCEPTED and the daemon becoming HEALTHY are two different facts, and only the first one is ever
 * knowable from this button press — there is no "daemon became healthy" signal anywhere in
 * `daemon-supervisor.ts`. This component's copy is written to match that exactly: the result line
 * says "accepted", never "restarted" on its own, and the status line below it says "no known
 * failure right now" rather than "healthy". Reporting anything stronger would repeat the same
 * lying-comment failure mode a past defect in this repo was caused by.
 */
export interface AssistantDaemonRestartProps {
  /** The screen's own translator. */
  t: (key: string) => string;
  /** Host copy for the explainer under the heading — it names the product's own automatic retry. */
  description: string;
  /** REQUIRED: the host's bound restart controller (normally `useProcessRestart` over its port). */
  useAssistantDaemonRestartHook: () => AssistantDaemonRestartController;
  /**
   * REQUIRED: the host's execution-policy verdict. `false` hides the whole control — a deployment
   * that may not run a Local CLI has no daemon to restart, so the entry point must not exist there.
   */
  useRestartAllowedHook: () => boolean;
}

/** The status line under the button — one of three mutually exclusive messages keyed on
 *  `knownFailed`/`checkingStatus`/`statusError`. Pulled to a top-level pure function for the same
 *  reason `visitorCredentialKeyStatusMessage` is: an independently testable decision instead
 *  of a ternary chain inline in the component's JSX. */
export function assistantDaemonStatusMessage(
  controller: Pick<AssistantDaemonRestartController, "knownFailed" | "checkingStatus" | "statusError">,
  { t = (key) => key }: { t?: (key: string) => string } = {},
): string | null {
  if (controller.statusError) return controller.statusError;
  if (controller.checkingStatus && controller.knownFailed === null) return t("Checking status…");
  if (controller.knownFailed === true) return t("Known failed — the last attempt to start it did not succeed.");
  if (controller.knownFailed === false) return t("No known failure right now.");
  return null;
}

/** A restart acknowledgement describes acceptance, never inferred process health. */
export function assistantRestartResultMessage({ result, t }: { result: NonNullable<AssistantDaemonRestartController["restartResult"]>; t: (key: string) => string }, _options: Record<string, never> = {}): string {
  return result.ok
    ? t("Restart accepted. This does not confirm the process is healthy yet — check the status below.")
    : t("Restart refused: {reason}").replace("{reason}", () => result.reason ?? "");
}

function RestartActions({ controller, t }: { controller: AssistantDaemonRestartController; t: (key: string) => string }) {
  const { restarting, checkingStatus, checkStatus, restart } = controller;
  return (
    <div className="jini-assistant-daemon-restart-actions">
      <button
        type="button"
        className="btn-secondary"
        onClick={() => void restart()}
        disabled={restarting}
        {...agentHandle({ handle: "ai-assistant-daemon-restart" }, { role: "button", label: "Restart the Local CLI assistant process" })}
      >
        {restarting ? t("Restarting…") : t("Restart assistant")}
      </button>
      <button
        type="button"
        className="btn-secondary"
        onClick={() => void checkStatus()}
        disabled={checkingStatus}
        {...agentHandle({ handle: "ai-assistant-daemon-check-status" }, { role: "button", label: "Check the Local CLI assistant process status" })}
      >
        {t("Check status")}
      </button>
    </div>
  );
}

export function AssistantDaemonRestart(props: AssistantDaemonRestartProps) {
  const { t } = props;
  const controller = props.useAssistantDaemonRestartHook();
  const { restartResult, restartError } = controller;
  const statusMessage = assistantDaemonStatusMessage(controller, { t });
  // This panel only reads the policy's `allowed` verdict and never edits the execution config, so
  // it calls the policy hook directly rather than the settings adapter (the host's settings-execution hook),
  // whose required config-change sink would have been a no-op nobody could ever invoke here.
  const allowed = props.useRestartAllowedHook();
  if (!allowed) return null;

  return (
    <section className="jini-assistant-daemon-restart">
      <h2>{t("Local CLI process")}</h2>
      <p className="jini-assistant-muted">{props.description}</p>
      <RestartActions controller={controller} t={t} />
      {restartError ? <div className="jini-save-error">{restartError}</div> : null}
      {!restartError && restartResult ? (
        <p className="jini-assistant-save-line" role="status">
          {assistantRestartResultMessage({ result: restartResult, t })}
        </p>
      ) : null}
      {statusMessage ? <p className="jini-assistant-muted" role="status">{statusMessage}</p> : null}
    </section>
  );
}
