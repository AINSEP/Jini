import { type Translate, interpolate } from "@jini-ai/core/text";

type AdmissionDriftEntry = {
  connectionId: string;
  remoteName: string | null;
  kind: string;
  messageKey: string;
  messageVars: Readonly<Record<string, string>>;
};
type AdmissionDriftConnection = {
  connectionId: string;
  notLoaded: readonly string[];
  liveToolCount: number;
  savedToolCount: number;
  entries: readonly AdmissionDriftEntry[];
};
type ExternalMcpAdmissionsController<Connection extends AdmissionDriftConnection = AdmissionDriftConnection> = {
  loading: boolean;
  waitingForAssistant: boolean;
  unavailable: string | null;
  connections: readonly Connection[];
  restartHelps: boolean;
  canRestart: boolean;
  restarting: boolean;
  restartError: string | null;
  restartAccepted: boolean;
  restart: () => void;
};

/**
 * @file "What the assistant is actually running" — the operator half of the refusal channel.
 *
 * The tab above this banner shows what was SAVED. `Jini packages/mcp/src/federation/trust.ts` R5 freezes the admitted
 * set at connect, so those are two different objects, and until now the only way to see the gap was
 * to read the daemon's terminal at the moment it booted. That is how this project discovered
 * Higgsfield's blocked `generate_image` in the first place — and on a desktop app nobody can SSH
 * into, a terminal is not a support channel.
 *
 * Renders NOTHING when the live assistant and the saved roster agree, which is the normal state. A
 * banner that is always present is a banner nobody reads.
 *
 * All display decisions live in `external-mcp-admissions-rules.ts` and the hook beside it; this
 * file only maps already-decided rows onto elements. The copy strings are their own i18n keys
 * (`dictionary-translator.ts`) and are passed through `t` verbatim — six of them were written and
 * translated into 21 locales in Phase 2C for exactly this UI and have never been rendered.
 */

/** One row: what the assistant refused, and — for the one case an operator can fix from here —
 *  the tick that fixes it. A real `<label>`, not an `aria-label`: an icon-only or bare checkbox
 *  would have no accessible name at all, and `agentHandle`'s `label` does not supply one (it emits
 *  `data-agent-label`). The visible words also make the translated sentence beside it
 *  ("Tick 'Allow changes' to enable this tool.") literally true rather than a reference to a control
 *  that is not there. */
function AdmissionDriftRow(props: {
  entry: AdmissionDriftEntry;
  t: Translate;
  onAllowWrite: (connectionId: string, remoteName: string) => void;
  onRequestRemove: (connectionId: string) => void;
}) {
  const { entry, t, onAllowWrite, onRequestRemove } = props;
  const message = interpolate({ template: t(entry.messageKey), vars: entry.messageVars });
  // Bound locally so the null check below narrows inside the `onChange` closure too. A
  // `needs-write-grant` row always names a tool (it comes from a gate refusal), but the type cannot
  // know that, and asserting it would be the more expensive way to be right.
  const { remoteName } = entry;

  return (
    <li className="external-mcp-drift-row">
      {/* Absent for a row about the whole connection rather than one of its tools — the section's
          own `<h4>` already names it, and an empty `<code>` before a dash would read as a tool
          whose name failed to load. */}
      {remoteName === null ? null : (
        <>
          <code>{remoteName}</code> —{" "}
        </>
      )}
      <span>{message}</span>
      {entry.kind === "missing-launcher" ? (
        <button type="button" onClick={() => onRequestRemove(entry.connectionId)} data-agent-element={`mcp-drift-remove-${entry.connectionId}`}>
          {t("Remove")}
        </button>
      ) : null}
      {entry.kind === "needs-write-grant" && remoteName !== null ? (
        <label className="external-mcp-drift-grant">
          <input
            type="checkbox"
            checked={false}
            onChange={() => onAllowWrite(entry.connectionId, remoteName)}
            data-agent-element={`mcp-drift-grant-${entry.connectionId}-${remoteName}`}
          />
          <span>{t("Allow changes")}</span>
        </label>
      ) : null}
    </li>
  );
}

/** One connection's saved-vs-live line plus its rows. The count line is only rendered when names
 *  are actually missing: "Live now: 5. Saved: 5." is noise, and the parameterized key is written
 *  around naming the absent ones. */
