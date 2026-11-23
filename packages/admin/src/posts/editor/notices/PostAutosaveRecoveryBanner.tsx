import { agentHandle } from "@jini-ai/core/agent-handles";
import { type Translate } from "@jini-ai/core/text";
import type { AdminKitValues, StandingDraftAutosaveSnapshot } from "../../../react/kit.js";
/**
 * The package owns the captured-versus-server timestamp comparison; the host supplies translated copy.
 * The former feature-local stale predicate compared the draft's base version against the current
 * version (see `PostRepoPort.writeAutosave`), and its separate banner used a caller-supplied clock.
 * That old interpolated banner was untranslated because the static dictionary lacked interpolation;
 * the shared recovery message instead receives the host translator and saved timestamps.
 *
 * Admin imports no UI package, so the host injects that shared `standingDraftRecoveryMessage` as a
 * required prop (same function its kit exposes as `AdminKitValues["standingDraftRecoveryMessage"]`).
 */

/**
 * Standing-draft autosave (2026-09-06) — the "restore or discard" recovery banner. Never rendered
 * unless `usePostEditor` found a parked draft on mount (`recoverableDraft`); never applies it on its
 * own — both buttons require an explicit click, per the owner's own worry about silently clobbering
 * a different tab/operator's work. `standingDraftRecoveryMessage` (injected by the host)
 * owns the actual wording decision so this component stays markup only. Mirrors
 * `features/pages/PageEditor.tsx`'s identical `PageAutosaveRecoveryBanner`, `agentHandle`-tagged
 * and copy-through-`t` because this screen already uses both throughout, unlike Pages'.
 */
export function PostAutosaveRecoveryBanner({
  recoverableDraft,
  serverUpdatedAt,
  onRestore,
  onDiscard,
  t,
  standingDraftRecoveryMessage,
}: {
  recoverableDraft: StandingDraftAutosaveSnapshot;
  serverUpdatedAt: string;
  onRestore: () => void;
  onDiscard: () => void;
  t: Translate;
  standingDraftRecoveryMessage: AdminKitValues["standingDraftRecoveryMessage"];
}) {
  return (
    <div
      className="notice warning"
      {...agentHandle({ handle: "post-autosave-recovery" }, {
        role: "region",
        label: "An unsaved draft from a previous session was found — restore it or discard it",
      })}
    >
      <p>{standingDraftRecoveryMessage({ draft: recoverableDraft, t, serverUpdatedAt })}</p>
      <button
        type="button"
        className="btn-secondary"
        onClick={onRestore}
        {...agentHandle({ handle: "post-autosave-restore" }, { role: "button", label: "Apply the recovered draft into the editor" })}
      >
        {t("Restore")}
      </button>
      <button
        type="button"
        className="btn-secondary"
        onClick={onDiscard}
        {...agentHandle({ handle: "post-autosave-discard" }, { role: "button", label: "Discard the recovered draft without applying it" })}
      >
        {t("Discard")}
      </button>
    </div>
  );
}
