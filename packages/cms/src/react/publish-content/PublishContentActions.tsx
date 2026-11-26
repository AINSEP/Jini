import { agentHandle } from "@jini-ai/core/agent-handles";
import type { PublishContentDialogProps } from "./PublishContentDialog.js";

export function renderPublishPeerPicker(
  { view, t }:
    Pick<PublishContentDialogProps, "t"> &
    { view: ReturnType<NonNullable<PublishContentDialogProps["hooks"]["usePublishContentConfirmHook"]>> }
, _optional = {}) {
  return (
    view.peers.length > 1 && (
      <label className="field">
        <span>{t("Publish to")}</span>
        <select
          value={view.selectedPeerId ?? ""}
          disabled={!view.peerSelectionEnabled}
          onChange={(e) => view.onSelectPeer({ peerId: e.target.value })}
          {...agentHandle(
            { handle: "dashboard-publish-content-peer" },
            {
              // `AgentElementRole` has no `select` member — a `<select>` is a `field` in that
              // vocabulary, same as every other value-carrying control.
              role: "field",
              label: "Which site to publish this content to",
            }
          )}
        >
          <option value="">{t("Choose a site…")}</option>
          {view.peers.map((peer) => (
            <option key={peer.id} value={peer.id}>
              {peer.label}
            </option>
          ))}
        </select>
      </label>
    )
  );
}

export function renderPublishContentActions(
  { view, t }:
    Pick<PublishContentDialogProps, "t"> &
    { view: ReturnType<NonNullable<PublishContentDialogProps["hooks"]["usePublishContentConfirmHook"]>> }
, _optional = {}) {
  return (
    <span className="editor-actions">
      {/* Cancel is the default-focused control — see this file's header for why, even though
            this dialog isn't destructive. */}
      <button
        type="button"
        className="btn-secondary"
        data-jini-autofocus=""
        disabled={!view.dismissible}
        onClick={view.onDismiss}
        {...agentHandle(
          { handle: "dashboard-publish-content-cancel" },
          {
            role: "button",
            label: "Close this dialog without publishing",
          }
        )}
      >
        {t("Cancel")}
      </button>
      {/* Two different buttons, keyed apart so the confirm is a new element rather than the plan
            button relabelled in place — a click waiting on "Planning…" must never land on
            "Publish N items" (owner report 2026-09-26; see `CONFIRM_ARM_DELAY_MS`). */}
      {renderPublishPrimaryAction({ view })}
    </span>
  );
}

function renderPublishPrimaryAction(
  { view }:
    Pick<Parameters<typeof renderPublishContentActions>[0], "view">
, _optional = {}) {
  return (
    view.primaryKind === "start" ? (
      <button
        key="start"
        type="button"
        className="btn-primary"
        disabled={view.primaryDisabled}
        onClick={view.onPrimary}
        {...agentHandle(
          { handle: "dashboard-publish-content-plan" },
          {
            role: "button",
            // While `connectOffer` is set this button connects the pre-filled site instead of
            // planning — see this file's header.
            label: view.connectOffer
              ? "Connect this site so it can publish, using the pre-filled site address"
              : "Work out what would be published, without publishing anything",
          }
        )}
      >
        {view.primaryLabel}
      </button>
    ) : (
      <button
        key="confirm"
        type="button"
        className="btn-primary"
        disabled={view.primaryDisabled}
        onClick={view.onPrimary}
        {...agentHandle(
          { handle: "dashboard-publish-content-confirm" },
          {
            role: "button",
            label: "Publish the checked items to the live site",
          }
        )}
      >
        {view.primaryLabel}
      </button>
    )
  );
}