function AdmissionConnectionSection(props: {
  connection: AdmissionDriftConnection;
  t: Translate;
  onAllowWrite: (connectionId: string, remoteName: string) => void;
  onRequestRemove: (connectionId: string) => void;
}) {
  const { connection, t, onAllowWrite, onRequestRemove } = props;

  return (
    <section className="external-mcp-drift-connection">
      <h4>{connection.connectionId}</h4>
      {connection.notLoaded.length > 0 ? (
        <p>
          {interpolate({ template: t("Live now: {live} tools. Saved: {saved} tools — {names} are not loaded."), vars: {
            live: connection.liveToolCount,
            saved: connection.savedToolCount,
            names: connection.notLoaded.join(", "),
          } })}
        </p>
      ) : null}
      <ul>
        {connection.entries.map((entry) => (
          <AdmissionDriftRow key={`${entry.connectionId}:${entry.remoteName}:${entry.kind}`} entry={entry} t={t} onAllowWrite={onAllowWrite} onRequestRemove={onRequestRemove} />
        ))}
      </ul>
    </section>
  );
}

/**
 * The restart footer. D-4: the restart route is `system.write`-gated while this tab is
 * `admin.integrations.manage`-gated, so an operator with integration rights and no system rights is
 * told who can do it instead of being handed a button that 403s on click.
 *
 * "Accepted", never "restarted": the route answers as soon as a restart is INITIATED and no "the
 * daemon became healthy" signal exists anywhere in this codebase (that route's own header). Saying
 * more than was actually learned is the failure mode this whole slice exists to close.
 */
function AdmissionRestartFooter(props: { controller: ExternalMcpAdmissionsController; t: Translate }) {
  const { controller, t } = props;

  if (!controller.canRestart) {
    return (
      <p className="external-mcp-drift-restart">
        {t("You don't have permission to restart the assistant. Ask someone who does to restart it so this change takes effect.")}
      </p>
    );
  }

  return (
    <p className="external-mcp-drift-restart">
      <button type="button" onClick={controller.restart} disabled={controller.restarting} data-agent-element="mcp-drift-restart">
        {t("Restart the assistant")}
      </button>{" "}
      <span>{t("This ends any conversation in progress.")}</span>
      {controller.restartError ? <span role="alert">{controller.restartError}</span> : null}
      {controller.restartAccepted ? <span role="status">{t("Restarting…")}</span> : null}
    </p>
  );
}

export interface ExternalMcpAdmissionsBannerProps<Connection extends AdmissionDriftConnection = AdmissionDriftConnection> {
  describeHeadline: (required: { connections: readonly Connection[] }, optional?: Record<string, never>) => string;
  controller: ExternalMcpAdmissionsController<Connection>;
  t: Translate;
  /** Ticks "Allow changes" for one tool by writing the connection's `writeAllowedToolNames` field
   *  through the same `updateSource` port the card's own edit form uses. */
  onAllowWrite: (connectionId: string, remoteName: string) => void;
  /** Opens the existing confirmation dialog; only its Confirm calls the existing delete hook. */
  onRequestRemove: (connectionId: string) => void;
}

export function ExternalMcpAdmissionsBanner<Connection extends AdmissionDriftConnection>({ controller, t, onAllowWrite, onRequestRemove, describeHeadline }: ExternalMcpAdmissionsBannerProps<Connection>) {
  if (controller.loading) return null;

  if (controller.waitingForAssistant) {
    return (
      <p className="external-mcp-status" role="status">
        {t("The assistant is starting. This list updates on its own when it's ready.")}
      </p>
    );
  }

  if (controller.unavailable) {
    return (
      <div className="external-mcp-banner" role="status">
        {controller.unavailable}
      </div>
    );
  }

  if (controller.connections.length === 0) return null;

  return (
    // No `role` on the wrapper: this renders on load rather than in response to an action, so it is
    // ordinary content, and a live region wrapping the two live regions below (the restart refusal's
    // `alert` and its `status`) would make a screen reader announce the whole banner again on every
    // inner change.
    <div className="external-mcp-banner external-mcp-drift">
      <p>{t(describeHeadline({ connections: controller.connections }))}</p>
      {controller.connections.map((connection) => (
        <AdmissionConnectionSection key={connection.connectionId} connection={connection} t={t} onAllowWrite={onAllowWrite} onRequestRemove={onRequestRemove} />
      ))}
      {controller.restartHelps ? <AdmissionRestartFooter controller={controller} t={t} /> : null}
    </div>
  );
}
